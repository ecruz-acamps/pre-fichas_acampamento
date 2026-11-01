import { UFS } from '../../shared/opcoes.js'
import { transacao } from '../db.js'
import { nucleosDoUsuario } from '../escopo.js'

function validarNucleo(corpo) {
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : ''
  if (!nome || nome.length > 120) return { erro: 'Informe o nome do núcleo.' }
  const areas = Array.isArray(corpo?.areas) ? corpo.areas : []
  if (areas.length > 500) return { erro: 'Áreas demais.' }
  const limpas = []
  for (const a of areas) {
    const uf = String(a?.uf ?? '').toUpperCase()
    const cidade = String(a?.cidade ?? '').trim()
    const bairro = String(a?.bairro ?? '').trim() || null
    if (!UFS.includes(uf)) return { erro: `UF inválida: ${uf || '(vazia)'}` }
    if (!cidade || cidade.length > 100) return { erro: 'Informe a cidade de cada área.' }
    if (bairro && bairro.length > 100) return { erro: 'Nome de bairro longo demais.' }
    limpas.push({ uf, cidade, bairro })
  }
  return { nome, areas: limpas }
}

// Entre as grafias digitadas ("FLORIANOPOLIS", "Florianópolis"), escolhe a mais usada,
// preferindo a que não está toda em maiúsculas e a que tem acentos.
const MELHOR_GRAFIA = (campo) => `(select g from unnest(array_agg(${campo})) g where g is not null
  group by g order by count(*) desc, (g = upper(g)), (left(g, 1) = upper(left(g, 1))) desc, g desc limit 1)`

