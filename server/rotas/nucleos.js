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
