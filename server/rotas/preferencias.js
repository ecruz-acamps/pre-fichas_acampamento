import { MODALIDADES } from '../../shared/opcoes.js'
import { transacao } from '../db.js'
import { carregarMarca } from '../marca.js'
import { criarPreferencia, preferenciaPorVinculo, revogarPreferencia } from '../preferencias.js'
import { SQL_FICHAS, limparFicha } from './fila.js'

export default async function rotasPreferencias(app) {
  const { pool } = app
  // Validar benefícios e vínculos: administradores e equipe
  const exigirGestao = async (req, reply) => {
    if (!['admin', 'equipe'].includes(req.usuario?.papel)) return reply.code(403).send({ mensagem: 'Sem permissão.' })
  }
  const gestao = { onRequest: [app.exigirLogin, exigirGestao] }
  const fichaAtualizada = async (id) => limparFicha((await pool.query(SQL_FICHAS('p.id = $1'), [id])).rows[0])

  // Vincula uma pré-ficha (ex.: feita antes das contas) à conta da pessoa, pelo CPF da conta.
  // cpf = null desvincula. A equipe confere a identidade antes (ex.: pelo telefone).
  app.put('/api/admin/pre-fichas/:id/conta', gestao, async (req, reply) => {
    const id = Number(req.params.id)
    const cpf = req.body?.cpf === null ? null : String(req.body?.cpf ?? '').replace(/\D/g, '')
    if (!Number.isInteger(id)) return reply.code(400).send({ mensagem: 'Pré-ficha inválida.' })
    let conta = null
    if (cpf !== null) {
      if (cpf.length !== 11) return reply.code(400).send({ mensagem: 'Informe o CPF da conta (11 dígitos).' })
      conta = (await pool.query('select id, email from participantes where cpf = $1', [cpf])).rows[0]
      if (!conta) return reply.code(404).send({ mensagem: 'Não existe conta com este CPF. Peça para a pessoa criar a conta primeiro.' })
    }
    const ok = await transacao(pool, async (db) => {
      const { rows: [f] } = await db.query('select id, participante_id from pre_fichas where id = $1 for update', [id])
      if (!f) return false
      await db.query('update pre_fichas set participante_id = $2, cpf = coalesce($3, cpf), atualizado_em = now(), atualizado_por = $4 where id = $1',
        [id, conta?.id ?? null, cpf, req.usuario.id])
      await db.query(
        `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes) values ($1, $2, 'observacao', $3, $4)`,
        [id, req.usuario.id, conta ? `Pré-ficha vinculada à conta ${conta.email}.` : 'Pré-ficha desvinculada da conta do participante.',
          JSON.stringify({ conta_anterior: f.participante_id, conta_nova: conta?.id ?? null })])
      return true
    })
    if (!ok) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    return { ficha: await fichaAtualizada(id) }
  })

  // Vincula (ou desvincula, com conjuge_id = null) as fichas de dois cônjuges.
  app.put('/api/admin/pre-fichas/:id/conjuge', gestao, async (req, reply) => {
    const id = Number(req.params.id)
    const conjugeId = req.body?.conjuge_id === null ? null : Number(req.body?.conjuge_id)
    if (conjugeId !== null && (!Number.isInteger(conjugeId) || conjugeId === id)) {
      return reply.code(400).send({ mensagem: 'Escolha a ficha do cônjuge.' })
    }
    const { edicoesPreferenciaConjuge: edicoes } = await carregarMarca(pool)
    const resultado = await transacao(pool, async (db) => {
      const ids = conjugeId ? [id, conjugeId] : [id]
      const { rows } = await db.query(
        'select id, nome_completo, conjuge_id from pre_fichas where id = any($1::bigint[]) order by id for update', [ids])
      const f = rows.find((r) => r.id === id)
      const c = rows.find((r) => r.id === conjugeId)
      if (!f || (conjugeId && !c)) return null
      const anteriores = [f.conjuge_id, c?.conjuge_id].filter((x) => x && !ids.includes(x))
      // desfaz vínculos anteriores (de ambos os lados)
      await db.query(
        'update pre_fichas set conjuge_id = null where id = any($1::bigint[]) or conjuge_id = any($1::bigint[])',
        [[...ids, ...anteriores]])
      if (conjugeId) {
        await db.query('update pre_fichas set conjuge_id = $2 where id = $1', [id, conjugeId])
        await db.query('update pre_fichas set conjuge_id = $2 where id = $1', [conjugeId, id])
      }
      const registrar = (fichaId, texto) => db.query(
        `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes) values ($1, $2, 'conjuge', $3, $4)`,
        [fichaId, req.usuario.id, texto, JSON.stringify({ conjuge_id: conjugeId })])
      if (conjugeId) {
        await registrar(id, `Vinculado(a) como cônjuge de ${c.nome_completo}`)
        await registrar(conjugeId, `Vinculado(a) como cônjuge de ${f.nome_completo}`)
        await preferenciaPorVinculo(db, { fichaA: id, fichaB: conjugeId, usuarioId: req.usuario.id, edicoes })
      } else if (f.conjuge_id) {
        await registrar(id, 'Vínculo de cônjuge removido')
        await registrar(f.conjuge_id, `Vínculo de cônjuge com ${f.nome_completo} removido`)
      }
      return true
    })
    if (!resultado) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    return { ficha: await fichaAtualizada(id) }
  })

  // Registra a preferência manualmente (ex.: o cônjuge fez o acampamento antes do sistema existir)
  app.post('/api/admin/pre-fichas/:id/preferencias', gestao, async (req, reply) => {
    const id = Number(req.params.id)
    const c = req.body ?? {}
    const numero = Number(c.acampamento_numero)
    if (!Number.isInteger(numero) || numero < 1 || numero > 100000) return reply.code(400).send({ mensagem: 'Informe o número do acampamento que o cônjuge fez.' })
    if (!MODALIDADES.some((m) => m.valor === c.modalidade)) return reply.code(400).send({ mensagem: 'Modalidade inválida.' })
    const conjugeFichaId = c.conjuge_ficha_id ? Number(c.conjuge_ficha_id) : null
    const conjugeNome = typeof c.conjuge_nome === 'string' ? c.conjuge_nome.trim().slice(0, 150) : ''
    if (!conjugeFichaId && !conjugeNome) return reply.code(400).send({ mensagem: 'Informe o nome do cônjuge.' })
    const observacao = typeof c.observacao === 'string' ? c.observacao.trim().slice(0, 1000) || null : null
    const { edicoesPreferenciaConjuge: edicoes } = await carregarMarca(pool)

    const r = await transacao(pool, async (db) => {
      const { rows: [f] } = await db.query('select id from pre_fichas where id = $1 for update', [id])
      if (!f) return null
      return criarPreferencia(db, {
        beneficiadaId: id, conjugeFichaId, conjugeNome: conjugeFichaId ? null : conjugeNome, modalidade: c.modalidade,
        numero, origem: 'manual', usuarioId: req.usuario.id, edicoes, observacao,
      })
    })
    if (!r) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    if (!r.criada) return reply.code(400).send({ mensagem: r.motivo })
    return reply.code(201).send({ ficha: await fichaAtualizada(id) })
  })

  app.post('/api/admin/preferencias/:id/revogar', gestao, async (req, reply) => {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 1000) : ''
    if (!motivo) return reply.code(400).send({ mensagem: 'Informe o motivo.' })
    const id = Number(req.params.id)
    const { rows: [pr] } = await pool.query('select pre_ficha_id from preferencias where id = $1', [id])
    if (!pr) return reply.code(404).send({ mensagem: 'Preferência não encontrada.' })
    const ok = await transacao(pool, (db) => revogarPreferencia(db, id, req.usuario.id, motivo))
    if (!ok) return reply.code(400).send({ mensagem: 'Esta preferência já foi revogada.' })
    return { ficha: await fichaAtualizada(pr.pre_ficha_id) }
  })
}
