import { montarRegistro, normalizarEntrada, validar } from '../../shared/validacao.js'

const COLUNAS = Object.keys(montarRegistro(normalizarEntrada({ data_nascimento: '2000-01-01' })))

// Cache simples de CEPs consultados (evita repetir chamadas ao ViaCEP).
const cacheCep = new Map()
const CACHE_MAX = 2000

async function consultarViaCep(baseUrl, cep) {
  if (cacheCep.has(cep)) return cacheCep.get(cep)
  const resposta = await fetch(`${baseUrl}/${cep}/json/`, { signal: AbortSignal.timeout(5000) })
  if (!resposta.ok) throw new Error(`ViaCEP respondeu ${resposta.status}`)
  const dados = await resposta.json()
  const endereco = dados.erro ? null : {
    logradouro: dados.logradouro || '',
    bairro: dados.bairro || '',
    cidade: dados.localidade || '',
    uf: dados.uf || '',
  }
  if (cacheCep.size >= CACHE_MAX) cacheCep.delete(cacheCep.keys().next().value)
  cacheCep.set(cep, endereco)
  return endereco
}

export default async function rotasPublicas(app) {
  const { pool, config } = app

  app.get('/api/saude', async () => {
    await pool.query('select 1')
    return { ok: true }
  })

  // Envio da pré-ficha (público, sem login)
  app.post('/api/pre-fichas', {
    config: { rateLimit: { max: config.limiteEnviosPorHora, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const f = normalizarEntrada(req.body)

    // Campo invisível preenchido = robô. Responde como sucesso e descarta.
    if (f.website.trim()) {
      req.log.warn({ ip: req.ip }, 'Envio descartado pelo honeypot')
      return reply.code(201).send({ ok: true })
    }

    const erros = validar(f)
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Dados inválidos.', erros })

    const registro = montarRegistro(f)
    const valores = COLUNAS.map((c) => registro[c])
    const marcadores = COLUNAS.map((_, i) => `$${i + 1}`)
    // created_at, status e id NÃO vêm do usuário: são definidos pelo banco.
    await pool.query(
      `insert into pre_fichas (${COLUNAS.join(', ')}, ip_origem)
       values (${marcadores.join(', ')}, $${COLUNAS.length + 1})`,
      [...valores, req.ip],
    )
    return reply.code(201).send({ ok: true })
  })

  // Consulta de CEP (o navegador fala só com o nosso servidor)
  app.get('/api/cep/:cep', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const cep = String(req.params.cep).replace(/\D/g, '')
    if (cep.length !== 8) return reply.code(400).send({ mensagem: 'CEP inválido.' })
    try {
      const endereco = await consultarViaCep(config.viaCepUrl, cep)
      if (!endereco) return reply.code(404).send({ mensagem: 'CEP não encontrado.' })
      return endereco
    } catch (e) {
      req.log.warn({ err: e.message }, 'Falha ao consultar ViaCEP')
      return reply.code(502).send({ mensagem: 'Serviço de CEP indisponível.' })
    }
  })
}
