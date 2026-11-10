import { randomBytes } from 'node:crypto'
import { transacao } from '../db.js'
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

  // ativo/IDs/segredo vêm do .env (gravado pelo painel central da VM); aqui no banco só fica a escolha "criar pendentes"
  const ms = config.microsoft
  const carregar = async () => { const r = (await pool.query('select criar_pendentes, provisionar from sso_config where id')).rows[0]
    return { ativo: ms.habilitado, tenant_id: ms.tenantId, client_id: ms.clientId, criar_pendentes: r.criar_pendentes, provisionar: r.provisionar } }
  const redirectUri = () => (config.urlPublica ? `${config.urlPublica}/api/auth/microsoft/callback` : null)
  const pronto = (c) => c?.ativo && GUID.test(c.tenant_id ?? '') && GUID.test(c.client_id ?? '') && ms.segredo && redirectUri()
  const voltar = (reply, erro) => reply.redirect(`/admin/${erro ? `?sso_erro=${erro}` : ''}`)
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  // O botão "Entrar com a Microsoft" só aparece se estiver configurado
  app.get('/api/auth/microsoft/status', async () => ({ ativo: Boolean(pronto(await carregar())) }))

  app.get('/api/auth/microsoft/entrar', { config: { rateLimit: { max: Math.max(20, config.limiteLoginPorMinuto), timeWindow: '1 minute' } } }, async (req, reply) => {
    const c = await carregar()
    if (!pronto(c) || !(await licencaAtivada(pool))) return voltar(reply, 'indisponivel')
    limpar()
    if (pedidos.size > 1000) return voltar(reply, 'ocupado')
    const pedido = novoPedido(), id = randomBytes(24).toString('base64url')
    pedidos.set(id, { ...pedido, ate: Date.now() + 600e3 })
    reply.setCookie(COOKIE_PEDIDO, id, { path: '/api/auth/microsoft', httpOnly: true, sameSite: 'lax', secure: config.cookieSeguro, maxAge: 600 })
    return reply.redirect(urlAutorizacao({ tenant: c.tenant_id, clientId: c.client_id, redirectUri: redirectUri() }, pedido))
  })

  app.get('/api/auth/microsoft/callback', { config: { rateLimit: { max: Math.max(30, config.limiteLoginPorMinuto), timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = req.cookies[COOKIE_PEDIDO]
    const pedido = id && pedidos.get(id)
    reply.clearCookie(COOKIE_PEDIDO, { path: '/api/auth/microsoft' })
    if (pedido) pedidos.delete(id)           // uso único
    const c = await carregar()
    if (!pronto(c)) return voltar(reply, 'indisponivel')
    const { code, state } = req.query ?? {}
    if (!pedido || pedido.ate < Date.now() || typeof state !== 'string' || state !== pedido.state) return voltar(reply, 'expirado')
    if (typeof code !== 'string' || !code || code.length > 4096) {   // inclui "error=" devolvido pela Microsoft (usuário recusou, sem permissão, URI errado…)
      req.log.warn({ erro: String(req.query?.error ?? '').slice(0, 60), detalhe: String(req.query?.error_description ?? '').replace(/\s+/g, ' ').slice(0, 200), ip: req.ip }, 'Login Microsoft: a Microsoft não devolveu o código')
      return voltar(reply, 'recusado')
    }

    let eu
    try {
      const cfg = { tenant: c.tenant_id, clientId: c.client_id, segredo: ms.segredo, redirectUri: redirectUri() }
      eu = await validarIdToken(fetchFn, cfg, await trocarCodigo(fetchFn, cfg, code, pedido.verificador), pedido.nonce)
    } catch (e) {
      req.log.warn({ motivo: e.message, detalhe: e.detalhe, ip: req.ip }, 'Login Microsoft recusado')
      return voltar(reply, 'recusado')
    }
    if (!eu.email) return voltar(reply, 'sem_email')

    // Modo "grupos": o núcleo vem dos grupos do Entra (cada núcleo guarda o ID do seu grupo)
    const porGrupo = c.provisionar === 'grupos'
    let nucleosDosGrupos = []
    if (porGrupo) {
      if (eu.excedeu) { req.log.warn({ email: eu.email }, 'Login Microsoft: pessoa em grupos demais (o token não traz a lista)'); return voltar(reply, 'grupos') }
      nucleosDosGrupos = eu.grupos.length ? (await pool.query('select id from nucleos where lower(entra_grupo_id) = any($1::text[])', [eu.grupos])).rows.map((x) => x.id) : []
    }
    const entrar = async (usuarioId) => {
      await pool.query('update usuarios set sso_oid = $2, ultimo_login = now() where id = $1', [usuarioId, eu.oid])
      reply.setCookie(COOKIE, await criarSessao(pool, usuarioId, config.sessaoHoras),
        { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSeguro, maxAge: config.sessaoHoras * 3600 })
      req.log.info({ usuario: usuarioId }, 'Login Microsoft concluído')
      return voltar(reply)
    }
    const gravarNucleos = async (db, usuarioId) => {
      await db.query('delete from usuario_nucleos where usuario_id = $1', [usuarioId])
      if (nucleosDosGrupos.length) await db.query('insert into usuario_nucleos (usuario_id, nucleo_id) select $1, unnest($2::bigint[])', [usuarioId, nucleosDosGrupos])
    }

    // 1º pelo identificador da Microsoft (oid); senão pelo e-mail, desde que a conta ainda não esteja ligada a outra pessoa
    let { rows: [u] } = await pool.query('select id, ativo, pendente, sso_oid, sso_gerenciado, papel from usuarios where sso_oid = $1', [eu.oid])
    if (!u) {
      ({ rows: [u] } = await pool.query('select id, ativo, pendente, sso_oid, sso_gerenciado, papel from usuarios where email = $1', [eu.email]))
      if (u?.sso_oid && u.sso_oid !== eu.oid) { req.log.warn({ email: eu.email }, 'Login Microsoft: e-mail já ligado a outra conta Microsoft'); return voltar(reply, 'negado') }
    }
    if (!u && porGrupo) {
      // entra direto, como coordenador dos núcleos dos seus grupos; sem grupo de núcleo não há acesso
      if (!nucleosDosGrupos.length) { req.log.warn({ email: eu.email }, 'Login Microsoft: sem grupo de núcleo'); return voltar(reply, 'sem_grupo') }
      const hash = await gerarHash(randomBytes(32).toString('base64'))   // a pessoa nunca usa senha
      const novoId = await transacao(pool, async (db) => {
        const { rows: [n] } = await db.query(
          `insert into usuarios (email, nome, papel, senha_hash, trocar_senha, ativo, pendente, email_confirmado, sso_oid, sso_gerenciado)
           values ($1, $2, 'coordenador', $3, false, true, false, true, $4, true) on conflict do nothing returning id`,
          [eu.email, eu.nome || eu.email.split('@')[0], hash, eu.oid])
        if (n) await gravarNucleos(db, n.id)
        return n?.id
      })
      if (!novoId) return voltar(reply, 'negado')
      req.log.info({ email: eu.email, nucleos: nucleosDosGrupos.length }, 'Login Microsoft: coordenador criado pelos grupos do Entra')
      return entrar(novoId)
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
    if (u.pendente && porGrupo && nucleosDosGrupos.length && u.papel === 'coordenador') {
      // cadastro que ficou aguardando antes de ligar o modo "grupos": os grupos do Entra agora bastam
      await transacao(pool, async (db) => {
        await db.query('update usuarios set pendente = false, ativo = true, sso_gerenciado = true where id = $1', [u.id])
        await gravarNucleos(db, u.id)
      })
      return entrar(u.id)
    }
    if (u.pendente) return voltar(reply, 'pendente')
    if (!u.ativo) return voltar(reply, 'negado')

    // quem foi criado pelos grupos acompanha o Entra: núcleos sincronizados a cada entrada; saiu de todos os grupos = sem acesso
    if (porGrupo && u.sso_gerenciado && u.papel === 'coordenador') {
      await transacao(pool, (db) => gravarNucleos(db, u.id))
      if (!nucleosDosGrupos.length) {
        await pool.query('delete from sessoes where usuario_id = $1', [u.id])
        req.log.warn({ usuario: u.id }, 'Login Microsoft: saiu de todos os grupos de núcleo; núcleos removidos')
        return voltar(reply, 'sem_grupo')
      }
    }
    return entrar(u.id)
  })

  // ---- Situação e a única escolha local (o resto é do painel central da VM) ----
  app.get('/api/admin/sso', soAdmin, async () => {
    const c = await carregar()
    return { habilitado: ms.habilitado, tenantId: ms.tenantId ?? '', clientId: ms.clientId ?? '', criarPendentes: c.criar_pendentes, provisionar: c.provisionar,
      segredoConfigurado: Boolean(ms.segredo), redirectUri: redirectUri(), pronto: Boolean(pronto(c)) }
  })

  app.put('/api/admin/sso', { ...soAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const modo = req.body?.provisionar === 'grupos' ? 'grupos' : 'liberacao'
    await pool.query('update sso_config set criar_pendentes = $1, provisionar = $2, atualizado_em = now() where id', [req.body?.criarPendentes !== false, modo])
    req.log.info({ por: req.usuario.email }, 'Opção "criar cadastro pendente" do login Microsoft alterada')
    return { ok: true }
  })
}