export default async function rotasNucleos(app) {
  const { pool } = app
  const autenticado = { onRequest: [app.exigirLogin] }
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  // Núcleos com suas áreas, coordenadores e quantas pessoas estão na fila
  app.get('/api/admin/nucleos', autenticado, async (req) => {
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const { rows } = await pool.query(
      `select n.id, n.nome,
         coalesce((select json_agg(json_build_object('uf', a.uf, 'cidade', a.cidade, 'bairro', a.bairro)
                    order by a.uf, a.cidade, a.bairro nulls first) from nucleo_areas a where a.nucleo_id = n.id), '[]') as areas,
         coalesce((select json_agg(json_build_object('id', u.id, 'nome', u.nome) order by u.nome)
                     from usuario_nucleos un join usuarios u on u.id = un.usuario_id
                    where un.nucleo_id = n.id and u.ativo), '[]') as coordenadores,
         (select count(*)::int from ficha_nucleos fn join pre_fichas p on p.id = fn.pre_ficha_id
           where fn.nucleo_id = n.id and p.status in ('aguardando', 'em_contato')) as na_fila
         from nucleos n
        where $1::bigint[] is null or n.id = any($1::bigint[])
        order by n.nome`, [escopo])
    return rows
  })

  async function gravar(req, reply, id = null) {
    const v = validarNucleo(req.body)
    if (v.erro) return reply.code(400).send({ mensagem: v.erro })
    try {
      const nucleoId = await transacao(pool, async (db) => {
        let nid = id
        if (nid) {
          const r = await db.query('update nucleos set nome = $1 where id = $2', [v.nome, nid])
          if (!r.rowCount) return null
          await db.query('delete from nucleo_areas where nucleo_id = $1', [nid])
        } else {
          nid = (await db.query('insert into nucleos (nome) values ($1) returning id', [v.nome])).rows[0].id
        }
        for (const a of v.areas) {
          await db.query(
            `insert into nucleo_areas (nucleo_id, uf, cidade, bairro) values ($1, $2, $3, $4)
             on conflict do nothing`, [nid, a.uf, a.cidade, a.bairro])
        }
        return nid
      })
      if (!nucleoId) return reply.code(404).send({ mensagem: 'Núcleo não encontrado.' })
      return reply.code(id ? 200 : 201).send({ id: nucleoId })
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ mensagem: 'Já existe um núcleo com este nome.' })
      throw e
    }
  }

  app.post('/api/admin/nucleos', soAdmin, (req, reply) => gravar(req, reply))
  app.put('/api/admin/nucleos/:id', soAdmin, (req, reply) => gravar(req, reply, Number(req.params.id)))

  app.delete('/api/admin/nucleos/:id', soAdmin, async (req, reply) => {
    const r = await pool.query('delete from nucleos where id = $1', [Number(req.params.id)])
    if (!r.rowCount) return reply.code(404).send({ mensagem: 'Núcleo não encontrado.' })
    return { ok: true }
  })

  // ----- Dividir uma cidade entre núcleos, bairro a bairro (ex.: Palhoça em 4 núcleos) -----

  // Bairros da cidade: os que aparecem nas fichas + os já cadastrados em algum núcleo,
  // com o núcleo atual de cada um e quantas fichas há em cada bairro.
  app.get('/api/admin/nucleos/divisao', soAdmin, async (req, reply) => {
    const uf = String(req.query.uf ?? '').toUpperCase()
    const cidade = String(req.query.cidade ?? '').trim()
    if (!UFS.includes(uf) || !cidade) return reply.code(400).send({ mensagem: 'Informe UF e cidade.' })
    const { rows: bairros } = await pool.query(
      `with fichas as (
         select bairro_chave as chave, ${MELHOR_GRAFIA('bairro')} as nome, count(*)::int as fichas,
                count(*) filter (where status in ('aguardando', 'em_contato'))::int as na_fila
           from pre_fichas where uf = $1 and cidade_chave = chave_local($2) and bairro_chave is not null
          group by bairro_chave),
       areas as (
         select a.bairro_chave as chave, min(a.bairro) as nome, min(a.nucleo_id) as nucleo_id
           from nucleo_areas a where a.uf = $1 and a.cidade_chave = chave_local($2) and a.bairro_chave is not null
          group by a.bairro_chave)
       select coalesce(f.chave, a.chave) as chave, coalesce(f.nome, a.nome) as bairro,
              coalesce(f.fichas, 0) as fichas, coalesce(f.na_fila, 0) as na_fila, a.nucleo_id
         from fichas f full join areas a on a.chave = f.chave
        order by 2`, [uf, cidade])
    const { rows: [extra] } = await pool.query(
      `select count(*) filter (where bairro_chave is null)::int as sem_bairro,
              count(*)::int as total
         from pre_fichas where uf = $1 and cidade_chave = chave_local($2)`, [uf, cidade])
    const { rows: cidadeInteira } = await pool.query(
      `select n.id, n.nome from nucleo_areas a join nucleos n on n.id = a.nucleo_id
        where a.uf = $1 and a.cidade_chave = chave_local($2) and a.bairro_chave is null`, [uf, cidade])
    return { uf, cidade, bairros, sem_bairro: extra.sem_bairro, total: extra.total, cidade_inteira: cidadeInteira }
  })

  // Salva a divisão: cada bairro vai para no máximo um núcleo. Substitui as áreas
  // daquela cidade (inclusive "cidade inteira") nos núcleos; outras cidades não mudam.
  app.put('/api/admin/nucleos/divisao', soAdmin, async (req, reply) => {
    const uf = String(req.body?.uf ?? '').toUpperCase()
    const cidade = String(req.body?.cidade ?? '').trim()
    const atribuicoes = Array.isArray(req.body?.atribuicoes) ? req.body.atribuicoes : null
    if (!UFS.includes(uf) || !cidade || cidade.length > 100) return reply.code(400).send({ mensagem: 'Informe UF e cidade.' })
    if (!atribuicoes || atribuicoes.length > 1000) return reply.code(400).send({ mensagem: 'Lista de bairros inválida.' })
    const limpas = []
    for (const a of atribuicoes) {
      const bairro = String(a?.bairro ?? '').trim()
      const nucleoId = a?.nucleo_id === null || a?.nucleo_id === undefined || a?.nucleo_id === '' ? null : Number(a.nucleo_id)
      if (!bairro || bairro.length > 100) return reply.code(400).send({ mensagem: 'Nome de bairro inválido.' })
      if (nucleoId !== null && !Number.isInteger(nucleoId)) return reply.code(400).send({ mensagem: 'Núcleo inválido.' })
      if (nucleoId !== null) limpas.push({ bairro, nucleoId })
    }
    const ids = [...new Set(limpas.map((a) => a.nucleoId))]
    const { rows: existentes } = await pool.query('select id from nucleos where id = any($1::bigint[])', [ids])
    if (existentes.length !== ids.length) return reply.code(400).send({ mensagem: 'Algum núcleo escolhido não existe mais.' })

    const resultado = await transacao(pool, async (db) => {
      const { rowCount: removidas } = await db.query(
        'delete from nucleo_areas where uf = $1 and cidade_chave = chave_local($2)', [uf, cidade])
      let inseridas = 0
      for (const a of limpas) {
        const r = await db.query(
          `insert into nucleo_areas (nucleo_id, uf, cidade, bairro) values ($1, $2, $3, $4)
           on conflict do nothing`, [a.nucleoId, uf, cidade, a.bairro])
        inseridas += r.rowCount
      }
      return { removidas, inseridas }
    })
    req.log.info({ por: req.usuario.email, uf, cidade, ...resultado }, 'Divisão de cidade em núcleos salva')
    return { ok: true, ...resultado }
  })

  // Cidades e bairros que aparecem nas fichas (para montar as áreas dos núcleos)
  app.get('/api/admin/localidades', soAdmin, async () => {
    const { rows } = await pool.query(
      `select uf, ${MELHOR_GRAFIA('cidade')} as cidade, ${MELHOR_GRAFIA('bairro')} as bairro,
              count(*)::int as fichas,
              exists (select 1 from ficha_nucleos fn join pre_fichas p2 on p2.id = fn.pre_ficha_id
                       where p2.uf = p.uf and p2.cidade_chave = p.cidade_chave
                         and p2.bairro_chave is not distinct from p.bairro_chave) as coberto
         from pre_fichas p
        group by uf, cidade_chave, bairro_chave
        order by uf, cidade_chave, bairro_chave nulls first`)
    return rows
  })
}
