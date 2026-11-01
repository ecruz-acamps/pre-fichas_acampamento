// Versão instalada × versão mais recente no GitHub.
//
// Versão instalada = commit do Git a partir do qual o sistema foi gerado:
//   1) arquivo versao.json (gravado no build do Docker / pelo scripts/atualizar.sh);
//   2) senão, lido direto da pasta .git (instalação sem Docker).
// Versão disponível = último commit da branch configurada no GitHub (API pública).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const SHA = /^[0-9a-f]{40}$/

function lerJson(caminho) {
  try { return JSON.parse(readFileSync(caminho, 'utf8')) } catch { return null }
}

/** Lê o commit atual direto da pasta .git (sem precisar do programa git). */
function commitDoGit(raiz) {
  try {
    const git = join(raiz, '.git')
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim()
    if (SHA.test(head)) return { commit: head, branch: null }
    const ref = head.replace(/^ref:\s*/, '')
    let commit = null
    try { commit = readFileSync(join(git, ref), 'utf8').trim() } catch {
      const packed = readFileSync(join(git, 'packed-refs'), 'utf8')
      commit = packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] ?? null
    }
    return SHA.test(commit ?? '') ? { commit, branch: ref.replace('refs/heads/', '') } : null
  } catch {
    return null
  }
}

export function lerVersaoInstalada(raiz = RAIZ) {
  const pacote = lerJson(join(raiz, 'package.json'))
  const arquivo = lerJson(join(raiz, 'versao.json'))
  const doArquivo = SHA.test(arquivo?.commit ?? '') ? arquivo : null
  const git = doArquivo ? null : commitDoGit(raiz)
  return {
    versao: pacote?.version ?? null,
    commit: doArquivo?.commit ?? git?.commit ?? null,
    data: doArquivo?.data || null,
    branch: doArquivo?.branch || git?.branch || null,
  }
}

const primeiraLinha = (s) => String(s ?? '').split('\n')[0].slice(0, 200)

async function github(cfg, caminho) {
  const resposta = await fetch(`${cfg.apiUrl}/repos/${cfg.repo}${caminho}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pre-fichas-acampamento',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (resposta.status === 404) return { naoEncontrado: true }
  if (!resposta.ok) throw new Error(`GitHub respondeu ${resposta.status}`)
  return resposta.json()
}

/**
 * Consulta o GitHub e compara com a versão instalada.
 * Nunca lança erro: problemas de rede viram { erro } para mostrar no painel.
 */
export async function verificarAtualizacao(cfg, instalada) {
  const base = {
    repo: cfg.repo, branch: cfg.branch, instalada, verificado_em: new Date().toISOString(),
    desatualizado: null, commits_atras: null, novidades: [], disponivel: null, erro: null,
  }
  try {
    const ultimo = await github(cfg, `/commits/${encodeURIComponent(cfg.branch)}`)
    if (ultimo.naoEncontrado) {
      return { ...base, erro: `Não encontrei o repositório ${cfg.repo} (branch ${cfg.branch}). Se ele for privado, configure ATUALIZACAO_TOKEN.` }
    }
    const disponivel = {
      commit: ultimo.sha,
      data: ultimo.commit?.committer?.date ?? null,
      mensagem: primeiraLinha(ultimo.commit?.message),
    }
    if (!instalada.commit) {
      return { ...base, disponivel, erro: 'Não foi possível identificar a versão instalada. Atualize usando ./scripts/atualizar.sh para registrar a versão.' }
    }
    if (instalada.commit === disponivel.commit) {
      return { ...base, disponivel, desatualizado: false, commits_atras: 0 }
    }
    const cmp = await github(cfg, `/compare/${instalada.commit}...${disponivel.commit}`)
    if (cmp.naoEncontrado) {
      // Commit instalado não existe no GitHub (alteração local): só dá para dizer que é diferente
      return { ...base, disponivel, desatualizado: true, commits_atras: null }
    }
    const novidades = (cmp.commits ?? []).slice(-30).reverse().map((c) => ({
      commit: c.sha, mensagem: primeiraLinha(c.commit?.message), data: c.commit?.committer?.date ?? null,
    }))
    if (cmp.status === 'behind' || cmp.status === 'identical') {
      // A instalação está à frente da branch (ex.: instalada de outra branch): nada a fazer
      return { ...base, disponivel, desatualizado: false, commits_atras: 0, observacao: 'A versão instalada é mais nova que a da branch acompanhada.' }
    }
    return { ...base, disponivel, desatualizado: true, commits_atras: cmp.ahead_by ?? novidades.length, novidades }
  } catch (e) {
    return { ...base, erro: `Não foi possível consultar o GitHub agora (${e.message}). O servidor precisa de acesso a api.github.com.` }
  }
}

/** Mantém a última verificação em memória e repete a cada `horas`. */
export function criarVerificador(cfg, instalada, log) {
  let ultima = null
  let emAndamento = null
  const verificar = async () => {
    emAndamento ??= verificarAtualizacao(cfg, instalada).then((r) => {
      ultima = r
      emAndamento = null
      if (r.desatualizado) log?.info?.({ commits_atras: r.commits_atras }, 'Nova versão disponível no GitHub')
      return r
    })
    return emAndamento
  }
  let timer = null
  return {
    instalada,
    ultima: () => ultima,
    verificar,
    iniciar(horas) {
      verificar().catch(() => {})
      timer = setInterval(() => verificar().catch(() => {}), horas * 3600_000)
      timer.unref()
    },
    parar() { if (timer) clearInterval(timer) },
  }
}
