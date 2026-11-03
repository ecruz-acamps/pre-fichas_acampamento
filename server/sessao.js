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
  const id = hashToken(token)
  const { rows: [u] } = await pool.query(
    `select u.id, u.email, u.nome, u.papel, u.trocar_senha, u.totp_ativo,
            s.expira_em < now() + make_interval(hours => $2) / 2 as renovar
       from sessoes s join usuarios u on u.id = s.usuario_id
      where s.id = $1 and s.expira_em > now() and u.ativo`,
    [id, horas],
  )
  if (!u) return null
  // Renova a validade só depois de metade do prazo: evita uma escrita no banco a cada clique
  if (u.renovar) await pool.query('update sessoes set expira_em = now() + make_interval(hours => $2) where id = $1', [id, horas])
  delete u.renovar
  return u
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
