import { gerarHash, senhaForte, verificarSenha, verificarSenhaFicticia } from '../senha.js'
import { COOKIE, criarSessao, encerrarOutrasSessoes, encerrarSessao } from '../sessao.js'

export default async function rotasAuth(app) {
  const { pool, config } = app

  const opcoesCookie = () => ({
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSeguro,
    maxAge: config.sessaoHoras * 3600,
  })

  app.post('/api/auth/login', {
    config: { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const senha = String(req.body?.senha ?? '')
    if (!email || !senha || senha.length > 200) return reply.code(400).send({ mensagem: 'Informe e-mail e senha.' })

    const { rows } = await pool.query('select id, senha_hash, ativo from usuarios where email = $1', [email])
    const usuario = rows[0]
    const ok = usuario ? await verificarSenha(senha, usuario.senha_hash) : await verificarSenhaFicticia(senha)
    if (!ok || !usuario.ativo) {
      req.log.warn({ email, ip: req.ip }, 'Login recusado')
      return reply.code(401).send({ mensagem: 'E-mail ou senha incorretos.' })
    }

    await pool.query('update usuarios set ultimo_login = now() where id = $1', [usuario.id])
    const token = await criarSessao(pool, usuario.id, config.sessaoHoras)
    reply.setCookie(COOKIE, token, opcoesCookie())
    const { rows: [eu] } = await pool.query(
      'select id, email, nome, papel, trocar_senha from usuarios where id = $1', [usuario.id])
    return { usuario: eu }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await encerrarSessao(pool, req.cookies[COOKIE])
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  // Quem está logado (usuario: null quando ninguém está)
  app.get('/api/auth/eu', async (req) => ({ usuario: req.usuario ?? null }))

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
    if (!(await verificarSenha(atual, u.senha_hash))) {
      return reply.code(400).send({ mensagem: 'A senha atual está incorreta.' })
    }
    await pool.query('update usuarios set senha_hash = $1, trocar_senha = false where id = $2',
      [await gerarHash(nova), req.usuario.id])
    await encerrarOutrasSessoes(pool, req.usuario.id, req.cookies[COOKIE])
    return { ok: true }
  })
}
