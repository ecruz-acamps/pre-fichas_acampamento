import { STATUS } from '../../shared/opcoes.js'
import { transacao } from '../db.js'
import { filtroEscopo, nucleosDoUsuario, podeVerFicha } from '../escopo.js'
import { carregarMarca } from '../marca.js'

const STATUS_VALIDOS = STATUS.map((s) => s.valor)
// Status que significam "a pessoa aceitou": zeram a contagem de recusas seguidas
const STATUS_ACEITE = ['confirmado', 'participou']
const TIPOS_AUDITORIA = ['inscricao', 'status', 'observacao', 'recusa', 'fim_da_fila', 'acampamento', 'preferencia', 'conjuge']
const DATA = /^\d{4}-\d{2}-\d{2}$/

const SQL_HISTORICO = `
  select h.id, h.pre_ficha_id, h.criado_em, h.tipo, h.status_anterior, h.status_novo, h.observacao, h.detalhes,
         u.nome as usuario
    from pre_fichas_historico h left join usuarios u on u.id = h.usuario_id`

/** Texto obrigatório (comentário/motivo). */
function lerTextoObrigatorio(valor, max = 1000) {
  const t = typeof valor === 'string' ? valor.trim() : ''
  return t && t.length <= max ? t : null
}

/**
 * Manda a ficha para o fim da fila (entrada_fila_em = agora). O banco registra
 * sozinho na trilha a data anterior, a nova, quem fez e o motivo.
 */
export async function moverParaFimDaFila(db, fichaId, usuarioId, motivo) {
  await db.query(`select set_config('app.usuario_id', $1, true), set_config('app.motivo', $2, true)`,
    [String(usuarioId), motivo])
  await db.query(
    `update pre_fichas set entrada_fila_em = clock_timestamp(), recusas_seguidas = 0,
            atualizado_em = now(), atualizado_por = $1
      where id = $2`, [usuarioId, fichaId])
  await db.query(`select set_config('app.usuario_id', '', true), set_config('app.motivo', '', true)`)
}

