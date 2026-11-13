// Painel central da VM: gerencia as instâncias (acampamentos) deste servidor.
// Não executa nada no servidor: grava PEDIDOS que o executor (root, scripts/gerenciador-executor.sh)
// confere e executa; lê o ESTADO que o executor publica. Sem dependências externas.
//
// Segurança: login com senha (scrypt) + código de 6 dígitos (TOTP) obrigatório; bloqueio por
// tentativas; só aceita conexões das redes permitidas (VPN/local); cookie HttpOnly/SameSite=Strict;
// cabeçalho anti-CSRF; auditoria de todas as ações.
import { createServer } from 'node:http'
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const RAIZ = new URL('.', import.meta.url).pathname
const DADOS = process.env.DADOS || '/dados'          // usuários e auditoria (gravável pelo painel)
const PEDIDOS = process.env.PEDIDOS || '/pedidos'    // pedidos para o executor (gravável pelo painel)
const ESTADO = process.env.ESTADO || '/estado'       // publicado pelo executor (somente leitura)
const ESCUTAR = process.env.ESCUTAR || '127.0.0.1'
const PORTA = Number(process.env.PORTA || 9090)
const REDES = (process.env.REDES_PERMITIDAS || '127.0.0.1/32').split(',').map((r) => r.trim()).filter(Boolean)
const COOKIE = 'gerenciador_sessao'
// Publicação na internet (pelo proxy HTTPS da VM): o painel continua escutando só em 127.0.0.1 e o proxy
// (Caddy) entrega os pedidos. Nesse modo o cookie é "Secure", o domínio é conferido e o IP real do visitante
// vem do proxy (só é aceito quando o pedido chega do próprio servidor).
const PAINEL_DOMINIO = (process.env.PAINEL_DOMINIO || '').trim().toLowerCase()
const PROXY_CONFIAVEL = process.env.PROXY_CONFIAVEL === 'true'
const COOKIE_SEGURO = process.env.COOKIE_SEGURO === 'true'
const SESSAO_MIN = 120

// ------------------------------------------------------------------ utilidades
const lerJson = (c, padrao = null) => { try { return JSON.parse(readFileSync(c, 'utf8')) } catch { return padrao } }
function gravarJson(c, obj) { const t = `${c}.tmp`; writeFileSync(t, JSON.stringify(obj, null, 2), { mode: 0o600 }); renameSync(t, c) }
const ultimasLinhas = (c, n) => { try { return readFileSync(c, 'utf8').split('\n').slice(-n).join('\n') } catch { return '' } }

function ipParaNumero(ip) {
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip)
  return m ? ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4] : null
}
function permitido(ip) {
  const n = ipParaNumero(ip)
  if (n === null) return ip === '::1' && REDES.includes('127.0.0.1/32')
  return REDES.some((r) => {
    const [base, bits = '32'] = r.split('/'); const b = ipParaNumero(base); const k = Number(bits)
    if (b === null || !(k >= 0 && k <= 32)) return false
    const mascara = k === 0 ? 0 : (~0 << (32 - k)) >>> 0
    return ((n & mascara) >>> 0) === ((b & mascara) >>> 0)
  })
}

const ehLocal = (ip) => ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1'
/** IP de quem está acessando. Atrás do proxy local, vale o último valor de X-Forwarded-For (o que o próprio proxy acrescentou). */
function ipDoVisitante(req) {
  const direto = req.socket.remoteAddress ?? ''
  if (!PROXY_CONFIAVEL || !ehLocal(direto)) return direto
  const ultimo = String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim()
  return /^[0-9a-fA-F:.]{3,45}$/.test(ultimo) ? ultimo : direto
}
function hostPermitido(req) {
  if (!PAINEL_DOMINIO) return true
  const h = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '')
  return h === PAINEL_DOMINIO || h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

// ------------------------------------------------------------------ senha e TOTP
async function conferirSenha(senha, armazenado) {
  const [alg, N, r, p, sal, hash] = String(armazenado).split('$')
  if (alg !== 'scrypt') return false
  const esperado = Buffer.from(hash, 'base64')
  const calc = await scryptAsync(String(senha).normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length,
    { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  return timingSafeEqual(esperado, calc)
}
export async function gerarHash(senha) {
  const sal = randomBytes(16)
  const h = await scryptAsync(senha.normalize('NFKC'), sal, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', 32768, 8, 1, sal.toString('base64'), h.toString('base64')].join('$')
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32(buf) { let bits = '', s = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) s += B32[parseInt(bits.slice(i, i + 5), 2)]; return s }
function deBase32(s) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) return null; bits += v.toString(2).padStart(5, '0') } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
export const novoSegredoTotp = () => base32(randomBytes(20))
function codigoTotp(segredo, passo) {
  const chave = deBase32(segredo); const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(passo))
  const h = createHmac('sha1', chave).update(msg).digest(); const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}
