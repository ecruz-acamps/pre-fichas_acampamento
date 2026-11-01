// Comunicação com o atualizador do servidor (scripts/atualizador-servico.sh).
// O site NÃO executa nada no servidor: apenas grava um pedido na pasta
// atualizacao/ e lê o andamento que o atualizador escreve ali.
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
  const instalacao = lerJson(join(pasta, 'atualizador.json'))
  return {
    instalado: Boolean(instalacao),
    instalacao,
    pendente: existsSync(join(pasta, 'solicitar')),
    estado: lerJson(join(pasta, 'estado.json')),
    pedido: lerJson(join(pasta, 'pedido.json')),
    log: ultimasLinhas(join(pasta, 'log.txt'), 40),
  }
}

/** Grava o pedido de atualização. Retorna { ok } ou { erro }. */
export function solicitarAtualizacao(pasta, usuario) {
  const s = estadoAtualizador(pasta)
  if (!s.instalado) {
    return { erro: 'A atualização pelo painel não está ativada neste servidor. Rode uma vez: sudo ./scripts/instalar-atualizador.sh' }
  }
  if (s.pendente || ['solicitado', 'executando'].includes(s.estado?.etapa)) {
    return { erro: 'Já existe uma atualização em andamento.', emAndamento: true }
  }
  const agora = new Date().toISOString()
  try {
    gravar(join(pasta, 'pedido.json'), JSON.stringify({ usuario: usuario.nome, email: usuario.email, em: agora }))
    gravar(join(pasta, 'estado.json'), JSON.stringify({ etapa: 'solicitado', sucesso: null, mensagem: 'Aguardando o servidor', atualizado_em: agora }))
    gravar(join(pasta, 'log.txt'), '')
    writeFileSync(join(pasta, 'solicitar'), agora) // por último: é o que dispara o atualizador
  } catch (e) {
    return { erro: `Não foi possível registrar o pedido (${e.code ?? e.message}). Verifique as permissões da pasta atualizacao/.` }
  }
  return { ok: true }
}
