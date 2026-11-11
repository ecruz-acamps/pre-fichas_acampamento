import { randomBytes } from 'node:crypto'
import { transacao } from '../db.js'
import { gerarHash } from '../senha.js'
import { COOKIE, criarSessao } from '../sessao.js'
import { licencaAtivada } from '../licenca.js'
import { GUID, PREFIXO_GRUPO, apagarGrupo, criarGrupoSeguranca, lerGrupo, lerGruposPrefixo, novoPedido, tokenGraph, trocarCodigo, urlAutorizacao, validarIdToken } from '../sso.js'

const COOKIE_PEDIDO = 'prefichas_sso'
const MAX_PENDENTES = 50

export default async function rotasSso(app) {
  const { pool, config } = app
  const fetchFn = app.fetchSso ?? fetch
  const pedidos = new Map()   // id do cookie -> { state, nonce, verificador, ate }   (memória: vale 10 min)
  const limpar = () => { const t = Date.now(); for (const [k, v] of pedidos) if (v.ate < t) pedidos.delete(k) }

  // ativo/IDs/segredo vêm do .env (gravado pelo painel central da VM); aqui no banco só fica a escolha "criar pendentes"
  const ms = config.microsoft
  const carregar = async () => { const r = (await pool.query('select criar_pendentes, provisionar, leitura_dias, ultima_leitura from sso_config where id')).rows[0]
    return { ativo: ms.habilitado, tenant_id: ms.tenantId, client_id: ms.clientId, criar_pendentes: r.criar_pendentes, provisionar: r.provisionar, leitura_dias: r.leitura_dias, ultima_leitura: r.ultima_leitura } }
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
    req.log.info({ email: eu.email, modo: c.provisionar, gruposNoToken: eu.grupos.length, nucleosCasados: nucleosDosGrupos.length }, 'Login Microsoft: grupos lidos do token')
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

    // Coordenador cadastrado antes (à mão ou aguardando liberação) que agora está em algum grupo de núcleo: passa a acompanhar o Entra.
    // Sem nenhum grupo de núcleo ele continua como estava (núcleos definidos à mão), para não tirar o acesso de quem já usava.
    if (porGrupo && !u.sso_gerenciado && u.papel === 'coordenador' && nucleosDosGrupos.length) {
      await pool.query('update usuarios set sso_gerenciado = true where id = $1', [u.id]); u.sso_gerenciado = true
      req.log.info({ usuario: u.id }, 'Login Microsoft: coordenador existente passou a acompanhar os grupos do Entra')
    } else if (porGrupo && !u.sso_gerenciado) {
      req.log.info({ usuario: u.id, papel: u.papel }, 'Login Microsoft: usuário cadastrado à mão; os grupos do Entra não foram aplicados (papel diferente de coordenador ou sem grupo de núcleo)')
    }
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

  // ---- Cria no Entra um grupo de segurança para cada núcleo que ainda não tem (só administrador) ----
  app.post('/api/admin/nucleos/criar-grupos-entra', { ...soAdmin, config: { rateLimit: { max: Math.max(5, config.limiteLoginPorMinuto), timeWindow: '1 hour' } } }, async (req, reply) => {
    const c = await carregar()
    if (!pronto(c)) return reply.code(409).send({ mensagem: 'O login Microsoft ainda não está pronto neste acampamento (peça ao administrador da VM para configurar no painel central).' })
    const { rows: nucleos } = await pool.query('select id, nome from nucleos where entra_grupo_id is null order by nome')
    if (!nucleos.length) return { criados: [], falhas: [], mensagem: 'Todos os núcleos já têm grupo.' }
    const cfg = { tenant: c.tenant_id, clientId: c.client_id, segredo: ms.segredo }
    let token
    try { token = await tokenGraph(fetchFn, cfg) } catch (e) {
      req.log.warn({ detalhe: e.detalhe }, 'Criar grupos no Entra: token do Graph recusado')
      return reply.code(502).send({ mensagem: `A Microsoft recusou o acesso do aplicativo (${e.detalhe ?? 'erro'}). Confira o segredo e a permissão Group.Create.` })
    }
    const criados = [], falhas = []
    for (const n of nucleos) {
      try {
        const id = await criarGrupoSeguranca(fetchFn, token, {
          nome: `Pré-fichas – ${n.nome}`, descricao: `Coordenadores do núcleo ${n.nome} (login do sistema de pré-fichas). Gerenciado pelo Entra: coloque aqui os membros.`,
          apelido: `prefichas-n${n.id}-${randomBytes(3).toString('hex')}` })
        await pool.query('update nucleos set entra_grupo_id = $1, entra_grupo_criado = true, entra_grupo_nome = $3, entra_grupo_visto = now(), entra_grupo_sumiu = false where id = $2 and entra_grupo_id is null', [id, n.id, `${PREFIXO_GRUPO} – ${n.nome}`])
        criados.push({ id: n.id, nome: n.nome, grupo: id })
      } catch (e) {
        falhas.push({ id: n.id, nome: n.nome, motivo: e.status === 403 || e.status === 401 ? 'sem permissão (falta Group.Create com consentimento do administrador)' : (e.codigo || 'falhou') })
        if (e.status === 403 || e.status === 401) break   // sem permissão: não adianta insistir nos outros
      }
    }
    req.log.info({ por: req.usuario.email, criados: criados.length, falhas: falhas.length }, 'Grupos criados no Entra')
    return { criados, falhas }
  })

  // ---- Leitura do Entra: encontra os grupos "Pré-fichas…" (inclusive os criados à mão) e liga ao núcleo de mesmo nome ----
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim()
  let lendo = false
  async function tokenDoGraph() {
    const c = await carregar()
    if (!pronto(c)) { const e = new Error('nao_pronto'); e.http = 409; e.mensagem = 'O login Microsoft ainda não está pronto neste acampamento (peça ao administrador da VM para configurar no painel central).'; throw e }
    try { return await tokenGraph(fetchFn, { tenant: c.tenant_id, clientId: c.client_id, segredo: ms.segredo }) } catch (err) {
      const e = new Error('token'); e.http = 502; e.mensagem = `A Microsoft recusou o acesso do aplicativo (${err.detalhe ?? 'erro'}). Confira o segredo e as permissões do aplicativo.`; throw e
    }
  }
  const semPermissao = (err) => err.status === 403 || err.status === 401
  async function lerEntra(termo = null) {
    if (lendo) { const e = new Error('ocupado'); e.http = 409; e.mensagem = 'Já há uma leitura em andamento.'; throw e }
    lendo = true
    try {
      const token = await tokenDoGraph()
      let achados
      try { achados = await lerGruposPrefixo(fetchFn, token, termo ?? PREFIXO_GRUPO) } catch (err) {
        const e = new Error('ler'); e.http = semPermissao(err) ? 403 : 502
        e.mensagem = semPermissao(err) ? 'Sem permissão para ler os grupos: dê ao aplicativo a permissão Group.Read.All (ou Group.ReadWrite.All) com consentimento do administrador.' : `Não consegui ler os grupos (${err.detalhe || err.status || 'erro'}).`
        throw e
      }
      const { rows: nucleos } = await pool.query('select id, nome, entra_grupo_id from nucleos')
      const porId = new Map(achados.map((g) => [g.id, g]))
      const ligados = new Set(nucleos.map((n) => n.entra_grupo_id?.toLowerCase()).filter(Boolean))
      const r = { atualizados: 0, sumiram: 0, vinculados: [], livres: 0 }
      for (const n of nucleos.filter((x) => x.entra_grupo_id)) {
        const id = n.entra_grupo_id.toLowerCase()
        let g = porId.get(id)
        if (!g) { try { g = await lerGrupo(fetchFn, token, id) } catch { continue } }   // renomeado fora do prefixo: confirma pelo ID
        if (!g) { await pool.query('update nucleos set entra_grupo_sumiu = true where id = $1', [n.id]); r.sumiram++; continue }
        await pool.query('update nucleos set entra_grupo_nome = $2, entra_grupo_visto = now(), entra_grupo_sumiu = false where id = $1', [n.id, g.nome]); r.atualizados++
      }
      // casa pelo nome do núcleo, com ou sem o prefixo ("Santo Amaro" ou "Pré-fichas – Santo Amaro")
      const semGrupo = new Map()
      for (const n of nucleos.filter((x) => !x.entra_grupo_id)) { semGrupo.set(norm(`${PREFIXO_GRUPO} - ${n.nome}`), n); semGrupo.set(norm(n.nome), n) }
      const livres = []
      for (const g of achados) {
        if (ligados.has(g.id)) continue
        const n = semGrupo.get(norm(g.nome))
        if (n) {   // mesmo nome "Pré-fichas – NÚCLEO": liga sozinho (o grupo não foi criado pelo sistema, então o sistema nunca o apaga)
          await pool.query('update nucleos set entra_grupo_id = $2, entra_grupo_criado = false, entra_grupo_nome = $3, entra_grupo_visto = now(), entra_grupo_sumiu = false where id = $1 and entra_grupo_id is null', [n.id, g.id, g.nome])
          semGrupo.delete(norm(`${PREFIXO_GRUPO} - ${n.nome}`)); semGrupo.delete(norm(n.nome)); r.vinculados.push({ nucleo: n.nome, grupo: g.nome })
        } else livres.push(g)
      }
      await transacao(pool, async (db) => {
        await db.query('delete from entra_grupos_livres')
        for (const g of livres) await db.query('insert into entra_grupos_livres (grupo_id, nome) values ($1, $2) on conflict do nothing', [g.id, g.nome])
        await db.query('update sso_config set ultima_leitura = now() where id')
      })
      r.livres = livres.length
      return r
    } finally { lendo = false }
  }
  const responderErro = (reply, e) => (e.http ? reply.code(e.http).send({ mensagem: e.mensagem }) : (() => { throw e })())

  app.post('/api/admin/nucleos/ler-entra', { ...soAdmin, config: { rateLimit: { max: Math.max(10, config.limiteLoginPorMinuto), timeWindow: '1 hour' } } }, async (req, reply) => {
    const termo = typeof req.body?.termo === 'string' ? req.body.termo.trim() : ''
    if (termo && !/^[\p{L}\p{N} .,()–—-]{2,60}$/u.test(termo)) return reply.code(400).send({ mensagem: 'Termo de busca inválido (2 a 60 letras, números e espaços).' })
    try {
      const r = await lerEntra(termo || null)
      req.log.info({ por: req.usuario.email, termo: termo || undefined, ...r, vinculados: r.vinculados.length }, 'Leitura dos grupos do Entra')
      return r
    } catch (e) { return responderErro(reply, e) }
  })

  app.get('/api/admin/entra/grupos-livres', soAdmin, async () => (await pool.query('select grupo_id as id, nome, lido_em as "lidoEm" from entra_grupos_livres order by nome')).rows)

  // Liga um grupo encontrado na leitura a um núcleo (só grupos que a leitura trouxe)
  app.post('/api/admin/nucleos/:id/vincular-grupo', { ...soAdmin, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = Number(req.params.id), grupo = String(req.body?.grupo ?? '').toLowerCase()
    if (!Number.isInteger(id) || !GUID.test(grupo)) return reply.code(400).send({ mensagem: 'Pedido inválido.' })
    const ok = await transacao(pool, async (db) => {
      const { rows: [g] } = await db.query('select nome from entra_grupos_livres where grupo_id = $1', [grupo])
      if (!g) return 'grupo'
      const r = await db.query('update nucleos set entra_grupo_id = $2, entra_grupo_criado = false, entra_grupo_nome = $3, entra_grupo_visto = now(), entra_grupo_sumiu = false where id = $1 and entra_grupo_id is null', [id, grupo, g.nome])
      if (!r.rowCount) return 'nucleo'
      await db.query('delete from entra_grupos_livres where grupo_id = $1', [grupo]); return true
    }).catch((e) => (e.code === '23505' ? 'duplicado' : Promise.reject(e)))
    if (ok === true) return { ok: true }
    return reply.code(ok === 'grupo' ? 404 : 409).send({ mensagem: ok === 'grupo' ? 'Grupo não encontrado na última leitura. Leia o Entra de novo.' : ok === 'duplicado' ? 'Este grupo já está ligado a outro núcleo.' : 'O núcleo não existe ou já tem um grupo ligado.' })
  })

  // Usado pela exclusão de núcleo: apaga o grupo no Entra, só se o sistema o criou e o nome ainda começa com "Pré-fichas"
  app.entra.apagarGrupo = async (id) => {
    {
      const token = await tokenDoGraph()
      let g
      try { g = await lerGrupo(fetchFn, token, id) } catch (err) { const e = new Error('ler'); e.http = semPermissao(err) ? 403 : 502; e.mensagem = semPermissao(err) ? 'Sem permissão para apagar grupos: o aplicativo precisa de Group.ReadWrite.All com consentimento do administrador.' : 'Não consegui consultar o grupo no Entra.'; throw e }
      if (!g) return false   // já não existe
      if (!g.nome.startsWith(PREFIXO_GRUPO)) { const e = new Error('nome'); e.http = 409; e.mensagem = `O grupo no Entra se chama "${g.nome}" (não começa com "${PREFIXO_GRUPO}"): por segurança o sistema não o apaga.`; throw e }
      try { return await apagarGrupo(fetchFn, token, id) } catch (err) { const e = new Error('apagar'); e.http = semPermissao(err) ? 403 : 502; e.mensagem = semPermissao(err) ? 'Sem permissão para apagar grupos: o aplicativo precisa de Group.ReadWrite.All com consentimento do administrador.' : 'Não consegui apagar o grupo no Entra.'; throw e }
    }
  }

  // Leitura automática a cada N dias (0 = desligada): confere uma vez por hora se já passou o prazo
  const relogio = setInterval(async () => {
    try {
      const c = await carregar()
      if (!c.leitura_dias || !pronto(c)) return
      if (c.ultima_leitura && Date.now() - new Date(c.ultima_leitura).getTime() < c.leitura_dias * 86400e3) return
      const r = await lerEntra(); app.log.info({ ...r, vinculados: r.vinculados.length }, 'Leitura automática dos grupos do Entra')
    } catch (e) { app.log.warn({ motivo: e.mensagem ?? e.message }, 'Leitura automática dos grupos do Entra falhou') }
  }, 3600e3)
  relogio.unref()
  app.addHook('onClose', async () => clearInterval(relogio))

  // ---- Situação e a única escolha local (o resto é do painel central da VM) ----
  app.get('/api/admin/sso', soAdmin, async () => {
    const c = await carregar()
    return { habilitado: ms.habilitado, tenantId: ms.tenantId ?? '', clientId: ms.clientId ?? '', criarPendentes: c.criar_pendentes, provisionar: c.provisionar, leituraDias: c.leitura_dias, ultimaLeitura: c.ultima_leitura,
      segredoConfigurado: Boolean(ms.segredo), redirectUri: redirectUri(), pronto: Boolean(pronto(c)) }
  })

  app.put('/api/admin/sso', { ...soAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const modo = req.body?.provisionar === 'grupos' ? 'grupos' : 'liberacao'
    const dias = Number.isInteger(req.body?.leituraDias) ? Math.min(90, Math.max(0, req.body.leituraDias)) : null
    await pool.query('update sso_config set criar_pendentes = $1, provisionar = $2, leitura_dias = coalesce($3, leitura_dias), atualizado_em = now() where id', [req.body?.criarPendentes !== false, modo, dias])
    req.log.info({ por: req.usuario.email }, 'Opção "criar cadastro pendente" do login Microsoft alterada')
    return { ok: true }
  })
}
