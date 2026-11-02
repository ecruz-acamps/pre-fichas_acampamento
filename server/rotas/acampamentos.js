import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { transacao } from '../db.js'
import { carregarMarca } from '../marca.js'
import { registrarHistorico } from './fila.js'
import { preferenciaPorParticipacao, revogarPorParticipacaoRemovida } from '../preferencias.js'

const DATA = /^\d{4}-\d{2}-\d{2}$/

function validarAcampamento(c) {
  const numero = Number(c?.numero)
  if (!Number.isInteger(numero) || numero < 1 || numero > 100000) return { erro: 'Número do acampamento inválido.' }
  if (!MODALIDADES.some((m) => m.valor === c?.modalidade)) return { erro: 'Modalidade inválida.' }
  const data = (v) => (v && DATA.test(v) ? v : null)
  const inicio = data(c.data_inicio)
  const fim = data(c.data_fim)
  if (inicio && fim && fim < inicio) return { erro: 'A data final é anterior à inicial.' }
  const observacao = typeof c.observacao === 'string' ? c.observacao.trim().slice(0, 1000) || null : null
  return { numero, modalidade: c.modalidade, data_inicio: inicio, data_fim: fim, observacao }
}

export const nomeAcampamento = (a) => `${a.numero}º ${rotuloDe(MODALIDADES, a.modalidade)}`