function conferirTotp(segredo, codigo, ultimo, janela = [0, -1, 1]) {
  if (!/^\d{6}$/.test(String(codigo ?? ''))) return null
  const agora = Math.floor(Date.now() / 30000)
  for (const d of janela) {
    const passo = agora + d
    if (passo > (ultimo ?? 0) && codigoTotp(segredo, passo) === String(codigo)) return passo
  }
  return null
}

// ------------------------------------------------------------------ usuários, sessões, auditoria
const ARQ_USUARIOS = join(DADOS, 'usuarios.json')
const lerUsuarios = () => lerJson(ARQ_USUARIOS, [])
const sessoes = new Map() // hash do token -> { email, expira }
const falhas = new Map()  // email -> { n, ate }
const falhasIp = new Map() // ip -> { n, ate }: limite por origem (além do limite por e-mail)
const LIMITE_IP = 20
const falhasReset = new Map() // e-mail -> { n, ate }: tentativas erradas na redefinição só com o código do autenticador
const pedidosPorChave = new Map() // limite de pedidos de "esqueci minha senha": chave -> instantes
/** true se a chave já passou de `max` pedidos na janela (e registra este pedido). */
function excedeu(chave, max, janelaMs) {
  const agora = Date.now()
  const lista = (pedidosPorChave.get(chave) ?? []).filter((t) => t > agora - janelaMs)
  lista.push(agora); pedidosPorChave.set(chave, lista)
  return lista.length > max
}
// tokens do link "Esqueci minha senha": só o hash fica no disco; valem 1 hora e uma vez
const ARQ_REDEF = join(DADOS, 'redefinicoes.json')
function lerRedefinicoes() {
  const l = lerJson(ARQ_REDEF, {}); const agora = Date.now()
  for (const [k, v] of Object.entries(l)) if (!(v.expira > agora)) delete l[k]
  return l
}
setInterval(() => { // não deixa as tabelas crescerem sem limite
  const agora = Date.now()
  for (const t of [falhas, falhasIp, falhasReset]) for (const [k, v] of t) if (v.ate <= agora && (v.visto ?? 0) < agora - 15 * 60000) t.delete(k)
  for (const [k, v] of sessoes) if (v.expira < agora) sessoes.delete(k)
  for (const [k, l] of pedidosPorChave) if (!l.some((t) => t > agora - 3600000)) pedidosPorChave.delete(k)
}, 10 * 60000).unref()
const hashToken = (t) => createHash('sha256').update(t).digest('hex')
function auditar(quem, acao, detalhes = {}) {
  appendFileSync(join(DADOS, 'auditoria.jsonl'), JSON.stringify({ ...detalhes, em: new Date().toISOString(), quem, acao }) + '\n', { mode: 0o600 })
}
function sessaoDe(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(req.headers.cookie ?? '')
  if (!m) return null
  const s = sessoes.get(hashToken(m[1]))
  if (!s || s.expira < Date.now()) return null
  s.expira = Date.now() + SESSAO_MIN * 60000
  return s
}

