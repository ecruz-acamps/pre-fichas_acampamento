// Quais fichas cada usuário pode ver.
//   admin / equipe -> todas (retorna null)
//   coordenador    -> só as das cidades/bairros dos seus núcleos (lista de ids de núcleo)

export async function nucleosDoUsuario(pool, usuario) {
  if (usuario.papel !== 'coordenador') return null
  const { rows } = await pool.query('select nucleo_id from usuario_nucleos where usuario_id = $1', [usuario.id])
  return rows.map((r) => r.nucleo_id)
}

/** Trecho SQL que filtra pre_fichas "p" pelo escopo ($n = array de núcleos ou null). */
export const filtroEscopo = (n) =>
  `($${n}::bigint[] is null or exists (
     select 1 from ficha_nucleos fn where fn.pre_ficha_id = p.id and fn.nucleo_id = any($${n}::bigint[])))`

export async function podeVerFicha(pool, usuario, fichaId) {
  const escopo = await nucleosDoUsuario(pool, usuario)
  const { rows } = await pool.query(`select 1 from pre_fichas p where p.id = $1 and ${filtroEscopo(2)}`, [fichaId, escopo])
  return rows.length > 0
}
