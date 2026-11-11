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
  if (!r.ok || typeof j.id_token !== 'string') {
    // o erro da Microsoft (ex.: AADSTS7000215 = segredo errado) só vai para o log do servidor, nunca para a tela
    const e = new Error('troca_recusada'); e.detalhe = `${String(j.error ?? r.status).slice(0, 60)}: ${String(j.error_description ?? '').replace(/\s+/g, ' ').slice(0, 200)}`; throw e
  }
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
  // grupos do Entra (só os GUIDs); se a pessoa está em grupos demais o token não os traz (excedeu) e não dá para decidir o núcleo
  const grupos = Array.isArray(c.groups) ? [...new Set(c.groups.filter((g) => typeof g === 'string' && GUID.test(g)).map((g) => g.toLowerCase()))] : []
  const excedeu = c.hasgroups === true || Boolean(c._claim_names?.groups)
  return { oid: c.oid.toLowerCase(), email: email.includes('@') && email.length <= 200 ? email : null, nome: String(c.name ?? '').trim().slice(0, 120), grupos, excedeu }
}

// ---------------------------------------------------------------- criar grupos no Entra (Microsoft Graph, permissão de aplicação Group.Create)
// Permissão mínima: o aplicativo só consegue CRIAR grupos de segurança novos; não lê, não altera nem apaga grupos existentes
// e não mexe em membros. Quem coloca as pessoas nos grupos é o administrador do Entra.
export async function tokenGraph(fetchFn, { tenant, clientId, segredo }) {
  const r = await fetchFn(url(tenant).token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: segredo, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
    signal: AbortSignal.timeout(10000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.access_token !== 'string') {
    const e = new Error('token_graph'); e.detalhe = `${String(j.error ?? r.status).slice(0, 60)}: ${String(j.error_description ?? '').replace(/\s+/g, ' ').slice(0, 160)}`; throw e
  }
  return j.access_token
}

export async function criarGrupoSeguranca(fetchFn, token, { nome, apelido, descricao }) {
  const r = await fetchFn('https://graph.microsoft.com/v1.0/groups', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ displayName: nome.slice(0, 256), description: descricao.slice(0, 1000), mailEnabled: false, mailNickname: apelido, securityEnabled: true }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.id !== 'string' || !GUID.test(j.id)) {
    const e = new Error('grupo_recusado'); e.status = r.status; e.codigo = String(j.error?.code ?? '').slice(0, 60); e.detalhe = String(j.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 160); throw e
  }
  return j.id.toLowerCase()
}

// ---------------------------------------------------------------- ler e apagar grupos (exige Group.ReadWrite.All; ler sozinho exigiria Group.Read.All)
const GRAPH = 'https://graph.microsoft.com/v1.0'
const erroGraph = async (r, nome) => {
  const j = await r.json().catch(() => ({}))
  const e = new Error(nome); e.status = r.status; e.codigo = String(j.error?.code ?? '').slice(0, 60); e.detalhe = String(j.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 160); return e
}
export const PREFIXO_GRUPO = 'Pré-fichas'

/** Grupos cujo nome começa com "Pré-fichas" (até 20 páginas de 100). */
export async function lerGruposPrefixo(fetchFn, token) {
  let proxima = `${GRAPH}/groups?$filter=${encodeURIComponent(`startswith(displayName,'${PREFIXO_GRUPO}')`)}&$select=id,displayName&$top=100`
  const grupos = []
  for (let pagina = 0; proxima && pagina < 20; pagina++) {
    const r = await fetchFn(proxima, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw await erroGraph(r, 'ler_grupos')
    const j = await r.json()
    for (const g of j.value ?? []) if (typeof g.id === 'string' && GUID.test(g.id)) grupos.push({ id: g.id.toLowerCase(), nome: String(g.displayName ?? '').slice(0, 256) })
    proxima = typeof j['@odata.nextLink'] === 'string' && j['@odata.nextLink'].startsWith(`${GRAPH}/`) ? j['@odata.nextLink'] : null   // só segue links do próprio Graph
  }
  return grupos
}

/** Um grupo pelo ID: { id, nome } ou null se não existe mais. */
export async function lerGrupo(fetchFn, token, id) {
  if (!GUID.test(id)) throw new Error('id_invalido')
  const r = await fetchFn(`${GRAPH}/groups/${id}?$select=id,displayName`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
  if (r.status === 404) return null
  if (!r.ok) throw await erroGraph(r, 'ler_grupo')
  const j = await r.json()
  return { id: String(j.id).toLowerCase(), nome: String(j.displayName ?? '').slice(0, 256) }
}

/** Apaga um grupo (404 = já não existe = sucesso). */
export async function apagarGrupo(fetchFn, token, id) {
  if (!GUID.test(id)) throw new Error('id_invalido')
  const r = await fetchFn(`${GRAPH}/groups/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
  if (r.status === 404) return false
  if (!r.ok) throw await erroGraph(r, 'apagar_grupo')
  return true
}
