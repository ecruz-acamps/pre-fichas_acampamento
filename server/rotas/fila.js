import { STATUS } from '../../shared/opcoes.js'
import { transacao } from '../db.js'
import { filtroEscopo, nucleosDoUsuario, podeVerFicha } from '../escopo.js'

const STATUS_VALIDOS = STATUS.map((s) => s.valor)

export const SQL_FICHAS = (where) => `
  select p.*, u.nome as atualizado_por_nome,
    coalesce((select array_agg(fn.nucleo_id order by fn.nucleo_id) from ficha_nucleos fn
               where fn.pre_ficha_id = p.id), '{}') as nucleos,
    coalesce((select json_agg(json_build_object(
                'acampamento_id', a.id, 'numero', a.numero, 'modalidade', a.modalidade,
                'data_inicio', a.data_inicio, 'tribo', pa.tribo) order by a.data_inicio nulls last, a.numero)
                from participacoes pa join acampamentos a on a.id = pa.acampamento_id
               where pa.pre_ficha_id = p.id), '[]') as participacoes
    from pre_fichas p left join usuarios u on u.id = p.atualizado_por
   where ${where}
   order by p.created_at, p.id`

export function limparFicha(f) {
  if (!f) return f
  delete f.ip_origem
  delete f.cidade_chave
  delete f.bairro_chave
  return f
}

export default async function rotasFila(app) {
  const { pool } = app
  const autenticado = { onRequest: [app.exigirLogin] }

  // Pré-fichas visíveis para o usuário, na ordem da fila (data/hora de inscrição).
  app.get('/api/admin/pre-fichas', autenticado, async (req) => {
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const { rows } = await pool.query(SQL_FICHAS(filtroEscopo(1)), [escopo])
    return rows.map(limparFicha)
  })

  app.get('/api/admin/pre-fichas/:id/historico', autenticado, async (req, reply) => {
    const id = Number(req.params.id)
    if (!(await podeVerFicha(pool, req.usuario, id))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows } = await pool.query(
      `select h.id, h.criado_em, h.status_anterior, h.status_novo, h.observacao, u.nome as usuario
         from pre_fichas_historico h left join usuarios u on u.id = h.usuario_id
        where h.pre_ficha_id = $1 order by h.criado_em desc, h.id desc`, [id])
    return rows
  })

  // Altera status e observações internas (únicos campos editáveis pela equipe).
  app.patch('/api/admin/pre-fichas/:id', autenticado, async (req, reply) => {
    const id = Number(req.params.id)
    const corpo = req.body ?? {}
    const temStatus = Object.hasOwn(corpo, 'status')
    const temObs = Object.hasOwn(corpo, 'observacoes_internas')
    if (!Number.isInteger(id) || (!temStatus && !temObs)) return reply.code(400).send({ mensagem: 'Nada para alterar.' })
    if (temStatus && !STATUS_VALIDOS.includes(corpo.status)) return reply.code(400).send({ mensagem: 'Status inválido.' })
    const obs = temObs ? (typeof corpo.observacoes_internas === 'string' ? corpo.observacoes_internas.trim() : '') : null
    if (temObs && obs.length > 4000) return reply.code(400).send({ mensagem: 'Observação longa demais.' })
    if (!(await podeVerFicha(pool, req.usuario, id))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })

    const ok = await transacao(pool, async (db) => {
      const { rows: [antes] } = await db.query(
        'select status, observacoes_internas from pre_fichas where id = $1 for update', [id])
      if (!antes) return false
      const novoStatus = temStatus ? corpo.status : antes.status
      const novaObs = temObs ? (obs || null) : antes.observacoes_internas
      await db.query(
        `update pre_fichas set status = $1, observacoes_internas = $2, atualizado_em = now(), atualizado_por = $3
          where id = $4`, [novoStatus, novaObs, req.usuario.id, id])
      await registrarHistorico(db, id, req.usuario.id, antes, novoStatus, novaObs)
      return true
    })
    if (!ok) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows: [f] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return limparFicha(f)
  })
}

export async function registrarHistorico(db, fichaId, usuarioId, antes, novoStatus, novaObs, nota = null) {
  const mudouStatus = novoStatus !== antes.status
  const mudouObs = (novaObs ?? '') !== (antes.observacoes_internas ?? '')
  if (!mudouStatus && !mudouObs && !nota) return
  await db.query(
    `insert into pre_fichas_historico (pre_ficha_id, usuario_id, status_anterior, status_novo, observacao)
     values ($1, $2, $3, $4, $5)`,
    [fichaId, usuarioId, mudouStatus ? antes.status : null, mudouStatus ? novoStatus : null,
      nota ?? (mudouObs ? (novaObs ?? '(observação apagada)') : null)])
}
