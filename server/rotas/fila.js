import { STATUS } from '../../shared/opcoes.js'
import { transacao } from '../db.js'

const STATUS_VALIDOS = STATUS.map((s) => s.valor)

export default async function rotasFila(app) {
  const { pool } = app
  const autenticado = { onRequest: [app.exigirLogin] }

  // Todas as pré-fichas, na ordem da fila (data/hora de inscrição).
  app.get('/api/admin/pre-fichas', autenticado, async () => {
    const { rows } = await pool.query(
      `select p.*, u.nome as atualizado_por_nome
         from pre_fichas p left join usuarios u on u.id = p.atualizado_por
        order by p.created_at, p.id`)
    for (const r of rows) delete r.ip_origem
    return rows
  })

  app.get('/api/admin/pre-fichas/:id/historico', autenticado, async (req) => {
    const { rows } = await pool.query(
      `select h.id, h.criado_em, h.status_anterior, h.status_novo, h.observacao, u.nome as usuario
         from pre_fichas_historico h left join usuarios u on u.id = h.usuario_id
        where h.pre_ficha_id = $1 order by h.criado_em desc, h.id desc`,
      [Number(req.params.id)])
    return rows
  })

  // A equipe só altera status e observações internas.
  app.patch('/api/admin/pre-fichas/:id', autenticado, async (req, reply) => {
    const id = Number(req.params.id)
    const corpo = req.body ?? {}
    const temStatus = Object.hasOwn(corpo, 'status')
    const temObs = Object.hasOwn(corpo, 'observacoes_internas')
    if (!Number.isInteger(id) || (!temStatus && !temObs)) return reply.code(400).send({ mensagem: 'Nada para alterar.' })
    if (temStatus && !STATUS_VALIDOS.includes(corpo.status)) return reply.code(400).send({ mensagem: 'Status inválido.' })
    const obs = temObs ? (typeof corpo.observacoes_internas === 'string' ? corpo.observacoes_internas.trim() : '') : null
    if (temObs && obs.length > 4000) return reply.code(400).send({ mensagem: 'Observação longa demais.' })

    const atualizada = await transacao(pool, async (db) => {
      const { rows: [antes] } = await db.query(
        'select status, observacoes_internas from pre_fichas where id = $1 for update', [id])
      if (!antes) return null
      const novoStatus = temStatus ? corpo.status : antes.status
      const novaObs = temObs ? (obs || null) : antes.observacoes_internas
      const { rows: [depois] } = await db.query(
        `update pre_fichas set status = $1, observacoes_internas = $2, atualizado_em = now(), atualizado_por = $3
          where id = $4 returning *`,
        [novoStatus, novaObs, req.usuario.id, id])
      const mudouStatus = novoStatus !== antes.status
      const mudouObs = (novaObs ?? '') !== (antes.observacoes_internas ?? '')
      if (mudouStatus || mudouObs) {
        await db.query(
          `insert into pre_fichas_historico (pre_ficha_id, usuario_id, status_anterior, status_novo, observacao)
           values ($1, $2, $3, $4, $5)`,
          [id, req.usuario.id, mudouStatus ? antes.status : null, mudouStatus ? novoStatus : null,
            mudouObs ? (novaObs ?? '(observação apagada)') : null])
      }
      return depois
    })
    if (!atualizada) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    delete atualizada.ip_origem
    return { ...atualizada, atualizado_por_nome: req.usuario.nome }
  })
}
