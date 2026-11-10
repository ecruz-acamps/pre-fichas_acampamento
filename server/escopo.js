import { carregarMarca } from './marca.js'

// Quais fichas cada usuário pode ver e alterar.
//   admin / equipe -> todas (escopo null)
//   coordenador    -> ALTERAR e ver pré-fichas: só as das cidades/bairros dos seus núcleos;
//                     VER campistas (quem já fez o acampamento): todos, de qualquer núcleo.
//                     Com a opção "coordenadores veem todas as fichas" (Configurações), VER (só consulta) todas as pré-fichas;
//                     ALTERAR continua só nas do núcleo dele.

export async function nucleosDoUsuario(pool, usuario) {
  if (usuario.papel !== 'coordenador') return null
  const { rows } = await pool.query('select nucleo_id from usuario_nucleos where usuario_id = $1', [usuario.id])
  return rows.map((r) => r.nucleo_id)
}

/** Escopo de CONSULTA: igual ao de alteração, a menos que a opção "coordenadores veem todas as fichas" esteja ligada (null = todas). */
export async function escopoLeitura(pool, usuario) {
  const escopo = await nucleosDoUsuario(pool, usuario)
  if (escopo === null) return null
  return (await carregarMarca(pool)).coordenadorVeTudo === true ? null : escopo
}

/** Trecho SQL que filtra pre_fichas "p" pelo escopo ($n = array de núcleos ou null). */
export const filtroEscopo = (n) =>
  `($${n}::bigint[] is null or exists (
     select 1 from ficha_nucleos fn where fn.pre_ficha_id = p.id and fn.nucleo_id = any($${n}::bigint[])))`

/** Leitura: o escopo do núcleo OU qualquer campista (campistas não são restritos). */
export const filtroLeitura = (n) =>
  `(${filtroEscopo(n)} or exists (select 1 from participacoes pa where pa.pre_ficha_id = p.id))`

/**
 * Pode alterar a ficha (status, recusa, fim da fila)? Só dentro do escopo do núcleo.
 * Com { leitura: true }, também aceita qualquer campista (somente consulta).
 */
export async function podeVerFicha(pool, usuario, fichaId, { leitura = false } = {}) {
  const escopo = leitura ? await escopoLeitura(pool, usuario) : await nucleosDoUsuario(pool, usuario)
  const filtro = leitura ? filtroLeitura(2) : filtroEscopo(2)
  const { rows } = await pool.query(`select 1 from pre_fichas p where p.id = $1 and ${filtro}`, [fichaId, escopo])
  return rows.length > 0
}
