import { randomBytes } from 'node:crypto'
import { gerarHash } from '../senha.js'
import { COOKIE, criarSessao } from '../sessao.js'
import { licencaAtivada } from '../licenca.js'
import { GUID, novoPedido, trocarCodigo, urlAutorizacao, validarIdToken } from '../sso.js'

const COOKIE_PEDIDO = 'prefichas_sso'
const MAX_PENDENTES = 50

export default async function rotasSso(app) {
  const { pool, config } = app
  const fetchFn = app.fetchSso ?? fetch
  const pedidos = new Map()   // id do cookie -> { state, nonce, verificador, ate }   (memória: vale 10 min)
  const limpar = () => { const t = Date.now(); for (const [k, v] of pedidos) if (v.ate < t) pedidos.delete(k) }

  const carregar = async () => (await pool.query('select ativo, tenant_id, client_id, criar_pendentes from sso_config where id')).rows[0]
  const redirectUri = () => (config.urlPublica ? `${config.urlPublica}/api/auth/microsoft/callback` : null)
  const pronto = (c) => c?.ativo && GUID.test(c.tenant_id ?? '') && GUID.test(c.client_id ?? '') && config.microsoftClientSecret && redirectUri()
  const voltar = (reply, erro) => reply.redirect(`/admin/${erro ? `?sso_erro=${erro}` : ''}`)
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  // O botão "Entrar com a Microsoft" só aparece se estiver configurado
  app.get('/api/auth/microsoft/status', async () => ({ ativo: Boolean(pronto(await carregar())) }))

  app.get('/api/auth/microsoft/entrar', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = await carregar()
    if (!pronto(c) || !(await licencaAtivada(pool))) return voltar(reply, 'indisponivel')
    limpar()
    if (pedidos.size > 1000) return voltar(reply, 'ocupado')
    const pedido = novoPedido(), id = randomBytes(24).toString('base64url')
    pedidos.set(id, { ...pedido, ate: Date.now() + 600e3 })
    reply.setCookie(COOKIE_PEDIDO, id, { path: '/api/auth/microsoft', httpOnly: true, sameSite: 'lax', secure: config.cookieSeguro, maxAge: 600 })
    return reply.redirect(urlAutorizacao({ tenant: c.tenant_id, clientId: c.client_id, redirectUri: redirectUri() }, pedido))
  })

  app.get('/api/auth/microsoft/callback', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = req.cookies[COOKIE_PEDIDO]
    const pedido = id && pedidos.get(id)
    reply.clearCookie(COOKIE_PEDIDO, { path: '/api/auth/microsoft' })
    if (pedido) pedidos.delete(id)           // uso único
    const c = await carregar()
    if (!pronto(c)) return voltar(reply, 'indisponivel')
    const { code, state } = req.query ?? {}
    if (!pedido || pedido.ate < Date.now() || typeof state !== 'string' || state !== pedido.state) return voltar(reply, 'expirado')
    if (typeof code !== 'string' || !code || code.length > 4096) return voltar(reply, 'recusado')   // inclui "error=" devolvido pela Microsoft

    let eu
    try {
      const cfg = { tenant: c.tenant_id, clientId: c.client_id, segredo: config.microsoftClientSecret, redirectUri: redirectUri() }
      eu = await validarIdToken(fetchFn, cfg, await trocarCodigo(fetchFn, cfg, code, pedido.verificador), pedido.nonce)
    } catch (e) {
      req.log.warn({ motivo: e.message, ip: req.ip }, 'Login Microsoft recusado')
      return voltar(reply, 'recusado')
    }
    if (!eu.email) return voltar(reply, 'sem_email')

    // 1º pelo identificador da Microsoft (oid); senão pelo e-mail, desde que a conta ainda não esteja ligada a outra pessoa
    let { rows: [u] } = await pool.query('select id, ativo, pendente, sso_oid from usuarios where sso_oid = $1', [eu.oid])
    if (!u) {
      ({ rows: [u] } = await pool.query('select id, ativo, pendente, sso_oid from usuarios where email = $1', [eu.email]))
      if (u?.sso_oid && u.sso_oid !== eu.oid) { req.log.warn({ email: eu.email }, 'Login Microsoft: e-mail já ligado a outra conta Microsoft'); return voltar(reply, 'negado') }
    }
    if (!u) {
      if (!c.criar_pendentes) return voltar(reply, 'negado')
      await pool.query(`delete from usuarios where pendente and solicitado_em < now() - interval '30 days'`)
      const { rows: [{ n }] } = await pool.query('select count(*)::int as n from usuarios where pendente')
      if (n >= MAX_PENDENTES) return voltar(reply, 'negado')
      // a pessoa nunca usa senha: guardamos o hash de um valor aleatório que ninguém conhece
      const { rowCount } = await pool.query(
        `insert into usuarios (email, nome, papel, senha_hash, trocar_senha, ativo, pendente, email_confirmado, solicitado_em, sso_oid)
         values ($1, $2, 'coordenador', $3, false, false, true, true, now(), $4) on conflict do nothing`,
        [eu.email, eu.nome || eu.email.split('@')[0], await gerarHash(randomBytes(32).toString('base64')), eu.oid])
      req.log.info({ email: eu.email, criado: rowCount }, 'Login Microsoft: cadastro pendente criado')
      return voltar(reply, 'pendente')
    }
    if (u.pendente) return voltar(reply, 'pendente')
    if (!u.ativo) return voltar(reply, 'negado')

    await pool.query('update usuarios set sso_oid = $2, ultimo_login = now() where id = $1', [u.id, eu.oid])
    reply.setCookie(COOKIE, await criarSessao(pool, u.id, config.sessaoHoras),
      { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSeguro, maxAge: config.sessaoHoras * 3600 })
    req.log.info({ usuario: u.id }, 'Login Microsoft concluído')
    return voltar(reply)
  })

  // ---- Configuração (só administrador) ----
  app.get('/api/admin/sso', soAdmin, async () => {
    const c = await carregar()
    return { ativo: c.ativo, tenantId: c.tenant_id ?? '', clientId: c.client_id ?? '', criarPendentes: c.criar_pendentes,
      segredoConfigurado: Boolean(config.microsoftClientSecret), redirectUri: redirectUri(), pronto: Boolean(pronto(c)) }
  })

  app.put('/api/admin/sso', { ...soAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body ?? {}
    const tenant = String(b.tenantId ?? '').trim(), cliente = String(b.clientId ?? '').trim()
    const erros = {}
    if (tenant && !GUID.test(tenant)) erros.tenantId = 'Use o "ID do diretório (locatário)" do Microsoft Entra (formato 00000000-0000-0000-0000-000000000000).'
    if (cliente && !GUID.test(cliente)) erros.clientId = 'Use o "ID do aplicativo (cliente)" do Microsoft Entra.'
    if (b.ativo && !tenant) erros.tenantId = 'Informe o ID do diretório para ativar.'
    if (b.ativo && !cliente) erros.clientId = 'Informe o ID do aplicativo para ativar.'
    if (b.ativo && !config.microsoftClientSecret) erros.ativo = 'Falta a variável MICROSOFT_CLIENT_SECRET no servidor (veja o manual).'
    if (b.ativo && !config.urlPublica) erros.ativo = 'Falta o endereço público (URL_PUBLICA) do sistema.'
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Confira os campos.', erros })
    await pool.query(
      `update sso_config set ativo = $1, tenant_id = $2, client_id = $3, criar_pendentes = $4, atualizado_em = now() where id`,
      [Boolean(b.ativo), tenant || null, cliente || null, b.criarPendentes !== false])
    req.log.info({ por: req.usuario.email, ativo: Boolean(b.ativo) }, 'Configuração do login Microsoft alterada')
    return reply.send({ ok: true })
  })
}
