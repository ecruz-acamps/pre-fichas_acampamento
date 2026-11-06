// "Esqueci minha senha" dos usuários do painel do acampamento (admin e equipe).
// O e-mail leva um link com um token aleatório; no banco fica só o hash dele. Vale 1 hora, uma única vez.
import { createHash, randomBytes } from 'node:crypto'

const hash = (token) => createHash('sha256').update(token).digest('hex')

/** Cria o token (1 h). Devolve null se já foi pedido há menos de 2 minutos para este usuário. */
export async function criarRedefinicaoUsuario(pool, usuarioId) {
  const { rows: [recente] } = await pool.query(
    `select 1 from usuarios_redefinicoes where usuario_id = $1 and criado_em > now() - interval '2 minutes'`, [usuarioId])
  if (recente) return null
  await pool.query('delete from usuarios_redefinicoes where usuario_id = $1', [usuarioId])
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `insert into usuarios_redefinicoes (id, usuario_id, expira_em) values ($1, $2, now() + interval '1 hour')`,
    [hash(token), usuarioId])
  return token
}

/** Confere o token SEM consumi-lo (a verificação em duas etapas ainda pode faltar). */
export async function consultarRedefinicaoUsuario(pool, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const { rows: [r] } = await pool.query(
    `select r.id as token_id, u.id, u.email, u.ativo, u.totp_ativo, u.totp_segredo, u.totp_ultimo_passo
       from usuarios_redefinicoes r join usuarios u on u.id = r.usuario_id
      where r.id = $1 and r.usado_em is null and r.expira_em > now()`, [hash(token)])
  return r?.ativo ? r : null
}

/** Consome o token (uma vez só). Devolve true se este pedido foi o que consumiu. */
export async function consumirRedefinicaoUsuario(pool, tokenId) {
  const { rowCount } = await pool.query(
    'update usuarios_redefinicoes set usado_em = now() where id = $1 and usado_em is null', [tokenId])
  return rowCount === 1
}
