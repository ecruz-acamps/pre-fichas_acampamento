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
