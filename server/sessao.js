import { createHash, randomBytes } from 'node:crypto'

export const COOKIE = 'prefichas_sessao'
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export async function criarSessao(pool, usuarioId, horas) {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `insert into sessoes (id, usuario_id, expira_em) values ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), usuarioId, horas],
  )
  return token
}

/** Retorna o usuário da sessão (e renova a validade), ou null. */
export async function buscarSessao(pool, token, horas) {
  if (!token) return null
  const { rows } = await pool.query(
    `update sessoes s set expira_em = now() + make_interval(hours => $2)
       from usuarios u
      where s.id = $1 and s.expira_em > now() and u.id = s.usuario_id and u.ativo
      returning u.id, u.email, u.nome, u.papel, u.trocar_senha`,
    [hashToken(token), horas],
  )
  return rows[0] ?? null
}

export async function encerrarSessao(pool, token) {
  if (token) await pool.query('delete from sessoes where id = $1', [hashToken(token)])
}

export async function encerrarOutrasSessoes(pool, usuarioId, tokenAtual) {
  await pool.query('delete from sessoes where usuario_id = $1 and id <> $2', [usuarioId, hashToken(tokenAtual ?? '')])
}

export async function limparSessoesExpiradas(pool) {
  await pool.query('delete from sessoes where expira_em < now()')
}
