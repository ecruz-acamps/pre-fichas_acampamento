// Avisos no celular (Web Push) para o participante quando a situação da pré-ficha muda.
// - O administrador liga/desliga em Configurações (marca.avisosStatus). Desligado: nada é enviado.
// - O aviso NUNCA leva dado pessoal (aparece na tela bloqueada): só "há uma novidade na sua pré-ficha".
// - O servidor só envia para os serviços de push conhecidos (Google, Apple, Mozilla, Microsoft): o endereço vem do
//   aparelho, e aceitar qualquer um deixaria alguém fazer o servidor chamar endereços internos.
import webpush from 'web-push'
import { carregarMarca } from './marca.js'

const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/]
export const MAX_APARELHOS = 10
// Situações que geram aviso (desistência é feita pela própria pessoa: não avisa)
const AVISAR = new Set(['aguardando', 'em_contato', 'confirmado', 'participou'])

export function endpointValido(endpoint) {
  try {
    const u = new URL(String(endpoint ?? ''))
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && endpoint.length <= 1000 && HOSTS_PUSH.some((r) => r.test(u.hostname))
  } catch { return false }
}
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/
export function chavesValidas(k) {
  return !!k && typeof k.p256dh === 'string' && typeof k.auth === 'string' && B64URL.test(k.p256dh) && B64URL.test(k.auth)
    && k.p256dh.length >= 20 && k.p256dh.length <= 200 && k.auth.length >= 10 && k.auth.length <= 100
}

let chaves = null
export async function chavesPush(pool) {
  if (chaves) return chaves
  let { rows: [r] } = await pool.query('select publica, privada from push_chaves where id')
  if (!r) {
    const novas = webpush.generateVAPIDKeys()
    await pool.query('insert into push_chaves (publica, privada) values ($1, $2) on conflict (id) do nothing', [novas.publicKey, novas.privateKey])
    ;({ rows: [r] } = await pool.query('select publica, privada from push_chaves where id'))
  }
  chaves = { publica: r.publica, privada: r.privada }
  return chaves
}

/**
 * Envia o aviso da ficha (se a opção estiver ligada). `enviar` pode ser trocado nos testes.
 * Retorna quantos aparelhos receberam.
 */
export async function avisarFicha(pool, fichaId, { config, log, enviar = webpush.sendNotification } = {}) {
  const marca = await carregarMarca(pool)
  if (!marca.avisosStatus) return 0
  const { rows: [f] } = await pool.query('select participante_id, status from pre_fichas where id = $1', [fichaId])
  if (!f?.participante_id || !AVISAR.has(f.status)) return 0
  const { rows: aparelhos } = await pool.query('select id, endpoint, p256dh, auth from push_inscricoes where participante_id = $1', [f.participante_id])
  if (!aparelhos.length) return 0
  const k = await chavesPush(pool)
  const corpo = JSON.stringify({ titulo: marca.nome || 'Acampamento', texto: 'Há uma novidade na sua pré-ficha. Toque para ver.', url: '/' })
  const opcoes = { TTL: 24 * 3600, urgency: 'normal', vapidDetails: { subject: config?.urlPublica || 'mailto:nao-responda@localhost', publicKey: k.publica, privateKey: k.privada } }
  let ok = 0
  for (const a of aparelhos) {
    if (!endpointValido(a.endpoint)) { await pool.query('delete from push_inscricoes where id = $1', [a.id]); continue }
    try {
      await enviar({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, corpo, opcoes)
      await pool.query('update push_inscricoes set ultimo_envio = now(), falhas = 0 where id = $1', [a.id])
      ok++
    } catch (e) {
      // 404/410: o aparelho cancelou ou trocou a inscrição → apaga. Outras falhas: conta e apaga depois de 5.
      if (e?.statusCode === 404 || e?.statusCode === 410) await pool.query('delete from push_inscricoes where id = $1', [a.id])
      else {
        const { rows: [x] } = await pool.query('update push_inscricoes set falhas = falhas + 1 where id = $1 returning falhas', [a.id])
        if (x?.falhas >= 5) await pool.query('delete from push_inscricoes where id = $1', [a.id])
      }
      log?.warn?.({ status: e?.statusCode, ficha: fichaId }, 'Aviso no celular não entregue')
    }
  }
  return ok
}

/** Escuta as mudanças de status (gatilho no banco) e envia os avisos. Reconecta sozinho se a conexão cair. */
export function escutarMudancas(pool, { config, log, enviar } = {}) {
  let parar = false, cliente = null
  const conectar = async () => {
    if (parar) return
    try {
      cliente = await pool.connect()
      cliente.on('notification', (n) => {
        const id = Number(n.payload)
        if (Number.isSafeInteger(id)) avisarFicha(pool, id, { config, log, enviar }).catch((e) => log?.error?.({ err: e }, 'Falha ao enviar aviso no celular'))
      })
      cliente.on('error', () => { try { cliente?.release(true) } catch { /* já liberado */ } cliente = null; setTimeout(conectar, 5000).unref() })
      await cliente.query('listen ficha_status')
    } catch (e) {
      log?.warn?.({ err: e }, 'Avisos no celular: não consegui escutar o banco; tento de novo em 5 s')
      try { cliente?.release(true) } catch { /* já liberado */ }
      cliente = null
      setTimeout(conectar, 5000).unref()
    }
  }
  conectar()
  return async () => { parar = true; if (cliente) { try { await cliente.query('unlisten *') } catch { /* fechando */ } cliente.release() } }
}