export const SQL_FICHAS = (where) => `
  select p.*, u.nome as atualizado_por_nome,
    coalesce((select array_agg(fn.nucleo_id order by fn.nucleo_id) from ficha_nucleos fn
               where fn.pre_ficha_id = p.id), '{}') as nucleos,
    coalesce((select json_agg(json_build_object(
                'acampamento_id', a.id, 'numero', a.numero, 'modalidade', a.modalidade,
                'data_inicio', a.data_inicio, 'tribo', pa.tribo) order by a.data_inicio nulls last, a.numero)
                from participacoes pa join acampamentos a on a.id = pa.acampamento_id
               where pa.pre_ficha_id = p.id), '[]') as participacoes,
    coalesce((select json_agg(json_build_object(
                'id', ps.id, 'origem', ps.origem, 'modalidade', ps.modalidade, 'acampamento_numero', ps.acampamento_numero,
                'valida_de', ps.valida_de, 'valida_ate', ps.valida_ate, 'situacao', ps.situacao,
                'conjuge_ficha_id', ps.conjuge_ficha_id, 'conjuge_nome', coalesce(c.nome_completo, ps.conjuge_nome),
                'observacao', ps.observacao, 'criado_em', ps.criado_em, 'motivo_revogacao', ps.motivo_revogacao)
                order by ps.criado_em desc)
                from preferencias_situacao ps left join pre_fichas c on c.id = ps.conjuge_ficha_id
               where ps.pre_ficha_id = p.id), '[]') as preferencias,
    (select c.nome_completo from pre_fichas c where c.id = p.conjuge_id) as conjuge_vinculado_nome,
    (p.participante_id is not null) as tem_conta, pc.email as conta_email, pc.ultimo_login as conta_ultimo_login,
    (pc.id is not null and pc.senha_hash is null) as conta_sem_senha
    from pre_fichas p left join usuarios u on u.id = p.atualizado_por
    left join participantes pc on pc.id = p.participante_id
   where ${where}
   order by p.entrada_fila_em, p.id`

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
    if (!(await podeVerFicha(pool, req.usuario, id, { leitura: true }))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows } = await pool.query(`${SQL_HISTORICO} where h.pre_ficha_id = $1 order by h.criado_em desc, h.id desc`, [id])
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
        `update pre_fichas set status = $1, observacoes_internas = $2, atualizado_em = now(), atualizado_por = $3,
                recusas_seguidas = case when $1 = any($5::text[]) then 0 else recusas_seguidas end
          where id = $4`, [novoStatus, novaObs, req.usuario.id, id, STATUS_ACEITE])
      await registrarHistorico(db, id, req.usuario.id, antes, novoStatus, novaObs)
      return true
    })
    if (!ok) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows: [f] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return limparFicha(f)
  })

  // A pessoa foi chamada e disse "não". Comentário obrigatório.
  // Ao atingir o limite de recusas seguidas (marca: recusasParaFimDaFila), vai para o fim da fila.
  app.post('/api/admin/pre-fichas/:id/recusa', autenticado, async (req, reply) => {
    const id = Number(req.params.id)
    const comentario = lerTextoObrigatorio(req.body?.comentario)
    if (!comentario) return reply.code(400).send({ mensagem: 'Escreva um comentário sobre a recusa.' })
    if (!(await podeVerFicha(pool, req.usuario, id))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { recusasParaFimDaFila: limite } = await carregarMarca(pool)

    const resultado = await transacao(pool, async (db) => {
      const { rows: [f] } = await db.query(
        'select status, recusas_seguidas, observacoes_internas from pre_fichas where id = $1 for update', [id])
      if (!f) return null
      if (f.status === 'participou') return { erro: 'Esta pessoa já participou do acampamento.' }
      const numero = f.recusas_seguidas + 1
      const vaiParaFim = limite > 0 && numero >= limite
      await db.query(
        `update pre_fichas set recusas_seguidas = $1, status = 'aguardando', atualizado_em = now(), atualizado_por = $2
          where id = $3`, [numero, req.usuario.id, id])
      await db.query(
        `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, status_anterior, status_novo, observacao, detalhes)
         values ($1, $2, 'recusa', $3, $4, $5, $6)`,
        [id, req.usuario.id, f.status, f.status !== 'aguardando' ? 'aguardando' : null, comentario,
          JSON.stringify({ numero, limite, foi_para_o_fim: vaiParaFim })])
      if (vaiParaFim) {
        await moverParaFimDaFila(db, id, req.usuario.id, `${numero}ª recusa seguida: ${comentario}`)
      }
      return { numero, movida: vaiParaFim }
    })
    if (!resultado) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    if (resultado.erro) return reply.code(400).send({ mensagem: resultado.erro })
    const { rows: [ficha] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return { ...resultado, ficha: limparFicha(ficha) }
  })

  // Mover para o fim da fila manualmente (motivo obrigatório; fica na trilha de auditoria)
  app.post('/api/admin/pre-fichas/:id/fim-da-fila', autenticado, async (req, reply) => {
    const id = Number(req.params.id)
    const motivo = lerTextoObrigatorio(req.body?.motivo)
    if (!motivo) return reply.code(400).send({ mensagem: 'Informe o motivo.' })
    if (!(await podeVerFicha(pool, req.usuario, id))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const ok = await transacao(pool, async (db) => {
      const { rows: [f] } = await db.query('select id from pre_fichas where id = $1 for update', [id])
      if (!f) return false
      await moverParaFimDaFila(db, id, req.usuario.id, motivo)
      return true
    })
    if (!ok) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows: [ficha] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return { ficha: limparFicha(ficha) }
  })

  // Todos os campistas (quem já fez algum acampamento), de TODOS os núcleos, com a ficha
  // completa — campistas não são restritos ao núcleo. `da_minha_area` indica se o
  // coordenador também pode ALTERAR a ficha (só as do seu núcleo).
  app.get('/api/admin/campistas', autenticado, async (req) => {
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const { rows } = await pool.query(
      SQL_FICHAS('exists (select 1 from participacoes pa where pa.pre_ficha_id = p.id)'))
    const { rows: ns } = await pool.query('select id, nome from nucleos')
    const nomes = new Map(ns.map((n) => [n.id, n.nome]))
    return rows.map((f) => ({
      ...limparFicha(f),
      nucleos_nomes: f.nucleos.map((id) => nomes.get(id) ?? ''),
      da_minha_area: escopo === null || f.nucleos.some((n) => escopo.includes(n)),
    }))
  })

  // Trilha de auditoria geral (respeita a área do coordenador)
  app.get('/api/admin/auditoria', autenticado, async (req) => {
    const q = req.query ?? {}
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const filtros = [filtroEscopo(1).replaceAll('p.id', 'h.pre_ficha_id')]
    const valores = [escopo]
    const add = (sql, valor) => { valores.push(valor); filtros.push(sql.replace('?', `$${valores.length}`)) }
    const tipos = String(q.tipo ?? '').split(',').filter((t) => TIPOS_AUDITORIA.includes(t))
    if (tipos.length) add('h.tipo = any(?::text[])', tipos)
    if (Number.isInteger(Number(q.usuario)) && q.usuario) add('h.usuario_id = ?', Number(q.usuario))
    if (DATA.test(q.de ?? '')) add(`h.criado_em >= (?::date)::timestamp at time zone 'America/Sao_Paulo'`, q.de)
    if (DATA.test(q.ate ?? '')) add(`h.criado_em < ((?::date) + 1)::timestamp at time zone 'America/Sao_Paulo'`, q.ate)
    if (Number.isInteger(Number(q.ficha)) && q.ficha) add('h.pre_ficha_id = ?', Number(q.ficha))
    const limite = Math.min(Math.max(Number.parseInt(q.limite, 10) || 300, 1), 2000)
    const { rows } = await pool.query(
      `select h.id, h.pre_ficha_id, h.criado_em, h.tipo, h.status_anterior, h.status_novo, h.observacao, h.detalhes,
              u.nome as usuario, p.nome_completo, p.modalidade, p.cidade, p.uf
         from pre_fichas_historico h
         join pre_fichas p on p.id = h.pre_ficha_id
         left join usuarios u on u.id = h.usuario_id
        where ${filtros.join(' and ')}
        order by h.criado_em desc, h.id desc
        limit ${limite}`, valores)
    return rows
  })
}

export async function registrarHistorico(db, fichaId, usuarioId, antes, novoStatus, novaObs, nota = null, detalhes = null) {
  const mudouStatus = novoStatus !== antes.status
  const mudouObs = (novaObs ?? '') !== (antes.observacoes_internas ?? '')
  if (!mudouStatus && !mudouObs && !nota) return
  const tipo = nota ? 'acampamento' : mudouStatus ? 'status' : 'observacao'
  await db.query(
    `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, status_anterior, status_novo, observacao, detalhes)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [fichaId, usuarioId, tipo, mudouStatus ? antes.status : null, mudouStatus ? novoStatus : null,
      nota ?? (mudouObs ? (novaObs ?? '(observação apagada)') : null), detalhes && JSON.stringify(detalhes)])
}