export default async function rotasAcampamentos(app) {
  const { pool } = app
  // Registrar acampamentos: administradores e equipe
  const exigirGestao = async (req, reply) => {
    if (!['admin', 'equipe'].includes(req.usuario?.papel)) return reply.code(403).send({ mensagem: 'Sem permissão.' })
  }
  const gestao = () => ({ onRequest: [app.exigirLogin, exigirGestao] })

  app.get('/api/admin/acampamentos', gestao(), async () => {
    const { rows } = await pool.query(
      `select a.*,
         (select count(*)::int from participacoes pa where pa.acampamento_id = a.id) as participantes,
         coalesce((select json_object_agg(coalesce(t.tribo, ''), t.n) from (
            select tribo, count(*)::int n from participacoes pa where pa.acampamento_id = a.id group by tribo) t), '{}') as por_tribo
         from acampamentos a
        order by a.data_inicio desc nulls last, a.numero desc`)
    return rows
  })

  app.post('/api/admin/acampamentos', gestao(), async (req, reply) => {
    const v = validarAcampamento(req.body)
    if (v.erro) return reply.code(400).send({ mensagem: v.erro })
    try {
      const { rows: [a] } = await pool.query(
        `insert into acampamentos (numero, modalidade, data_inicio, data_fim, observacao, criado_por)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [v.numero, v.modalidade, v.data_inicio, v.data_fim, v.observacao, req.usuario.id])
      return reply.code(201).send(a)
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ mensagem: `O ${nomeAcampamento(v)} já está cadastrado.` })
      throw e
    }
  })

  app.patch('/api/admin/acampamentos/:id', gestao(), async (req, reply) => {
    const v = validarAcampamento(req.body)
    if (v.erro) return reply.code(400).send({ mensagem: v.erro })
    try {
      const { rows: [a] } = await pool.query(
        `update acampamentos set numero = $1, modalidade = $2, data_inicio = $3, data_fim = $4, observacao = $5
          where id = $6 returning *`,
        [v.numero, v.modalidade, v.data_inicio, v.data_fim, v.observacao, Number(req.params.id)])
      if (!a) return reply.code(404).send({ mensagem: 'Acampamento não encontrado.' })
      return a
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ mensagem: `O ${nomeAcampamento(v)} já está cadastrado.` })
      throw e
    }
  })

  app.delete('/api/admin/acampamentos/:id', gestao(), async (req, reply) => {
    const id = Number(req.params.id)
    const { rows: [{ n }] } = await pool.query('select count(*)::int n from participacoes where acampamento_id = $1', [id])
    if (n > 0) return reply.code(400).send({ mensagem: 'Remova os participantes antes de excluir o acampamento.' })
    const r = await pool.query('delete from acampamentos where id = $1', [id])
    if (!r.rowCount) return reply.code(404).send({ mensagem: 'Acampamento não encontrado.' })
    return { ok: true }
  })

  app.get('/api/admin/acampamentos/:id', gestao(), async (req, reply) => {
    const id = Number(req.params.id)
    const { rows: [a] } = await pool.query('select * from acampamentos where id = $1', [id])
    if (!a) return reply.code(404).send({ mensagem: 'Acampamento não encontrado.' })
    const { rows: participantes } = await pool.query(
      `select pa.pre_ficha_id, pa.tribo, pa.registrado_em, u.nome as registrado_por,
              p.nome_completo, p.data_nascimento, p.sexo, p.telefone, p.cidade, p.uf, p.bairro, p.modalidade
         from participacoes pa
         join pre_fichas p on p.id = pa.pre_ficha_id
         left join usuarios u on u.id = pa.registrado_por
        where pa.acampamento_id = $1
        order by pa.tribo nulls last, p.nome_completo`, [id])
    return { ...a, participantes }
  })

  // Marca que a pessoa fez o acampamento (e a cor da tribo). A ficha sai da fila.
  app.put('/api/admin/acampamentos/:id/participantes/:fichaId', gestao(), async (req, reply) => {
    const id = Number(req.params.id)
    const fichaId = Number(req.params.fichaId)
    const tribo = typeof req.body?.tribo === 'string' && req.body.tribo.trim() ? req.body.tribo.trim() : null
    const marca = await carregarMarca(pool)
    if (tribo && !marca.tribos.some((t) => t.nome === tribo)) return reply.code(400).send({ mensagem: 'Tribo inválida.' })

    const resultado = await transacao(pool, async (db) => {
      const { rows: [a] } = await db.query('select * from acampamentos where id = $1', [id])
      const { rows: [f] } = await db.query(
        'select id, status, observacoes_internas from pre_fichas where id = $1 for update', [fichaId])
      if (!a || !f) return null
      const { rows: [antes] } = await db.query(
        'select tribo from participacoes where acampamento_id = $1 and pre_ficha_id = $2', [id, fichaId])
      await db.query(
        `insert into participacoes (acampamento_id, pre_ficha_id, tribo, registrado_por) values ($1, $2, $3, $4)
         on conflict (acampamento_id, pre_ficha_id)
         do update set tribo = excluded.tribo, registrado_em = now(), registrado_por = excluded.registrado_por`,
        [id, fichaId, tribo, req.usuario.id])
      if (f.status !== 'participou') {
        await db.query(`update pre_fichas set status = 'participou', recusas_seguidas = 0, atualizado_em = now(), atualizado_por = $1
          where id = $2`, [req.usuario.id, fichaId])
      }
      if (!antes || antes.tribo !== tribo) {
        const nota = `${antes ? 'Tribo alterada' : 'Fez o'} ${nomeAcampamento(a)}${tribo ? ` — tribo ${tribo}` : ''}`
        await registrarHistorico(db, fichaId, req.usuario.id, f, 'participou', f.observacoes_internas, nota)
      }
      // Regra do cônjuge: quem tem cônjuge vinculado gera a preferência para ele
      if (!antes && marca.preferenciaConjuge !== false) {
        await preferenciaPorParticipacao(db, { fichaId, acampamento: a, usuarioId: req.usuario.id, edicoes: marca.edicoesPreferenciaConjuge })
      }
      return { ok: true }
    })
    if (!resultado) return reply.code(404).send({ mensagem: 'Acampamento ou pré-ficha não encontrado.' })
    return resultado
  })

  // Desfaz o registro (ex.: marcado por engano). A ficha volta como "Confirmado".
  app.delete('/api/admin/acampamentos/:id/participantes/:fichaId', gestao(), async (req, reply) => {
    const id = Number(req.params.id)
    const fichaId = Number(req.params.fichaId)
    const resultado = await transacao(pool, async (db) => {
      const { rows: [a] } = await db.query('select * from acampamentos where id = $1', [id])
      const r = await db.query('delete from participacoes where acampamento_id = $1 and pre_ficha_id = $2', [id, fichaId])
      if (!a || !r.rowCount) return null
      const { rows: [f] } = await db.query(
        'select status, observacoes_internas from pre_fichas where id = $1 for update', [fichaId])
      const { rows: [{ n }] } = await db.query('select count(*)::int n from participacoes where pre_ficha_id = $1', [fichaId])
      const novoStatus = n === 0 && f.status === 'participou' ? 'confirmado' : f.status
      if (novoStatus !== f.status) {
        await db.query('update pre_fichas set status = $1, atualizado_em = now(), atualizado_por = $2 where id = $3',
          [novoStatus, req.usuario.id, fichaId])
      }
      await registrarHistorico(db, fichaId, req.usuario.id, f, novoStatus, f.observacoes_internas,
        `Registro no ${nomeAcampamento(a)} removido`)
      await revogarPorParticipacaoRemovida(db, { fichaId, acampamento: a, usuarioId: req.usuario.id })
      return { ok: true }
    })
    if (!resultado) return reply.code(404).send({ mensagem: 'Registro não encontrado.' })
    return resultado
  })
}
