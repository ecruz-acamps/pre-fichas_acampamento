// Importação de pré-fichas pela tela (Configurações → Importar pré-fichas). Só administrador.
//   1) simular: envia o arquivo (CSV ou Excel) e recebe o relatório, SEM gravar nada;
//   2) aplicar: confirma a importação do arquivo simulado (grava tudo numa única transação);
//   3) lotes / desfazer: lista as importações e desfaz uma.
import { randomBytes } from 'node:crypto'
import { aplicar, COLUNAS_DE_TIPO, COLUNAS_OBRIGATORIAS, desfazer, lerPlanilha, loteNovo, planejar, relatorios } from '../importacao.js'

const MAX_ARQUIVO = 40 * 1024 * 1024
const VALIDADE_MS = 30 * 60 * 1000
const RELATORIOS = ['quarentena.csv', 'ignoradas.csv', 'revisar.csv', 'resumo.txt']

export default async function rotasImportacao(app) {
  const { pool } = app
  const soAdmin = () => ({ onRequest: [app.exigirLogin, app.exigirAdmin] })
  // o arquivo chega como o próprio corpo da requisição (o navegador envia como application/octet-stream)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_ARQUIVO }, (req, corpo, feito) => feito(null, corpo))

  // arquivos simulados esperando confirmação (só na memória, por administrador, 30 minutos)
  const pendentes = new Map()   // token -> { usuario, buffer, nome, expira, relatorios }
  const limpar = () => { const agora = Date.now(); for (const [t, p] of pendentes) if (p.expira < agora) pendentes.delete(t) }
  setInterval(limpar, 5 * 60 * 1000).unref()
  let importando = false

  app.post('/api/admin/importacao/simular', { ...soAdmin(), bodyLimit: MAX_ARQUIVO, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 20) return reply.code(400).send({ mensagem: 'Envie um arquivo CSV ou Excel (.xlsx).' })
    let lido
    try { lido = lerPlanilha(req.body) } catch (e) { return reply.code(400).send({ mensagem: e.message }) }
    const faltam = [...COLUNAS_OBRIGATORIAS.filter((c) => !lido.cabecalho.includes(c)), ...(COLUNAS_DE_TIPO.some((c) => lido.cabecalho.includes(c)) ? [] : ['data da pré-ficha / aguardando acampamento / onde fui campista'])]
    if (faltam.length) {
      return reply.code(400).send({ mensagem: `Faltam colunas no arquivo: ${faltam.join(', ')}.`, faltam, encontradas: lido.cabecalho.filter(Boolean).slice(0, 80) })
    }
    if (!lido.registros.length) return reply.code(400).send({ mensagem: 'O arquivo não tem nenhuma linha de dados.' })
    const plano = await planejar(pool, lido.registros)
    limpar()
    for (const [t, p] of pendentes) if (p.usuario === req.usuario.id) pendentes.delete(t)      // um arquivo por administrador
    if (pendentes.size >= 5) return reply.code(429).send({ mensagem: 'Há simulações demais em andamento. Tente de novo em alguns minutos.' })
    const token = randomBytes(24).toString('base64url')
    const nome = String(req.headers['x-nome-arquivo'] ?? 'planilha').replace(/[^\w.\- ]/g, '_').slice(0, 120)
    pendentes.set(token, { usuario: req.usuario.id, buffer: req.body, nome, expira: Date.now() + VALIDADE_MS, relatorios: relatorios(plano) })
    req.log.info({ por: req.usuario.email, linhas: plano.resumo.linhas, importar: plano.resumo.importar }, 'Simulação de importação de fichas')
    return {
      token, arquivo: nome, resumo: plano.resumo,
      quarentena: plano.quarentena.slice(0, 30), ignoradas: plano.ignoradas.slice(0, 10),
      edicoesNovas: plano.edicoesNovas.length, tribosNovas: plano.tribosNovas.map((t) => t.nome),
    }
  })

  app.get('/api/admin/importacao/relatorio/:nome', soAdmin(), async (req, reply) => {
    const p = pendentes.get(String(req.query.token ?? ''))
    if (!p || p.usuario !== req.usuario.id || p.expira < Date.now() || !RELATORIOS.includes(req.params.nome)) return reply.code(404).send({ mensagem: 'Relatório não encontrado (simule o arquivo de novo).' })
    reply.header('Content-Disposition', `attachment; filename="${req.params.nome}"`)
    reply.header('Cache-Control', 'no-store')
    return reply.type(req.params.nome.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8').send(p.relatorios[req.params.nome])
  })

  app.post('/api/admin/importacao/aplicar', { ...soAdmin(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const token = String(req.body?.token ?? '')
    const p = pendentes.get(token)
    if (!p || p.usuario !== req.usuario.id || p.expira < Date.now()) return reply.code(404).send({ mensagem: 'A simulação venceu ou não existe. Envie o arquivo de novo para simular.' })
    if (importando) return reply.code(409).send({ mensagem: 'Já há uma importação em andamento.' })
    importando = true
    try {
      // o plano é refeito agora: o sistema pode ter mudado desde a simulação (ex.: alguém já foi cadastrado)
      const plano = await planejar(pool, lerPlanilha(p.buffer).registros)
      if (!plano.importar.length) return reply.code(400).send({ mensagem: 'Não há nenhuma ficha nova para importar (todas já existem ou estão em quarentena).' })
      const lote = loteNovo()
      const resumo = await aplicar(pool, plano, { lote, arquivo: p.nome, por: req.usuario.email })
      pendentes.delete(token)
      req.log.info({ por: req.usuario.email, lote, fichas: resumo.gravadas }, 'Fichas importadas')
      return { lote, resumo }
    } catch (e) {
      req.log.error({ err: e.message }, 'Falha ao importar fichas')
      return reply.code(500).send({ mensagem: `Não foi possível importar (nada foi gravado): ${e.message}` })
    } finally { importando = false }
  })

  app.get('/api/admin/importacao/lotes', soAdmin(), async () => {
    const { rows } = await pool.query(
      `select i.lote, i.criado_em, i.arquivo, i.por,
              (select count(*)::int from pre_fichas p where p.importada_lote = i.lote) as fichas,
              (select count(*)::int from pre_fichas p where p.importada_lote = i.lote
                  and (p.atualizado_em is not null or p.conjuge_id is not null
                       or (p.participante_id is not null and not exists (select 1 from participantes c where c.id = p.participante_id and c.importada_lote = i.lote and c.ultimo_login is null))
                       or exists (select 1 from pre_fichas_historico h where h.pre_ficha_id = p.id and h.tipo <> 'inscricao'))) as alteradas
         from importacoes i order by i.criado_em desc limit 50`)
    return rows
  })

  app.delete('/api/admin/importacao/lotes/:lote', { ...soAdmin(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const lote = String(req.params.lote)
    try {
      const r = await desfazer(pool, lote, { forcar: req.query.forcar === '1' })
      req.log.info({ por: req.usuario.email, lote, fichas: r.fichas }, 'Importação desfeita')
      return r
    } catch (e) {
      if (/não encontrado/.test(e.message)) return reply.code(404).send({ mensagem: e.message })
      if (/já foram alteradas/.test(e.message)) return reply.code(409).send({ mensagem: e.message, precisaForcar: true })
      throw e
    }
  })
}
