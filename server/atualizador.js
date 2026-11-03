// Comunicação com o atualizador do servidor (scripts/atualizador-servico.sh).
// O site NÃO executa nada no servidor:
//   - grava o pedido em atualizacao/pedido/ (única pasta em que pode escrever);
//   - lê o andamento em atualizacao/estado/ (pasta do root, somente leitura para o site).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const lerJson = (c) => { try { return JSON.parse(readFileSync(c, 'utf8')) } catch { return null } }
const ultimasLinhas = (c, n) => {
  try { return readFileSync(c, 'utf8').split('\n').filter(Boolean).slice(-n) } catch { return [] }
}

function gravar(caminho, conteudo) {
  const tmp = `${caminho}.tmp`
  writeFileSync(tmp, conteudo)
  renameSync(tmp, caminho)
}

export function estadoAtualizador(pasta) {
  if (!pasta) return { instalado: false }
  const estadoDir = join(pasta, 'estado')
  const pedidoDir = join(pasta, 'pedido')
  const instalacao = lerJson(join(estadoDir, 'atualizador.json'))
  const pendente = existsSync(join(pedidoDir, 'solicitar'))
  let estado = lerJson(join(estadoDir, 'estado.json'))
  // Pedido feito e o atualizador ainda não começou
  if (pendente && estado?.etapa !== 'executando') {
    const pedido = lerJson(join(pedidoDir, 'pedido.json'))
    estado = { etapa: 'solicitado', sucesso: null, mensagem: 'Aguardando o servidor', atualizado_em: pedido?.em ?? null }
  }
  return {
    instalado: Boolean(instalacao),
    instalacao,
    pendente,
    estado,
    log: estado?.etapa === 'solicitado' ? [] : ultimasLinhas(join(estadoDir, 'log.txt'), 40),
  }
}

/** Grava o pedido de atualização. Retorna { ok } ou { erro }. */
export function solicitarAtualizacao(pasta, usuario) {
  const s = estadoAtualizador(pasta)
  if (!s.instalado) {
    return { erro: 'A atualização pelo painel não está ativada neste servidor. Rode uma vez: sudo ./scripts/instalar-atualizador.sh' }
  }
  if (s.pendente || s.estado?.etapa === 'executando') {
    return { erro: 'Já existe uma atualização em andamento.', emAndamento: true }
  }
  const agora = new Date().toISOString()
  const pedidoDir = join(pasta, 'pedido')
  try {
    gravar(join(pedidoDir, 'pedido.json'), JSON.stringify({ usuario: usuario.nome, email: usuario.email, em: agora }))
    writeFileSync(join(pedidoDir, 'solicitar'), agora) // por último: é o que dispara o atualizador
  } catch (e) {
    return { erro: `Não foi possível registrar o pedido (${e.code ?? e.message}). Verifique as permissões da pasta atualizacao/pedido/.` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- publicação na internet
/** Situação da publicação pela Cloudflare (escrita pelo servidor em estado/publicacao.json). */
export function estadoPublicacao(pasta) {
  if (!pasta) return { disponivel: false }
  const estadoDir = join(pasta, 'estado')
  const instalacao = lerJson(join(estadoDir, 'atualizador.json'))
  const ultimo = lerJson(join(estadoDir, 'publicacao.json'))
  const executando = existsSync(join(estadoDir, 'publicacao-andamento.json'))
  const pendente = existsSync(join(pasta, 'pedido', 'publicar'))
  return {
    disponivel: Boolean(instalacao?.publicacao),
    ativo: ultimo?.ativo ?? false,
    endereco: ultimo?.endereco || null,
    tokenConfigurado: ultimo?.token_configurado ?? null,
    ultimo,
    andamento: pendente || executando,
    log: ultimasLinhas(join(estadoDir, 'log-publicacao.txt'), 30),
  }
}

const SUBDOMINIO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const TOKEN_CF = /^[A-Za-z0-9_-]{20,200}$/

/** Grava o pedido para o servidor ligar/desligar a publicação. */
export function solicitarPublicacao(pasta, { ativo, subdominio, token }) {
  const s = estadoPublicacao(pasta)
  if (!s.disponivel) {
    return { erro: 'Esta instalação ainda não aceita ligar a publicação pelo painel. Atualize o sistema (botão Atualizações) e tente de novo.' }
  }
  if (s.andamento) return { erro: 'Já existe uma alteração da publicação em andamento.' }
  if (typeof ativo !== 'boolean') return { erro: 'Escolha ligar ou desligar.' }
  const sub = typeof subdominio === 'string' ? subdominio.trim().toLowerCase() : ''
  if (ativo && !SUBDOMINIO.test(sub)) return { erro: 'Endereço inválido: use letras minúsculas, números e hífen (ex.: sao-pedro).' }
  const tok = typeof token === 'string' ? token.trim() : ''
  if (tok && !TOKEN_CF.test(tok)) return { erro: 'Token da Cloudflare em formato inválido.' }
  if (ativo && !tok && s.tokenConfigurado === false) return { erro: 'Informe o token da API da Cloudflare (só na primeira vez).' }
  const pedidoDir = join(pasta, 'pedido')
  try {
    gravar(join(pedidoDir, 'publicacao.json'), JSON.stringify({ ativo, subdominio: ativo ? sub : '', ...(tok ? { token: tok } : {}) }))
    writeFileSync(join(pedidoDir, 'publicar'), new Date().toISOString())
  } catch (e) {
    return { erro: `Não foi possível registrar o pedido (${e.code ?? e.message}).` }
  }
  return { ok: true }
}
