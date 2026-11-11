import { MODALIDADES, faixaDe } from '../../shared/opcoes.js'
import { carregarModalidades } from '../modalidades.js'

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
const slug = (rotulo) => {
  let v = semAcento(rotulo).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20).replace(/_+$/, '')
  if (!/^[a-z]/.test(v)) v = `m_${v}`.slice(0, 20)
  return v
}
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

/** Valida os dados de uma modalidade. `atual` = registro existente (regras especiais não mudam de natureza). */
function validar(c, atual = null) {
  const e = {}
  const rotulo = typeof c?.rotulo === 'string' ? c.rotulo.trim() : ''
  if (!rotulo || rotulo.length > 40) e.rotulo = 'Informe o nome (até 40 letras).'
  const regra = atual?.regra ?? 'idade'
  let min = Number(c?.min), max = Number(c?.max)
  if (regra === 'senior' || regra === 'casais') max = 200
  if (!inteiro(min, 0, 120)) e.min = 'Idade mínima de 0 a 120.'
  if (!inteiro(max, 0, 200)) e.max = 'Idade máxima de 0 a 200.'
  if (!e.min && !e.max && min > max) e.max = 'A idade máxima não pode ser menor que a mínima.'
  const casado = regra === 'casais' ? true : regra === 'senior' ? false : c?.casado === true
  return { e, v: { rotulo, min, max, casado, regra } }
}

export default async function rotasModalidades(app) {
  const { pool } = app
  const soAdmin = () => ({ onRequest: [app.exigirLogin, app.exigirAdmin] })
  const publica = () => MODALIDADES.map((m) => ({ valor: m.valor, rotulo: m.rotulo, regra: m.regra, min: m.min, max: m.max, casado: m.casado, ativa: m.ativa, faixa: m.faixa }))

  // Lista pública (o formulário precisa dela antes do login)
  app.get('/api/modalidades', async () => publica())

  app.get('/api/admin/modalidades', soAdmin(), async () => {
    const { rows } = await pool.query(
      `select m.valor, m.rotulo, m.regra, m.idade_min as min, m.idade_max as max, m.casado, m.ordem, m.ativa,
              (select count(*)::int from pre_fichas p where p.modalidade = m.valor) as fichas,
              (select count(*)::int from acampamentos a where a.modalidade = m.valor) as edicoes
         from modalidades m order by m.ordem, m.valor`)
    return rows.map((m) => ({ ...m, faixa: faixaDe(m) }))
  })

  app.post('/api/admin/modalidades', { ...soAdmin(), config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { e, v } = validar(req.body)
    if (Object.keys(e).length) return reply.code(400).send({ mensagem: 'Confira os campos.', erros: e })
    const valor = slug(v.rotulo)
    if (!/^[a-z][a-z0-9_]{1,19}$/.test(valor)) return reply.code(400).send({ mensagem: 'Confira os campos.', erros: { rotulo: 'Use um nome com letras ou números.' } })
    try {
      await pool.query(
        `insert into modalidades (valor, rotulo, regra, idade_min, idade_max, casado, ordem)
         values ($1, $2, 'idade', $3, $4, $5, coalesce((select max(ordem) from modalidades), 0) + 1)`, [valor, v.rotulo, v.min, v.max, v.casado])
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ mensagem: 'Já existe uma modalidade com este nome.', erros: { rotulo: 'Já existe uma modalidade com este nome.' } })
      throw err
    }
    await carregarModalidades(pool)
    req.log.info({ por: req.usuario.email, valor }, 'Modalidade criada')
    return reply.code(201).send({ valor })
  })

  // Reordenar (antes de /:valor para não confundir)
  app.put('/api/admin/modalidades/ordem', soAdmin(), async (req, reply) => {
    const valores = Array.isArray(req.body?.valores) ? req.body.valores.map(String) : []
    const { rows } = await pool.query('select valor from modalidades')
    if (valores.length !== rows.length || new Set(valores).size !== valores.length || !rows.every((r) => valores.includes(r.valor))) {
      return reply.code(400).send({ mensagem: 'A lista de modalidades não confere. Recarregue a página.' })
    }
    for (const [i, v] of valores.entries()) await pool.query('update modalidades set ordem = $2 where valor = $1', [v, i + 1])
    await carregarModalidades(pool)
    return { ok: true }
  })

  app.put('/api/admin/modalidades/:valor', soAdmin(), async (req, reply) => {
    const valor = String(req.params.valor)
    const { rows: [atual] } = await pool.query('select valor, regra, ativa from modalidades where valor = $1', [valor])
    if (!atual) return reply.code(404).send({ mensagem: 'Modalidade não encontrada.' })
    const { e, v } = validar(req.body, atual)
    const ativa = req.body?.ativa !== false
    if (Object.keys(e).length) return reply.code(400).send({ mensagem: 'Confira os campos.', erros: e })
    if (!ativa && atual.ativa) {
      const { rows: [{ n }] } = await pool.query('select count(*)::int n from modalidades where ativa and valor <> $1', [valor])
      if (n === 0) return reply.code(400).send({ mensagem: 'Deixe pelo menos uma modalidade ativa.' })
    }
    try {
      await pool.query('update modalidades set rotulo = $2, idade_min = $3, idade_max = $4, casado = $5, ativa = $6 where valor = $1', [valor, v.rotulo, v.min, v.max, v.casado, ativa])
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ mensagem: 'Já existe uma modalidade com este nome.', erros: { rotulo: 'Já existe uma modalidade com este nome.' } })
      throw err
    }
    await carregarModalidades(pool)
    req.log.info({ por: req.usuario.email, valor, ativa }, 'Modalidade alterada')
    return { ok: true }
  })

  app.delete('/api/admin/modalidades/:valor', soAdmin(), async (req, reply) => {
    const valor = String(req.params.valor)
    const { rows: [m] } = await pool.query('select regra from modalidades where valor = $1', [valor])
    if (!m) return reply.code(404).send({ mensagem: 'Modalidade não encontrada.' })
    if (m.regra !== 'idade') return reply.code(400).send({ mensagem: 'Sênior e Casais têm regras próprias do sistema e não podem ser excluídas (você pode desativá-las).' })
    try { await pool.query('delete from modalidades where valor = $1', [valor]) } catch (err) {
      if (err.code === '23503') return reply.code(409).send({ mensagem: 'Esta modalidade já tem fichas, edições ou preferências. Desative-a em vez de excluir.' })
      throw err
    }
    await carregarModalidades(pool)
    return { ok: true }
  })
}
