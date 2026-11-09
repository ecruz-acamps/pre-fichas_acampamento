// Login com a Microsoft (Entra ID) por OpenID Connect: fluxo "authorization code" + PKCE, só um diretório (tenant).
// Sem biblioteca de terceiros: o id_token é conferido aqui (assinatura RS256 pelas chaves públicas da Microsoft,
// emissor, destinatário, validade, nonce e diretório).
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE = 'https://login.microsoftonline.com'
const url = (tenant) => ({
  autorizar: `${BASE}/${tenant}/oauth2/v2.0/authorize`, token: `${BASE}/${tenant}/oauth2/v2.0/token`,
  chaves: `${BASE}/${tenant}/discovery/v2.0/keys`, emissor: `${BASE}/${tenant}/v2.0`,
})
const b64 = (n) => randomBytes(n).toString('base64url')

export function novoPedido() {
  const verificador = b64(48)
  return { state: b64(24), nonce: b64(24), verificador, desafio: createHash('sha256').update(verificador).digest('base64url') }
}

export function urlAutorizacao({ tenant, clientId, redirectUri }, pedido) {
  const p = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
    scope: 'openid profile email', state: pedido.state, nonce: pedido.nonce,
    code_challenge: pedido.desafio, code_challenge_method: 'S256', prompt: 'select_account',
  })
  return `${url(tenant).autorizar}?${p}`
}

export async function trocarCodigo(fetchFn, { tenant, clientId, segredo, redirectUri }, codigo, verificador) {
  const r = await fetchFn(url(tenant).token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: segredo, grant_type: 'authorization_code', code: codigo, redirect_uri: redirectUri, code_verifier: verificador }),
    signal: AbortSignal.timeout(10000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.id_token !== 'string') throw new Error('troca_recusada')
  return j.id_token
}

const cacheChaves = new Map()   // tenant -> { chaves, ate }
async function chaveDe(fetchFn, tenant, kid, forcar = false) {
  let c = cacheChaves.get(tenant)
  if (forcar || !c || c.ate < Date.now()) {
    const r = await fetchFn(url(tenant).chaves, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw new Error('chaves_indisponiveis')
    c = { chaves: (await r.json()).keys ?? [], ate: Date.now() + 3600e3 }
    cacheChaves.set(tenant, c)
  }
  return c.chaves.find((k) => k.kid === kid && k.kty === 'RSA') ?? null
}
export const esquecerChaves = () => cacheChaves.clear()

const json = (parte) => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'))

/** Confere o id_token e devolve as informações da pessoa. Lança erro se qualquer verificação falhar. */
export async function validarIdToken(fetchFn, { tenant, clientId }, token, nonce, agora = Date.now()) {
  const partes = String(token).split('.')
  if (partes.length !== 3) throw new Error('token_invalido')
  const cab = json(partes[0]), c = json(partes[1])
  if (cab.alg !== 'RS256' || typeof cab.kid !== 'string') throw new Error('algoritmo')
  let jwk = await chaveDe(fetchFn, tenant, cab.kid)
  jwk ??= await chaveDe(fetchFn, tenant, cab.kid, true)   // a Microsoft troca as chaves de tempos em tempos
  if (!jwk) throw new Error('chave_desconhecida')
  const ok = verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(partes[2], 'base64url'))
  if (!ok) throw new Error('assinatura')
  const s = Math.floor(agora / 1000)
  if (c.iss !== url(tenant).emissor) throw new Error('emissor')
  if (String(c.tid ?? '').toLowerCase() !== tenant.toLowerCase()) throw new Error('diretorio')
  if (c.aud !== clientId) throw new Error('destinatario')
  if (typeof c.exp !== 'number' || c.exp + 60 < s) throw new Error('expirado')
  if (typeof c.nbf === 'number' && c.nbf - 60 > s) throw new Error('ainda_nao_valido')
  if (!nonce || c.nonce !== nonce) throw new Error('nonce')
  if (typeof c.oid !== 'string' || !GUID.test(c.oid)) throw new Error('sem_oid')
  const email = String(c.email ?? c.preferred_username ?? c.upn ?? '').trim().toLowerCase()
  return { oid: c.oid.toLowerCase(), email: email.includes('@') && email.length <= 200 ? email : null, nome: String(c.name ?? '').trim().slice(0, 120) }
}
