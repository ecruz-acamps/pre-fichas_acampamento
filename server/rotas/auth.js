import { gerarHash, senhaForte, verificarSenha, verificarSenhaFicticia } from '../senha.js'
import { COOKIE, criarSessao, encerrarOutrasSessoes, encerrarSessao } from '../sessao.js'
import { licencaAtivada } from '../licenca.js'
import { criarProtecaoLogin } from '../protecao.js'
import { carregarMarca } from '../marca.js'
import { conferirCodigo, gerarSegredo, uriAutenticador } from '../totp.js'
import { consultarRedefinicaoUsuario, consumirRedefinicaoUsuario, criarRedefinicaoUsuario } from '../redefinicao.js'

export default async function rotasAuth(app) {
  const { pool, config } = app
  const protecao = criarProtecaoLogin(config.protecaoLogin)
  app.decorate('protecaoLogin', protecao)

  const opcoesCookie = () => ({
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSeguro,
    maxAge: config.sessaoHoras * 3600,
  })

  // Verificação de senha com limite de execuções simultâneas
  const conferirSenha = (senha, hash) => protecao.limitar(() => (hash ? verificarSenha(senha, hash) : verificarSenhaFicticia(senha)))
  const ocupado = (reply) => reply.code(503).send({ mensagem: 'Servidor ocupado. Tente novamente em alguns segundos.' })

  app.post('/api/auth/login', {
    config: { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200)
    const senha = String(req.body?.senha ?? '')
    const codigo = req.body?.codigo
    if (!email || !senha || senha.length > 200) return reply.code(400).send({ mensagem: 'Informe e-mail e senha.' })

    const bloqueio = protecao.bloqueio(email)
    if (bloqueio) {
      return reply.code(429).send({ mensagem: `Muitas tentativas erradas para esta conta. Tente novamente em ${bloqueio} min.` })
    }

    const { rows } = await pool.query(
      'select id, senha_hash, ativo, totp_ativo, totp_segredo, totp_ultimo_passo from usuarios where email = $1', [email])
    const usuario = rows[0]
    let ok
    try { ok = await conferirSenha(senha, usuario?.senha_hash) } catch (e) { if (e.code === 'OCUPADO') return ocupado(reply); throw e }
    if (!ok || !usuario?.ativo) {
      protecao.falhou(email)
      req.log.warn({ email, ip: req.ip }, 'Login recusado')
      return reply.code(401).send({ mensagem: 'E-mail ou senha incorretos.' })
    }

    // Verificação em duas etapas
    if (usuario.totp_ativo) {
      if (!codigo) return reply.code(401).send({ mensagem: 'Informe o código do aplicativo autenticador.', precisa2fa: true })
      const passo = conferirCodigo(usuario.totp_segredo, codigo, usuario.totp_ultimo_passo)
      if (passo === null) {
        protecao.falhou(email)
        req.log.warn({ email, ip: req.ip }, 'Código de duas etapas inválido')
        return reply.code(401).send({ mensagem: 'Código inválido ou já usado. Confira o aplicativo e tente de novo.', precisa2fa: true })
      }
      await pool.query('update usuarios set totp_ultimo_passo = $1 where id = $2', [passo, usuario.id])
    }

    protecao.acertou(email)
    await pool.query('update usuarios set ultimo_login = now() where id = $1', [usuario.id])
    const token = await criarSessao(pool, usuario.id, config.sessaoHoras)
    reply.setCookie(COOKIE, token, opcoesCookie())
    const { rows: [eu] } = await pool.query(
      'select id, email, nome, papel, trocar_senha, totp_ativo from usuarios where id = $1', [usuario.id])
    return { usuario: eu, licencaAtivada: await licencaAtivada(pool) }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await encerrarSessao(pool, req.cookies[COOKIE])
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  // Quem está logado (usuario: null quando ninguém está)
  app.get('/api/auth/eu', async (req) => ({ usuario: req.usuario ?? null, licencaAtivada: await licencaAtivada(pool) }))

  // Troca da própria senha (também usada no primeiro acesso)
  app.post('/api/auth/senha', {
    config: { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!req.usuario) return reply.code(401).send({ mensagem: 'Não autenticado.' })
    const atual = String(req.body?.senhaAtual ?? '')
    const nova = String(req.body?.novaSenha ?? '')
    const problema = senhaForte(nova)
    if (problema) return reply.code(400).send({ mensagem: problema })
    if (nova === atual) return reply.code(400).send({ mensagem: 'A nova senha deve ser diferente da atual.' })

    const { rows: [u] } = await pool.query('select senha_hash from usuarios where id = $1', [req.usuario.id])
    let ok
    try { ok = await conferirSenha(atual, u.senha_hash) } catch (e) { if (e.code === 'OCUPADO') return ocupado(reply); throw e }
    if (!ok) return reply.code(400).send({ mensagem: 'A senha atual está incorreta.' })
    await pool.query('update usuarios set senha_hash = $1, trocar_senha = false where id = $2',
      [await gerarHash(nova), req.usuario.id])
    await encerrarOutrasSessoes(pool, req.usuario.id, req.cookies[COOKIE])
    return { ok: true }
  })

  // ----- Esqueci minha senha (link por e-mail; a verificação em duas etapas, se ativa, continua valendo) -----
  const limiteEsqueci = { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  app.post('/api/auth/esqueci', { config: limiteEsqueci }, async (req, reply) => {
    if (!app.email || !config.urlPublica) {
      return reply.code(503).send({ mensagem: 'A recuperação de senha por e-mail ainda não foi configurada. Peça a um administrador uma senha nova.' })
    }
    // mesma resposta exista ou não o usuário (não revela quem tem acesso)
    const resposta = { ok: true, mensagem: 'Se houver um usuário com este e-mail, enviamos um link para redefinir a senha. Confira também a caixa de spam.' }
    const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta
    const { rows: [u] } = await pool.query('select id, nome, email from usuarios where email = $1 and ativo', [email])
    if (!u) return resposta
    const token = await criarRedefinicaoUsuario(pool, u.id)
    if (!token) return resposta
    const marca = await carregarMarca(pool)
    // não espera o envio: o tempo da resposta não revela se o usuário existe
    app.email.enviar({
      para: u.email,
      nomeRemetente: marca.nome,
      assunto: `Redefinir senha do painel — ${marca.nome}`,
      texto: `Olá, ${u.nome.split(' ')[0]}!\n\n` +
        `Para criar uma senha nova no painel de ${marca.nome}, abra o link abaixo (vale por 1 hora, uma única vez):\n\n` +
        `${config.urlPublica}/admin/?redefinir=${token}\n\n` +
        'Se você usa o aplicativo autenticador, vai precisar do código dele.\n' +
        'Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.',
    }).catch(() => {})
    req.log.info({ usuario: u.id }, 'Link de redefinição de senha do painel enviado')
    return resposta
  })

  app.post('/api/auth/redefinir', {
    config: { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const senha = String(req.body?.senha ?? '')
    const fraca = senhaForte(senha)
    if (fraca) return reply.code(400).send({ mensagem: fraca })
    const invalido = () => reply.code(400).send({ mensagem: 'Link inválido ou vencido. Peça um novo em "Esqueci minha senha".' })
    const r = await consultarRedefinicaoUsuario(pool, req.body?.token)
    if (!r) return invalido()
    const bloqueio = protecao.bloqueio(r.email)
    if (bloqueio) return reply.code(429).send({ mensagem: `Muitas tentativas erradas para esta conta. Tente novamente em ${bloqueio} min.` })
    let passo = null
    if (r.totp_ativo) {
      // o link do e-mail sozinho não basta: com duas etapas ativas, também é preciso o código do aplicativo
      if (!req.body?.codigo) return reply.code(401).send({ mensagem: 'Informe o código do aplicativo autenticador.', precisa2fa: true })
      passo = conferirCodigo(r.totp_segredo, req.body.codigo, r.totp_ultimo_passo)
      if (passo === null) {
        protecao.falhou(r.email)
        req.log.warn({ email: r.email, ip: req.ip }, 'Código de duas etapas inválido na redefinição de senha')
        return reply.code(401).send({ mensagem: 'Código inválido ou já usado. Confira o aplicativo e tente de novo.', precisa2fa: true })
      }
    }
    if (!(await consumirRedefinicaoUsuario(pool, r.token_id))) return invalido()
    await pool.query(
      'update usuarios set senha_hash = $1, trocar_senha = false, totp_ultimo_passo = coalesce($2, totp_ultimo_passo) where id = $3',
      [await protecao.limitar(() => gerarHash(senha)), passo, r.id])
    await pool.query('delete from sessoes where usuario_id = $1', [r.id])   // sai de todos os aparelhos
    protecao.acertou(r.email)
    req.log.info({ usuario: r.id }, 'Senha do painel redefinida pelo link do e-mail')
    return { ok: true }
  })

  // ----- Verificação em duas etapas (opcional, recomendada para administradores) -----
  const logado = async (req, reply) => {
    if (!req.usuario) return reply.code(401).send({ mensagem: 'Não autenticado.' })
  }
  const limite2fa = { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } }

  // 1) gera um segredo novo (ainda não ativo) e devolve para cadastrar no aplicativo
  app.post('/api/auth/2fa/iniciar', { onRequest: [logado], config: limite2fa }, async (req, reply) => {
    const { rows: [u] } = await pool.query('select totp_ativo from usuarios where id = $1', [req.usuario.id])
    if (u.totp_ativo) return reply.code(400).send({ mensagem: 'A verificação em duas etapas já está ativa.' })
    const segredo = gerarSegredo()
    await pool.query('update usuarios set totp_segredo = $1, totp_ultimo_passo = null where id = $2', [segredo, req.usuario.id])
    const marca = await carregarMarca(pool)
    return { segredo, uri: uriAutenticador(segredo, req.usuario.email, `Pré-fichas ${marca.nomeCurto}`) }
  })

  // 2) confirma com um código do aplicativo e ativa
  app.post('/api/auth/2fa/ativar', { onRequest: [logado], config: limite2fa }, async (req, reply) => {
    const { rows: [u] } = await pool.query('select totp_segredo, totp_ativo from usuarios where id = $1', [req.usuario.id])
    if (u.totp_ativo) return reply.code(400).send({ mensagem: 'A verificação em duas etapas já está ativa.' })
    const passo = conferirCodigo(u.totp_segredo, req.body?.codigo)
    if (passo === null) return reply.code(400).send({ mensagem: 'Código inválido. Confira o aplicativo e tente de novo.' })
    await pool.query('update usuarios set totp_ativo = true, totp_ultimo_passo = $1 where id = $2', [passo, req.usuario.id])
    req.log.info({ email: req.usuario.email }, 'Verificação em duas etapas ativada')
    return { ok: true }
  })

  // 3) desativa (pede a senha)
  app.post('/api/auth/2fa/desativar', { onRequest: [logado], config: limite2fa }, async (req, reply) => {
    const { rows: [u] } = await pool.query('select senha_hash from usuarios where id = $1', [req.usuario.id])
    let ok
    try { ok = await conferirSenha(String(req.body?.senha ?? ''), u.senha_hash) } catch (e) { if (e.code === 'OCUPADO') return ocupado(reply); throw e }
    if (!ok) return reply.code(400).send({ mensagem: 'Senha incorreta.' })
    await pool.query('update usuarios set totp_ativo = false, totp_segredo = null, totp_ultimo_passo = null where id = $1', [req.usuario.id])
    req.log.info({ email: req.usuario.email }, 'Verificação em duas etapas desativada')
    return { ok: true }
  })
}
