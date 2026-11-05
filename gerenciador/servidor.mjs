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
function conferirTotp(segredo, codigo, ultimo) {
  if (!/^\d{6}$/.test(String(codigo ?? ''))) return null
  const agora = Math.floor(Date.now() / 30000)
  for (const d of [0, -1, 1]) {
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
  return { erros: { acao: 'Ação desconhecida.' } }
}

// ------------------------------------------------------------------ HTTP
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
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
  const ip = req.socket.remoteAddress ?? ''
  if (!permitido(ip)) { res.writeHead(403, CABECALHOS); return res.end('Acesso negado.') }
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

    // ---------- login
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const c = await lerCorpo(req)
      const email = String(c.email ?? '').trim().toLowerCase().slice(0, 200)
      const f = falhas.get(email)
      if (f && f.ate > Date.now()) return responder(res, 429, { mensagem: 'Muitas tentativas. Aguarde 15 minutos.' })
      const usuarios = lerUsuarios()
      const u = usuarios.find((x) => x.email === email && x.ativo !== false)
      const okSenha = u ? await conferirSenha(String(c.senha ?? '').slice(0, 200), u.senha) : (await gerarHash('x'), false)
      const passo = okSenha ? conferirTotp(u.totp, c.codigo, u.totp_ultimo) : null
      if (!okSenha || passo === null) {
        // conta as falhas; depois de um bloqueio vencido, recomeça do zero
        const n = (f && f.ate && f.ate <= Date.now() ? 0 : (f?.n ?? 0)) + 1
        falhas.set(email, { n, ate: n >= 5 ? Date.now() + 15 * 60000 : 0 })
        auditar(email || '(vazio)', 'login-recusado', { ip })
        return responder(res, 401, { mensagem: 'E-mail, senha ou código incorretos.' })
      }
      falhas.delete(email)
      u.totp_ultimo = passo; u.ultimo_login = new Date().toISOString()
      gravarJson(ARQ_USUARIOS, usuarios)
      const token = randomBytes(32).toString('base64url')
      sessoes.set(hashToken(token), { email, expira: Date.now() + SESSAO_MIN * 60000 })
      auditar(email, 'login', { ip })
      return responder(res, 200, { ok: true, email }, {
        'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSAO_MIN * 60}${process.env.COOKIE_SEGURO === 'true' ? '; Secure' : ''}`,
      })
    }

    const s = sessaoDe(req)
    if (url.pathname === '/api/eu') return responder(res, 200, { email: s?.email ?? null })
    if (!s) return responder(res, 401, { mensagem: 'Entre para continuar.' })

    if (req.method === 'POST' && url.pathname === '/api/sair') {
      const m = new RegExp(`${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.cookie ?? '')
      if (m) sessoes.delete(hashToken(m[1]))
      auditar(s.email, 'sair')
      return responder(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` })
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
    if (req.method === 'GET' && url.pathname === '/api/tarefas') {
      const dir = join(ESTADO, 'tarefas')
      const lista = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => lerJson(join(dir, f))).filter(Boolean).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).slice(0, 30) : []
      const pendentes = readdirSync(PEDIDOS).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.slice(0, -5), situacao: 'na fila', ...lerJson(join(PEDIDOS, f), {}) }))
      for (const p of pendentes) { delete p.chave; delete p.token }
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
      const { chave, token, ...semChave } = dados // eslint-disable-line no-unused-vars
      if (token) semChave.token = '(informado, não registrado)'
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
export { servidor, validarPedido, permitido, conferirTotp, codigoTotp }
