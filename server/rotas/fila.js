import { cabecalhosFoto } from '../foto.js'
import { MODALIDADES, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, modalidadesCompativeis } from '../../shared/util.js'
import { transacao } from '../db.js'
import { escopoLeitura, nucleosDoUsuario, podeVerFicha } from '../escopo.js'
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
    (pc.id is not null and pc.senha_hash is null) as conta_sem_senha,
    (select extract(epoch from pf.atualizado_em) * 1000 from participantes_fotos pf where pf.participante_id = p.participante_id) as foto_versao
    from pre_fichas p left join usuarios u on u.id = p.atualizado_por
    left join participantes pc on pc.id = p.participante_id
   where ${where}
   order by p.entrada_fila_em, p.id`

// Colunas da lista do painel (o detalhe completo vem de GET /api/admin/pre-fichas/:id).
const COLUNAS_LISTA = `p.id, p.created_at, p.entrada_fila_em, p.status, p.modalidade, p.nome_completo, p.data_nascimento,
  p.estado_civil, p.sexo, p.telefone, p.email, p.cidade, p.bairro, p.uf, p.paroquia, p.recusas_seguidas, p.cpf,
  p.conjuge_nome, p.conjuge_telefone, p.conjuge_fez_acampamento, p.conjuge_acampamento_numero, p.conjuge_id`

/**
 * Lista de fichas para o painel. Núcleos, participações e preferências são calculados UMA vez
 * (agrupados) em vez de uma subconsulta por linha. completo = true traz todas as colunas (exportação).
 */
export const SQL_LISTA = (where, { completo = false } = {}) => `
  with n as (
    select p.id, array_agg(distinct a.nucleo_id order by a.nucleo_id) as nucleos
      from pre_fichas p join nucleo_areas a
        on a.uf = p.uf and a.cidade_chave = p.cidade_chave and (a.bairro_chave is null or a.bairro_chave = p.bairro_chave)
     group by p.id),
  part as (
    select pa.pre_ficha_id, json_agg(json_build_object(
             'acampamento_id', a.id, 'numero', a.numero, 'modalidade', a.modalidade,
             'data_inicio', a.data_inicio, 'tribo', pa.tribo) order by a.data_inicio nulls last, a.numero) as lista
      from participacoes pa join acampamentos a on a.id = pa.acampamento_id
     group by pa.pre_ficha_id),
  pref as (
    select ps.pre_ficha_id, json_agg(json_build_object(
             'id', ps.id, 'origem', ps.origem, 'modalidade', ps.modalidade, 'acampamento_numero', ps.acampamento_numero,
             'valida_de', ps.valida_de, 'valida_ate', ps.valida_ate, 'situacao', ps.situacao,
             'conjuge_ficha_id', ps.conjuge_ficha_id, 'conjuge_nome', coalesce(c.nome_completo, ps.conjuge_nome),
             'observacao', ps.observacao, 'criado_em', ps.criado_em, 'motivo_revogacao', ps.motivo_revogacao)
             order by ps.criado_em desc) as lista
      from preferencias_situacao ps left join pre_fichas c on c.id = ps.conjuge_ficha_id
     group by ps.pre_ficha_id)
  select ${completo ? 'p.*, u.nome as atualizado_por_nome' : COLUNAS_LISTA},
         coalesce(n.nucleos, '{}') as nucleos,
         coalesce(part.lista, '[]') as participacoes,
         coalesce(pref.lista, '[]') as preferencias,
         cj.nome_completo as conjuge_vinculado_nome,
         (p.participante_id is not null) as tem_conta, pc.email as conta_email
    from pre_fichas p
    left join n on n.id = p.id
    left join part on part.pre_ficha_id = p.id
    left join pref on pref.pre_ficha_id = p.id
    left join pre_fichas cj on cj.id = p.conjuge_id
    left join participantes pc on pc.id = p.participante_id
    ${completo ? 'left join usuarios u on u.id = p.atualizado_por' : ''}
   where ${where}
   order by p.entrada_fila_em, p.id`

/** Filtro do escopo do coordenador sobre a lista ($n = array de núcleos ou null). */
const escopoLista = (n) => `($${n}::bigint[] is null or n.nucleos && $${n}::bigint[])`

export function limparFicha(f) {
  if (!f) return f
  delete f.ip_origem
  delete f.cidade_chave
  delete f.bairro_chave
  return f
}

export default async function rotasFila(app) {
  const { pool } = app
  const autenticado = () => ({ onRequest: [app.exigirLogin] })

  // Pré-fichas visíveis para o usuário, na ordem da fila (data/hora de inscrição).
  // ?completo=1 traz todas as colunas (exportação). O padrão é a lista resumida.
  app.get('/api/admin/pre-fichas', autenticado(), async (req) => {
    const [leitura, escrita] = [await escopoLeitura(pool, req.usuario), await nucleosDoUsuario(pool, req.usuario)]
    const completo = req.query?.completo === '1'
    const { rows } = await pool.query(SQL_LISTA(escopoLista(1), { completo }), [leitura])
    // editavel: dentro do núcleo do coordenador (as de fora, liberadas só para consulta, abrem em modo somente leitura)
    return rows.map((f) => ({ ...limparFicha(f), editavel: escrita === null || (f.nucleos ?? []).some((n) => escrita.includes(n)) }))
  })

  // ---- Revisão de modalidade: só administrador e coordenador de núcleo (dentro do seu escopo) ----
  const revisor = () => ({ onRequest: [app.exigirLogin, async (req, reply) => {
    if (!['admin', 'coordenador'].includes(req.usuario.papel)) return reply.code(403).send({ mensagem: 'Apenas administradores e coordenadores de núcleo.' })
  }] })

  // Fichas com a palavra "revisar" nas observações internas (as importadas com modalidade fora da regra vêm assim)
  app.get('/api/admin/pre-fichas/revisar', revisor(), async (req) => {
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const { rows } = await pool.query(SQL_LISTA(`${escopoLista(1)} and p.observacoes_internas ~* 'revisar'`, { completo: true }), [escopo])
    return rows.map((f) => ({
      id: f.id, nome_completo: f.nome_completo, data_nascimento: f.data_nascimento, estado_civil: f.estado_civil, modalidade: f.modalidade,
      status: f.status, cidade: f.cidade, uf: f.uf, entrada_fila_em: f.entrada_fila_em, observacoes_internas: f.observacoes_internas,
      compativeis: modalidadesCompativeis(calcularIdade(f.data_nascimento), f.estado_civil, f.sexo).filter((m) => m !== 'casais'),
    }))
  })

  // Altera a modalidade (ou confirma a atual = "revisada"). A posição na fila não muda (entrada_fila_em e inscrição ficam).
  app.post('/api/admin/pre-fichas/:id/modalidade', { ...revisor(), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = Number(req.params.id)
    const nova = String(req.body?.modalidade ?? '')
    if (!Number.isInteger(id) || !MODALIDADES.some((m) => m.valor === nova)) return reply.code(400).send({ mensagem: 'Modalidade inválida.' })
    if (!(await podeVerFicha(pool, req.usuario, id))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const r = await transacao(pool, async (db) => {
      const { rows: [f] } = await db.query('select status, modalidade, data_nascimento, estado_civil, sexo, observacoes_internas from pre_fichas where id = $1 for update', [id])
      if (!f) return { codigo: 404, mensagem: 'Pré-ficha não encontrada.' }
      const mudou = nova !== f.modalidade
      if (mudou) {
        if (nova === 'casais') return { codigo: 400, mensagem: 'Para Casais é preciso conferir o cônjuge: a pessoa se inscreve pela área da conta.' }
        if (!modalidadesCompativeis(calcularIdade(f.data_nascimento), f.estado_civil, f.sexo).includes(nova)) {
          return { codigo: 400, mensagem: 'Esta modalidade não é compatível com a idade, o estado civil e o sexo da pessoa.' }
        }
      }
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const nota = mudou
        ? `Modalidade revisada em ${hoje} por ${req.usuario.nome}: de ${rotuloDe(MODALIDADES, f.modalidade)} para ${rotuloDe(MODALIDADES, nova)}.`
        : `Modalidade revisada em ${hoje} por ${req.usuario.nome}: mantida (${rotuloDe(MODALIDADES, f.modalidade)}).`
      // tira a marca "revisar" e deixa o registro na própria observação
      const obs = [String(f.observacoes_internas ?? '').replace(/revisar modalidade/gi, 'modalidade (revisada)').replace(/\brevisar\b/gi, 'revisado'), nota].filter(Boolean).join('\n').slice(0, 4000)
      await db.query(
        `update pre_fichas set modalidade = $1, observacoes_internas = $2, atualizado_em = now(), atualizado_por = $3 where id = $4`,
        [nova, obs, req.usuario.id, id])
      await db.query(
        `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes) values ($1, $2, 'modalidade', $3, $4)`,
        [id, req.usuario.id, nota, JSON.stringify({ de: f.modalidade, para: nova })])
      return { ok: true }
    })
    if (!r.ok) return reply.code(r.codigo).send({ mensagem: r.mensagem })
    const { rows: [ficha] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return limparFicha(ficha)
  })

  // Impressão da ficha: quem pode ver a ficha completa pode imprimir; fica registrado na trilha
  app.post('/api/admin/pre-fichas/:id/impressao', { ...autenticado(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || !(await podeVerFicha(pool, req.usuario, id, { leitura: true }))) {
      return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    }
    await pool.query(
      `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao) values ($1, $2, 'observacao', 'Ficha impressa.')`,
      [id, req.usuario.id])
    return { ok: true }
  })

  // Ficha completa (ao abrir o detalhe). Mesma regra do histórico: núcleo do coordenador ou campista.
  app.get('/api/admin/pre-fichas/:id', autenticado(), async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || !(await podeVerFicha(pool, req.usuario, id, { leitura: true }))) {
      return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    }
    const { rows: [ficha] } = await pool.query(SQL_FICHAS('p.id = $1'), [id])
    return limparFicha(ficha)
  })

  // Foto da conta ligada à ficha (só quem pode ver a ficha). Não é cacheada por proxies e não é indexada.
  app.get('/api/admin/pre-fichas/:id/foto', autenticado(), async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || !(await podeVerFicha(pool, req.usuario, id, { leitura: true }))) {
      return reply.code(404).send({ mensagem: 'Foto não encontrada.' })
    }
    const { rows: [f] } = await pool.query(
      'select pf.dados, pf.atualizado_em from pre_fichas p join participantes_fotos pf on pf.participante_id = p.participante_id where p.id = $1', [id])
    if (!f) return reply.code(404).send({ mensagem: 'Sem foto.' })
    return cabecalhosFoto(reply, f.atualizado_em).send(f.dados)
  })

  app.get('/api/admin/pre-fichas/:id/historico', autenticado(), async (req, reply) => {
    const id = Number(req.params.id)
    if (!(await podeVerFicha(pool, req.usuario, id, { leitura: true }))) return reply.code(404).send({ mensagem: 'Pré-ficha não encontrada.' })
    const { rows } = await pool.query(`${SQL_HISTORICO} where h.pre_ficha_id = $1 order by h.criado_em desc, h.id desc`, [id])
    return rows
  })

  // Altera status e observações internas (únicos campos editáveis pela equipe).
  app.patch('/api/admin/pre-fichas/:id', autenticado(), async (req, reply) => {
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
  app.post('/api/admin/pre-fichas/:id/recusa', autenticado(), async (req, reply) => {
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
  app.post('/api/admin/pre-fichas/:id/fim-da-fila', autenticado(), async (req, reply) => {
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
  app.get('/api/admin/campistas', autenticado(), async (req) => {
    const escopo = await nucleosDoUsuario(pool, req.usuario)
    const { rows } = await pool.query(SQL_LISTA('part.pre_ficha_id is not null'))
    const { rows: ns } = await pool.query('select id, nome from nucleos')
    const nomes = new Map(ns.map((n) => [n.id, n.nome]))
    return rows.map((f) => ({
      ...limparFicha(f),
      nucleos_nomes: f.nucleos.map((id) => nomes.get(id) ?? ''),
      da_minha_area: escopo === null || f.nucleos.some((n) => escopo.includes(n)),
    }))
  })

  // Trilha de auditoria geral (respeita a área do coordenador)
  app.get('/api/admin/auditoria', autenticado(), async (req) => {
    const q = req.query ?? {}
    const escopo = await escopoLeitura(pool, req.usuario)
    // Escopo do coordenador verificado por ficha (pela chave primária), sem varrer todas as fichas
    const filtros = [`($1::bigint[] is null or exists (
      select 1 from pre_fichas pe join nucleo_areas a
        on a.uf = pe.uf and a.cidade_chave = pe.cidade_chave and (a.bairro_chave is null or a.bairro_chave = pe.bairro_chave)
       where pe.id = h.pre_ficha_id and a.nucleo_id = any($1::bigint[])))`]
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