// ------------------------------------------------------------------ validação dos pedidos
const RE = {
  nome: /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,'()-]{3,80}$/,
  sub: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
  dominio: /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  email: /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/,
  pessoa: /^[A-Za-zÀ-ÖØ-öø-ÿ .'-]{2,80}$/,
  chave: /^[A-Za-z0-9-]{3,20}$/,
  instancia: /^prefichas-[a-z0-9-]{1,80}$/,
  tokenCf: /^[A-Za-z0-9_-]{20,200}$/,
  hostSmtp: /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  usuarioSmtp: /^[A-Za-z0-9._%+@-]{3,120}$/,
  guid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  segredoMs: /^[A-Za-z0-9._~-]{20,128}$/,   // valor do segredo do aplicativo no Microsoft Entra
  senhaSmtp: /^[A-Za-z0-9._~+=:@%!*,;?/-]{4,128}$/,   // sem aspas, espaços, $, # nem \ (a senha vai para arquivos .env)
}
function validarPedido(c) {
  const acao = c?.acao
  if (acao === 'nova') {
    const e = {}
    if (!RE.nome.test(c.nome ?? '')) e.nome = 'Nome inválido (3 a 80 letras, sem símbolos especiais).'
    if (!['cloudflare', 'direta', 'local'].includes(c.publicacao)) e.publicacao = 'Escolha a publicação.'
    if (c.publicacao === 'cloudflare' && !RE.sub.test(c.subdominio ?? '')) e.subdominio = 'Endereço inválido (letras minúsculas, números e hífen).'
    if (c.publicacao === 'direta' && !RE.dominio.test(String(c.dominio ?? '').toLowerCase())) e.dominio = 'Domínio inválido.'
    if (!RE.email.test(c.admin_email ?? '')) e.admin_email = 'E-mail inválido.'
    if (!RE.pessoa.test(c.admin_nome ?? '')) e.admin_nome = 'Nome inválido.'
    if (c.chave && !RE.chave.test(c.chave)) e.chave = 'Chave inválida.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, nome: c.nome.trim(), publicacao: c.publicacao, subdominio: c.subdominio || '', dominio: String(c.dominio || '').toLowerCase(),
      admin_email: c.admin_email.trim(), admin_nome: c.admin_nome.trim(), chave: c.chave || '' } }
  }
  if (acao === 'atualizar' || acao === 'backup') {
    if (!RE.instancia.test(c.instancia ?? '')) return { erros: { instancia: 'Instância inválida.' } }
    const existe = (lerJson(join(ESTADO, 'instancias.json'), { instancias: [] }).instancias ?? []).some((i) => i.pasta === c.instancia)
    if (!existe) return { erros: { instancia: 'Instância não encontrada.' } }
    return { pedido: { acao, instancia: c.instancia } }
  }
  if (acao === 'microsoft') {
    const e = {}
    if (!RE.instancia.test(c.instancia ?? '')) return { erros: { instancia: 'Instância inválida.' } }
    const existe = (lerJson(join(ESTADO, 'instancias.json'), { instancias: [] }).instancias ?? []).some((i) => i.pasta === c.instancia)
    if (!existe) return { erros: { instancia: 'Instância não encontrada.' } }
    const habilitar = c.habilitar === true, tenant = String(c.tenant_id ?? '').trim(), cliente = String(c.client_id ?? '').trim(), segredo = String(c.segredo ?? '').trim()
    if (habilitar && !RE.guid.test(tenant)) e.tenant_id = 'ID do diretório (locatário) inválido: formato 00000000-0000-0000-0000-000000000000.'
    if (habilitar && !RE.guid.test(cliente)) e.client_id = 'ID do aplicativo (cliente) inválido: formato 00000000-0000-0000-0000-000000000000.'
    if (segredo && !RE.segredoMs.test(segredo)) e.segredo = 'Segredo inválido: copie o VALOR do segredo (não o ID), sem espaços.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, instancia: c.instancia, habilitar, ...(habilitar ? { tenant_id: tenant, client_id: cliente } : {}), ...(segredo ? { segredo } : {}) } }
  }
  if (acao === 'apagar' || acao === 'trocar-link') {
    if (!RE.instancia.test(c.instancia ?? '') || ['prefichas-gerenciador', 'prefichas-proxy', 'prefichas-tunel'].includes(c.instancia)) return { erros: { instancia: 'Instância inválida.' } }
    const existe = (lerJson(join(ESTADO, 'instancias.json'), { instancias: [] }).instancias ?? []).some((i) => i.pasta === c.instancia)
    if (!existe) return { erros: { instancia: 'Instância não encontrada.' } }
    if (acao === 'apagar') {
      // a pessoa digita o nome da pasta para confirmar (evita apagar a instância errada)
      if (c.confirmar !== c.instancia) return { erros: { confirmar: `Digite exatamente ${c.instancia} para confirmar.` } }
      return { pedido: { acao, instancia: c.instancia, confirmar: c.confirmar, sem_backup: c.sem_backup === true } }
    }
    const e = {}
    if (!['cloudflare', 'direta'].includes(c.publicacao)) e.publicacao = 'Escolha Cloudflare ou domínio próprio.'
    if (c.publicacao === 'cloudflare' && !RE.sub.test(c.subdominio ?? '')) e.subdominio = 'Endereço inválido (letras minúsculas, números e hífen).'
    if (c.publicacao === 'direta' && !RE.dominio.test(String(c.dominio ?? '').toLowerCase())) e.dominio = 'Domínio inválido.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, instancia: c.instancia, publicacao: c.publicacao, subdominio: c.publicacao === 'cloudflare' ? c.subdominio : '', dominio: c.publicacao === 'direta' ? String(c.dominio).toLowerCase() : '' } }
  }
  if (acao === 'atualizar-todas' || acao === 'atualizar-painel') return { pedido: { acao } }
  if (acao === 'cloudflare') {
    const e = {}
    const token = String(c.token ?? '').trim()
    const base = String(c.dominio_base ?? '').trim().toLowerCase()
    // token vazio = só trocar o domínio base (o token já guardado continua valendo)
    if (token && !RE.tokenCf.test(token)) e.token = 'Token inválido: confira se copiou o token inteiro, sem espaços (só letras, números, "-" e "_").'
    if (!RE.dominio.test(base)) e.dominio_base = 'Domínio inválido (ex.: movimentocampista.com.br).'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, dominio_base: base, ...(token ? { token } : {}) } }
  }
  if (acao === 'cloudflare-remover') return { pedido: { acao } }
  if (acao === 'vpn-reconectar') return { pedido: { acao } }
  if (acao === 'vpn-senha') {
    const senha = typeof c.senha === 'string' ? c.senha : ''
    if (!senha || senha.length > 128 || /[\u0000-\u001f\u007f]/.test(senha)) return { erros: { senha: 'Informe a senha da VPN (até 128 caracteres, sem quebra de linha).' } }
    return { pedido: { acao, senha } }
  }
  if (acao === 'vpn-config') {
    const e = {}
    const perfil = String(c.perfil ?? '').trim(), usuario = String(c.usuario ?? '').trim()
    const redes = String(c.redes ?? '').replace(/\s+/g, '').split(/[,;]/).filter(Boolean)
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(perfil)) e.perfil = 'Nome do perfil inválido (letras, números, ponto, hífen e sublinhado).'
    if (!redes.length || redes.length > 16 || !redes.every((r) => /^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/.test(r) && r.split('/')[0].split('.').every((o) => Number(o) <= 255))) e.redes = 'Informe as redes internas no formato 192.168.10.0/24 (separe várias por vírgula).'
    else if (redes.some((r) => r.endsWith('/0'))) e.redes = 'Todo o tráfego pela VPN (/0) derrubaria o site. Peça split tunnel ao analista.'
    if (usuario && !/^[A-Za-z0-9@._-]{1,128}$/.test(usuario)) e.usuario = 'Usuário inválido.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, perfil, redes: redes.join(','), usuario } }
  }
  if (acao === 'email') {
    const e = {}
    const host = String(c.host ?? '').trim().toLowerCase()
    const porta = Number(c.porta)
    const usuario = String(c.usuario ?? '').trim()
    const senha = String(c.senha ?? '').replace(/\s/g, '')   // senhas de app do Google vêm com espaços
    const remetente = String(c.remetente ?? '').trim() || (RE.email.test(usuario) ? usuario : '')
    if (!RE.hostSmtp.test(host)) e.host = 'Servidor inválido (ex.: smtp.gmail.com).'
    if (![25, 465, 587, 2525].includes(porta)) e.porta = 'Porta inválida. Use 465 (SSL) ou 587 (STARTTLS).'
    if (!RE.usuarioSmtp.test(usuario)) e.usuario = 'Usuário inválido (normalmente é o seu e-mail).'
    // senha em branco = manter a que já está guardada (o executor confere se existe)
    if (senha && !RE.senhaSmtp.test(senha)) e.senha = 'Senha inválida: use só letras, números e . _ ~ + = : @ % ! * , ; ? / - (sem espaços nem aspas).'
    if (!RE.email.test(remetente)) e.remetente = 'E-mail do remetente inválido.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, host, porta, usuario, remetente, aplicar: c.aplicar === true, ...(senha ? { senha } : {}) } }
  }
  if (acao === 'email-teste' || acao === 'email-remover' || acao === 'email-aplicar' || acao === 'tunel-unificar' || acao === 'tunel-religar') return { pedido: { acao } }
  // ---- backup na nuvem (OneDrive) e mensagens de aniversário (textbee): só o painel da VM mexe nisso
  const instanciaExiste = (i) => RE.instancia.test(i ?? '') && (lerJson(join(ESTADO, 'instancias.json'), { instancias: [] }).instancias ?? []).some((x) => x.pasta === i)
  const hora = (v) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(v ?? ''))
  if (['backup-conectar', 'backup-desconectar', 'backup-chave-guardada', 'backup-listar'].includes(acao)) return { pedido: { acao } }
  if (acao === 'backup-chave-gerar') return { pedido: { acao, substituir: c.substituir === true } }
  if (acao === 'backup-config') {
    const e = {}
    const t = String(c.tenant_id ?? '').trim(), cl = String(c.client_id ?? '').trim()
    if (!hora(c.hora)) e.hora = 'Horário inválido (HH:MM).'
    if ((t || cl) && !(RE.guid.test(t) && RE.guid.test(cl))) e.tenant_id = 'Informe o ID do diretório e o ID do aplicativo (formato 00000000-0000-0000-0000-000000000000).'
    const md = Number(c.manter_diarios ?? 14), mm = Number(c.manter_mensais ?? 6)
    if (!Number.isInteger(md) || md < 3 || md > 90) e.manter_diarios = 'De 3 a 90.'
    if (!Number.isInteger(mm) || mm < 0 || mm > 24) e.manter_mensais = 'De 0 a 24.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, ligado: c.ligado === true, hora: c.hora, tenant_id: t, client_id: cl, manter_diarios: md, manter_mensais: mm } }
  }
  if (acao === 'backup-nuvem') {
    if (c.instancia && !instanciaExiste(c.instancia)) return { erros: { instancia: 'Instância não encontrada.' } }
    return { pedido: { acao, ...(c.instancia ? { instancia: c.instancia } : {}) } }
  }
  if (acao === 'backup-restaurar') {
    const e = {}
    if (!instanciaExiste(c.instancia)) e.instancia = 'Instância não encontrada (crie a instância antes de restaurar nela).'
    if (c.confirmar !== c.instancia) e.confirmar = `Digite exatamente ${c.instancia} para confirmar.`
    if (!/^[A-Za-z0-9!_.-]{4,200}$/.test(c.arquivo ?? '') || !/^prefichas-[a-z0-9-]{1,80}__\d{4}-\d{2}-\d{2}_\d{4}\.dump\.age$/.test(c.nome ?? '')) e.arquivo = 'Escolha um backup da lista.'
    const chave = String(c.chave ?? '').trim()
    if (!/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/.test(chave)) e.chave = 'Chave de recuperação inválida: cole a linha inteira, que começa com AGE-SECRET-KEY-1.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, instancia: c.instancia, confirmar: c.confirmar, arquivo: c.arquivo, nome: c.nome, chave } }
  }
  const foneValido = (v) => /^\+?[0-9 ()-]{10,20}$/.test(String(v ?? '')) && String(v).replace(/\D/g, '').length >= 10
  if (acao === 'sms-config') {
    const e = {}
    if (!hora(c.hora)) e.hora = 'Horário inválido (HH:MM).'
    const lim = Number(c.limite_dia ?? 200)
    if (!Number.isInteger(lim) || lim < 1 || lim > 10000) e.limite_dia = 'De 1 a 10000.'
    for (const k of ['modelo_aniversario', 'modelo_acampamento']) if (String(c[k] ?? '').length > 480) e[k] = 'Máximo de 480 letras.'
    if (c.device_id && !/^[A-Za-z0-9_-]{6,64}$/.test(c.device_id)) e.device_id = 'ID do aparelho inválido.'
    const token = String(c.token ?? '').trim()
    if (token && !/^[A-Za-z0-9._-]{16,200}$/.test(token)) e.token = 'Chave da API inválida.'
    if (c.telefone_teste && !foneValido(c.telefone_teste)) e.telefone_teste = 'Telefone inválido.'
    if (Object.keys(e).length) return { erros: e }
    return { pedido: { acao, ligado: c.ligado === true, hora: c.hora, limite_dia: lim, modelo_aniversario: String(c.modelo_aniversario ?? '').trim(), modelo_acampamento: String(c.modelo_acampamento ?? '').trim(),
      rodape_sair: c.rodape_sair !== false, device_id: String(c.device_id ?? '').trim(), telefone_teste: String(c.telefone_teste ?? '').trim(), ...(token ? { token } : {}) } }
  }
  if (acao === 'sms-enviar') return { pedido: { acao, previa: c.previa === true } }
  if (acao === 'sms-teste' || acao === 'sms-bloqueio') {
    if (!foneValido(c.telefone)) return { erros: { telefone: 'Telefone inválido (com DDD).' } }
    return { pedido: { acao, telefone: String(c.telefone).trim(), ...(acao === 'sms-bloqueio' ? { bloquear: c.bloquear !== false } : {}) } }
  }
  return { erros: { acao: 'Ação desconhecida.' } }
}

