import { montarRegistro, normalizarEntrada, validar } from '../../shared/validacao.js'
import { carregarMarca, lerLogo, temaCss } from '../marca.js'
import { licencaAtivada } from '../licenca.js'

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

// Limite geral de envios por hora (todos os IPs somados)
function criarLimiteGlobal(maxPorHora) {
  let janela = 0, contagem = 0
  return () => {
    const agora = Math.floor(Date.now() / 3_600_000)
    if (agora !== janela) { janela = agora; contagem = 0 }
    contagem++
    return contagem <= maxPorHora
  }
}

async function conferirCaptcha(cfg, token, ip) {
  if (!cfg) return true
  if (typeof token !== 'string' || !token || token.length > 4096) return false
  try {
    const r = await fetch(cfg.verificarUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: cfg.secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    })
    return (await r.json()).success === true
  } catch {
    return false
  }
}

export default async function rotasPublicas(app) {
  const { pool, config } = app
  const dentroDoLimiteGlobal = criarLimiteGlobal(config.limiteEnviosGlobalHora)

  app.get('/api/saude', async () => {
    await pool.query('select 1')
    return { ok: true }
  })

  // Envio da pré-ficha (público, sem login)
  app.post('/api/pre-fichas', {
    config: { rateLimit: { max: config.limiteEnviosPorHora, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    if (!(await licencaAtivada(pool))) {
      return reply.code(503).send({ mensagem: 'As inscrições ainda não estão disponíveis.', licencaPendente: true })
    }
    const f = normalizarEntrada(req.body)

    // Campo invisível preenchido = robô. Responde como sucesso e descarta.
    if (f.website.trim()) {
      req.log.warn({ ip: req.ip }, 'Envio descartado pelo honeypot')
      return reply.code(201).send({ ok: true })
    }

    const marca = await carregarMarca(pool)
    const erros = validar(f, marca.termos.length)
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Dados inválidos.', erros })

    if (!(await conferirCaptcha(config.captcha, req.body?.captcha, req.ip))) {
      return reply.code(400).send({ mensagem: 'Confirme que você não é um robô.', erros: { captcha: 'Confirme a verificação.' } })
    }
    if (!dentroDoLimiteGlobal()) {
      req.log.warn('Limite geral de envios por hora atingido')
      return reply.code(429).send({ mensagem: 'Muitas inscrições neste momento. Tente novamente mais tarde.' })
    }

    const registro = montarRegistro(f, marca.termos)

    // Mesma pessoa já na fila (nome + data de nascimento): descarta sem revelar a quem enviou
    const { rows: [existente] } = await pool.query(
      `select id from pre_fichas
        where chave_local(nome_completo) = chave_local($1) and data_nascimento = $2
          and status in ('aguardando', 'em_contato', 'confirmado')
        order by id limit 1`, [registro.nome_completo, registro.data_nascimento])
    if (existente) {
      await pool.query(
        `insert into pre_fichas_historico (pre_ficha_id, tipo, observacao, detalhes) values ($1, 'observacao', $2, $3)`,
        [existente.id, 'Nova pré-ficha enviada para a mesma pessoa (nome e data de nascimento) — descartada como duplicada.',
          JSON.stringify({ duplicada: true, telefone: registro.telefone, email: registro.email })])
      req.log.info({ ficha: existente.id }, 'Pré-ficha duplicada descartada')
      return reply.code(201).send({ ok: true })
    }

    // Limite por contato: mesmo telefone ou e-mail em 24 h
    const { rows: [{ n }] } = await pool.query(
      `select count(*)::int n from pre_fichas
        where created_at > now() - interval '24 hours'
          and (regexp_replace(telefone, '\D', '', 'g') = $1 or email = $2)`,
      [registro.telefone.replace(/\D/g, ''), registro.email])
    if (n >= config.limiteEnviosPorContatoDia) {
      return reply.code(429).send({ mensagem: 'Muitas pré-fichas com este telefone ou e-mail hoje. Fale com o acampamento pelo WhatsApp.' })
    }

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

  // Identidade do acampamento (nome, cores, textos, declarações, tribos)
  app.get('/api/marca', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache')
    const marca = await carregarMarca(pool)
    return { ...marca, captcha: config.captcha ? { provedor: 'turnstile', siteKey: config.captcha.siteKey } : null }
  })

  app.get('/api/marca/tema.css', async (req, reply) => {
    const marca = await carregarMarca(pool)
    reply.header('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache')
    return reply.type('text/css; charset=utf-8').send(temaCss(marca))
  })

  app.get('/api/marca/logo', async (req, reply) => {
    const logo = await lerLogo(pool)
    if (!logo) return reply.code(404).send({ mensagem: 'Sem logo.' })
    reply.header('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache')
    // SVG aberto diretamente não pode executar nada
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    return reply.type(logo.logo_tipo).send(logo.logo)
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