// ------------------------------------------------------------------ HTTP
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  ...(COOKIE_SEGURO ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
}
function responder(res, codigo, corpo, extra = {}) {
  res.writeHead(codigo, { ...CABECALHOS, 'Content-Type': 'application/json; charset=utf-8', ...extra })
  res.end(JSON.stringify(corpo))
}
async function lerCorpo(req) {
  let tam = 0; const partes = []
  for await (const p of req) { tam += p.length; if (tam > 32 * 1024) throw new Error('grande'); partes.push(p) }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') } catch { return {} }
}

const servidor = createServer(async (req, res) => {
  const ip = ipDoVisitante(req)
  if (!permitido(req.socket.remoteAddress ?? '')) { res.writeHead(403, CABECALHOS); return res.end('Acesso negado.') }
  if (!hostPermitido(req)) { res.writeHead(421, CABECALHOS); return res.end('Endereço não atendido.') }
  const url = new URL(req.url, 'http://x')
  try {
    // ---------- arquivos do painel
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const nome = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (!/^[a-z0-9-]+\.(html|js|css|svg)$/.test(nome)) { res.writeHead(404, CABECALHOS); return res.end() }
      const arq = join(RAIZ, 'publico', nome)
      if (!existsSync(arq)) { res.writeHead(404, CABECALHOS); return res.end() }
      res.writeHead(200, { ...CABECALHOS, 'Content-Type': TIPOS[extname(nome)] })
      return res.end(readFileSync(arq))
    }
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') return responder(res, 403, { mensagem: 'Requisição recusada.' })

    // ---------- esqueci minha senha (sem login): o link vai por e-mail, enviado pelo executor do servidor
    if (req.method === 'POST' && url.pathname === '/api/esqueci') {
      const c = await lerCorpo(req)
      const email = String(c.email ?? '').trim().toLowerCase().slice(0, 200)
      const resposta = { ok: true, mensagem: 'Se houver um usuário com este e-mail, enviamos um link para redefinir a senha. Confira também a caixa de spam.' }
      if (excedeu(`esq-ip:${ip}`, 5, 15 * 60000)) return responder(res, 429, { mensagem: 'Muitos pedidos. Aguarde alguns minutos.' })
      const cfgEmail = lerJson(join(ESTADO, 'configuracoes.json'), {}).email
      if (!PAINEL_DOMINIO || !cfgEmail?.configurado) {
        return responder(res, 503, { mensagem: 'A recuperação de senha por e-mail ainda não está configurada neste servidor. Peça a quem administra o servidor uma senha nova (comando nova-senha).' })
      }
      if (!RE.email.test(email)) return responder(res, 200, resposta)
      const u = lerUsuarios().find((x) => x.email === email && x.ativo !== false)
      const pendentes = readdirSync(PEDIDOS).filter((f) => f.endsWith('.json')).length
      if (!u || pendentes >= 30 || excedeu(`esq-em:${email}`, 3, 3600000)) return responder(res, 200, resposta)
      const reg = lerRedefinicoes()
      for (const [k, v] of Object.entries(reg)) if (v.email === email) delete reg[k]   // um link por vez
      const token = randomBytes(32).toString('base64url')
      reg[hashToken(token)] = { email, expira: Date.now() + 3600000 }
      gravarJson(ARQ_REDEF, reg)
      gravarJson(join(PEDIDOS, `${randomUUID()}.json`), {
        acao: 'email-redefinicao', para: email, por: email, pedido_em: new Date().toISOString(),
        link: `https://${PAINEL_DOMINIO}/?redefinir=${token}`,
      })
      auditar(email, 'esqueci-senha', { ip })
      return responder(res, 200, resposta)
    }
    // ---------- esqueci minha senha SEM e-mail: e-mail + código ATUAL do autenticador + senha nova, tudo nesta tela.
    // O código passa a ser a única barreira deste caminho, então ele é endurecido: só vale o código atual e o anterior,
    // o código é de uso único, 3 erros travam a redefinição daquele usuário por 1 hora (o login normal não é afetado) e
    // trocar a senha derruba todas as sessões. Desligar: REDEFINIR_POR_MFA=false.
    if (req.method === 'POST' && url.pathname === '/api/redefinir-mfa') {
      if (process.env.REDEFINIR_POR_MFA === 'false') return responder(res, 404, { mensagem: 'Não encontrado.' })
      const c = await lerCorpo(req)
      if (excedeu(`rmfa-ip:${ip}`, 10, 15 * 60000)) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      const email = String(c.email ?? '').trim().toLowerCase().slice(0, 200)
      const senha = String(c.senha ?? '')
      if (senha.length < 12 || senha.length > 200) return responder(res, 400, { mensagem: 'A senha nova deve ter de 12 a 200 caracteres.' })
      const f = falhasReset.get(email)
      if (f && f.ate > Date.now()) {
        return responder(res, 429, { mensagem: 'Muitas tentativas para este usuário. Aguarde 1 hora ou peça a quem administra o servidor uma senha nova (comando nova-senha).' })
      }
      const u0 = lerUsuarios().find((x) => x.email === email && x.ativo !== false)
      // usuário inexistente e código errado dão exatamente a mesma resposta
      const passo = u0 ? conferirTotp(u0.totp, c.codigo, u0.totp_ultimo, [0, -1]) : null
      if (passo === null) {
        const n = (f && f.ate && f.ate <= Date.now() ? 0 : (f?.n ?? 0)) + 1
        falhasReset.set(email, { n, ate: n >= 3 ? Date.now() + 3600000 : 0, visto: Date.now() })
        auditar(email || '(vazio)', 'redefinicao-mfa-recusada', { ip })
        return responder(res, 401, { mensagem: 'E-mail ou código do autenticador incorretos.' })
      }
      // consome o código ANTES de qualquer espera: dois pedidos com o mesmo código não passam os dois
      const usuarios1 = lerUsuarios(); const u1 = usuarios1.find((x) => x.email === email)
      if (!(passo > (u1.totp_ultimo ?? 0))) return responder(res, 401, { mensagem: 'E-mail ou código do autenticador incorretos.' })
      u1.totp_ultimo = passo; gravarJson(ARQ_USUARIOS, usuarios1)
      const hash = await gerarHash(senha)
      const usuarios = lerUsuarios(); const u = usuarios.find((x) => x.email === email)
      u.senha = hash
      gravarJson(ARQ_USUARIOS, usuarios)
      for (const [k, v] of sessoes) if (v.email === email) sessoes.delete(k)   // sai de todos os aparelhos
      falhasReset.delete(email); falhas.delete(email)
      auditar(email, 'senha-redefinida-mfa', { ip })
      return responder(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/redefinir') {
      const c = await lerCorpo(req)
      if (excedeu(`red-ip:${ip}`, 10, 15 * 60000)) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      const senha = String(c.senha ?? '')
      if (senha.length < 12 || senha.length > 200) return responder(res, 400, { mensagem: 'A senha deve ter de 12 a 200 caracteres.' })
      const invalido = () => responder(res, 400, { mensagem: 'Link inválido ou vencido. Peça um novo em "Esqueci minha senha".' })
      const token = String(c.token ?? '')
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return invalido()
      const reg = lerRedefinicoes(); const chave = hashToken(token)
      const entrada = reg[chave]
      if (!entrada) return invalido()
      const u0 = lerUsuarios().find((x) => x.email === entrada.email && x.ativo !== false)
      if (!u0) return invalido()
      const f = falhas.get(u0.email)
      if (f && f.ate > Date.now()) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      // o link do e-mail sozinho não basta: o código do autenticador continua obrigatório
      const passo = conferirTotp(u0.totp, c.codigo, u0.totp_ultimo)
      if (passo === null) {
        const n = (f && f.ate && f.ate <= Date.now() ? 0 : (f?.n ?? 0)) + 1
        falhas.set(u0.email, { n, ate: n >= 5 ? Date.now() + 15 * 60000 : 0, visto: Date.now() })
        auditar(u0.email, 'redefinicao-recusada', { ip })
        return responder(res, 401, { mensagem: 'Código do autenticador incorreto ou já usado. Confira o aplicativo e tente de novo.' })
      }
      delete reg[chave]; gravarJson(ARQ_REDEF, reg)   // consome o link antes de qualquer espera: uso único
      const hash = await gerarHash(senha)
      const usuarios = lerUsuarios(); const u = usuarios.find((x) => x.email === u0.email)
      u.senha = hash; u.totp_ultimo = passo
      gravarJson(ARQ_USUARIOS, usuarios)
      for (const [k, v] of sessoes) if (v.email === u.email) sessoes.delete(k)   // sai de todos os aparelhos
      falhas.delete(u.email)
      auditar(u.email, 'senha-redefinida', { ip })
      return responder(res, 200, { ok: true })
    }

    // ---------- login
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const c = await lerCorpo(req)
      const email = String(c.email ?? '').trim().toLowerCase().slice(0, 200)
      const fi = falhasIp.get(ip)
      if (fi && fi.ate > Date.now()) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      const f = falhas.get(email)
      if (f && f.ate > Date.now()) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      const usuarios = lerUsuarios()
      const u = usuarios.find((x) => x.email === email && x.ativo !== false)
      const okSenha = u ? await conferirSenha(String(c.senha ?? '').slice(0, 200), u.senha) : (await gerarHash('x'), false)
      const passo = okSenha ? conferirTotp(u.totp, c.codigo, u.totp_ultimo) : null
      if (!okSenha || passo === null) {
        // conta as falhas; depois de um bloqueio vencido, recomeça do zero
        const n = (f && f.ate && f.ate <= Date.now() ? 0 : (f?.n ?? 0)) + 1
        falhas.set(email, { n, ate: n >= 5 ? Date.now() + 15 * 60000 : 0, visto: Date.now() })
        const ni = (fi && fi.ate && fi.ate <= Date.now() ? 0 : (fi?.n ?? 0)) + 1
        falhasIp.set(ip, { n: ni, ate: ni >= LIMITE_IP ? Date.now() + 15 * 60000 : 0, visto: Date.now() })
        auditar(email || '(vazio)', 'login-recusado', { ip })
        return responder(res, 401, { mensagem: 'E-mail, senha ou código incorretos.' })
      }
      falhas.delete(email); falhasIp.delete(ip)
      u.totp_ultimo = passo; u.ultimo_login = new Date().toISOString()
      gravarJson(ARQ_USUARIOS, usuarios)
      const token = randomBytes(32).toString('base64url')
      sessoes.set(hashToken(token), { email, expira: Date.now() + SESSAO_MIN * 60000 })
      auditar(email, 'login', { ip })
      return responder(res, 200, { ok: true, email }, {
        'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSAO_MIN * 60}${COOKIE_SEGURO ? '; Secure' : ''}`,
      })
    }

    const s = sessaoDe(req)
    if (url.pathname === '/api/eu') return responder(res, 200, { email: s?.email ?? null })
    if (!s) return responder(res, 401, { mensagem: 'Entre para continuar.' })

    if (req.method === 'POST' && url.pathname === '/api/sair') {
      const m = new RegExp(`${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.cookie ?? '')
      if (m) sessoes.delete(hashToken(m[1]))
      auditar(s.email, 'sair')
      return responder(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${COOKIE_SEGURO ? '; Secure' : ''}` })
    }
    if (req.method === 'GET' && url.pathname === '/api/instancias') {
      return responder(res, 200, {
        ...lerJson(join(ESTADO, 'instancias.json'), { instancias: [] }),
        servidor: lerJson(join(ESTADO, 'servidor.json'), null),
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/configuracoes') {
      // só a situação (configurado ou não); o token em si nunca volta para o navegador
      return responder(res, 200, lerJson(join(ESTADO, 'configuracoes.json'), { cloudflare: { token_configurado: null } }))
    }
    // backup na nuvem e mensagens: arquivos de estado publicados pelo executor (nada de segredo, exceto a chave mostrada uma vez)
    const ESTADOS_LIVRES = { '/api/backups': 'backups-nuvem.json', '/api/nuvem-codigo': 'nuvem-codigo.json', '/api/sms-previa': 'sms-previa.json' }
    if (req.method === 'GET' && ESTADOS_LIVRES[url.pathname]) return responder(res, 200, lerJson(join(ESTADO, ESTADOS_LIVRES[url.pathname]), {}) ?? {})
    if (req.method === 'GET' && url.pathname === '/api/backup-chave') {
      const k = lerJson(join(ESTADO, 'backup-chave.json'), {}) ?? {}
      const valida = k.chave && Date.parse(k.expira) > Date.now()
      if (valida) auditar(s.email, 'viu-chave-backup', {})
      return responder(res, 200, valida ? { chave: k.chave, expira: k.expira } : {})
    }
    if (req.method === 'GET' && url.pathname === '/api/sms-historico') {
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('dia') ?? '') ? url.searchParams.get('dia') : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      const arq = join(ESTADO, 'sms', `${dia}.jsonl`)
      const linhas = existsSync(arq) ? readFileSync(arq, 'utf8').split('\n').filter(Boolean).slice(-2000).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
      return responder(res, 200, { dia, mensagens: linhas })
    }
    if (req.method === 'GET' && url.pathname === '/api/vpn') {
      return responder(res, 200, lerJson(join(ESTADO, 'vpn.json'), { configurada: null }))
    }
    if (req.method === 'GET' && url.pathname === '/api/tarefas') {
      const dir = join(ESTADO, 'tarefas')
      const lista = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => lerJson(join(dir, f))).filter(Boolean).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).slice(0, 30) : []
      const pendentes = readdirSync(PEDIDOS).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.slice(0, -5), situacao: 'na fila', ...lerJson(join(PEDIDOS, f), {}) }))
      for (const p of pendentes) { delete p.chave; delete p.token; delete p.psk; delete p.senha; delete p.segredo; delete p.link; delete p.telefone_teste
        if (p.telefone) p.telefone = String(p.telefone).replace(/\D/g, '').replace(/^(\d{4})\d+(\d{4})$/, '$1••••$2') }
      return responder(res, 200, { pendentes, tarefas: lista })
    }
    const mt = /^\/api\/tarefas\/([a-z0-9-]{8,40})$/.exec(url.pathname)
    if (req.method === 'GET' && mt) {
      const t = lerJson(join(ESTADO, 'tarefas', `${mt[1]}.json`))
      if (!t) return responder(res, 404, { mensagem: 'Tarefa não encontrada.' })
      return responder(res, 200, { ...t, log: ultimasLinhas(join(ESTADO, 'tarefas', `${mt[1]}.log`), 80) })
    }
    if (req.method === 'POST' && url.pathname === '/api/tarefas') {
      const { pedido, erros } = validarPedido(await lerCorpo(req))
      if (erros) return responder(res, 400, { mensagem: 'Confira os campos.', erros })
      const id = randomUUID()
      const dados = { ...pedido, por: s.email, pedido_em: new Date().toISOString() }
      gravarJson(join(PEDIDOS, `${id}.json`), dados)
      const { chave, token, psk, senha, segredo, ...semChave } = dados // eslint-disable-line no-unused-vars
      if (token) semChave.token = '(informado, não registrado)'
      if (psk || senha || segredo) semChave.credenciais = '(informadas, não registradas)'
      if (semChave.telefone) semChave.telefone = String(semChave.telefone).replace(/\D/g, '').replace(/^(\d{4})\d+(\d{4})$/, '$1••••$2')
      if (semChave.telefone_teste) semChave.telefone_teste = '(informado)'
      auditar(s.email, `pedido-${pedido.acao}`, { id, ...semChave })
      return responder(res, 201, { id })
    }
    if (req.method === 'GET' && url.pathname === '/api/auditoria') {
      const linhas = ultimasLinhas(join(DADOS, 'auditoria.jsonl'), 300).split('\n').filter(Boolean)
      return responder(res, 200, linhas.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse())
    }
    return responder(res, 404, { mensagem: 'Não encontrado.' })
  } catch (e) {
    console.error(e)
    return responder(res, 500, { mensagem: 'Erro interno.' })
  }
})

// limpeza de sessões vencidas
setInterval(() => { const agora = Date.now(); for (const [k, v] of sessoes) if (v.expira < agora) sessoes.delete(k) }, 60000).unref()

if (process.argv[1] && process.argv[1].endsWith('servidor.mjs')) {
  if (!existsSync(ARQ_USUARIOS)) console.warn('Nenhum usuário. Crie com: node cli.mjs criar-usuario EMAIL')
  try { statSync(PEDIDOS); statSync(ESTADO) } catch { console.error('Pastas de pedidos/estado não encontradas.'); process.exit(1) }
  servidor.listen(PORTA, ESCUTAR, () => console.log(`Painel central em http://${ESCUTAR}:${PORTA} (redes permitidas: ${REDES.join(', ')})`))
}
export { servidor, validarPedido, permitido, conferirTotp, codigoTotp, ipDoVisitante }
