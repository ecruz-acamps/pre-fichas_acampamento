import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import estaticos from '@fastify/static'
import { COOKIE, buscarSessao } from './sessao.js'
import { carregarMarca, criarRenderizadorHtml } from './marca.js'
import { CHAVES_LICENCA, licencaAtivada } from './licenca.js'
import rotasLicenca from './rotas/licenca.js'
import rotasAtualizacao from './rotas/atualizacao.js'
import { criarVerificador, lerVersaoInstalada } from './versao.js'
import rotasPublicas from './rotas/publico.js'
import rotasAuth from './rotas/auth.js'
import rotasFila from './rotas/fila.js'
import rotasUsuarios from './rotas/usuarios.js'
import rotasNucleos from './rotas/nucleos.js'
import rotasAcampamentos from './rotas/acampamentos.js'
import rotasMarca from './rotas/marca.js'
import rotasPreferencias from './rotas/preferencias.js'

export async function construirApp({ pool, config, logger = true, chavesLicenca = CHAVES_LICENCA, versaoInstalada = lerVersaoInstalada() }) {
  const app = Fastify({
    logger: logger && {
      level: config.logNivel,
      // Nunca registrar cookies/senhas nos logs.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    trustProxy: config.proxiesConfiaveis,
    bodyLimit: 64 * 1024,
  })

  app.decorate('pool', pool)
  app.decorate('config', config)
  app.decorate('chavesLicenca', chavesLicenca)
  app.decorate('verificadorAtualizacao', criarVerificador(config.atualizacao, versaoInstalada, app.log))
  app.decorateRequest('usuario', null)

  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // CAPTCHA opcional (Turnstile) precisa do script e do quadro da Cloudflare
        scriptSrc: ["'self'", ...(config.captcha ? ['https://challenges.cloudflare.com'] : [])],
        frameSrc: config.captcha ? ['https://challenges.cloudflare.com'] : ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    // HSTS só faz sentido quando o site está em HTTPS.
    strictTransportSecurity: config.cookieSeguro ? undefined : false,
  })

  // ---- Autenticação: carrega o usuário da sessão em toda requisição /api ----
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return
    const token = req.cookies[COOKIE]
    if (token) req.usuario = await buscarSessao(pool, token, config.sessaoHoras)
  })

  // Defesa contra CSRF: requisições que alteram dados em rotas autenticadas
  // precisam do cabeçalho X-Requested-With (formulários de outros sites não
  // conseguem enviá-lo sem permissão de CORS, que este servidor não concede).
  app.addHook('onRequest', async (req, reply) => {
    const altera = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    const protegida = req.url.startsWith('/api/admin') || req.url.startsWith('/api/auth')
    if (altera && protegida && req.headers['x-requested-with'] !== 'fetch') {
      return reply.code(403).send({ mensagem: 'Requisição recusada.' })
    }
  })

  // Sistema ainda não ativado: o painel só permite a ativação (e login/troca de senha).
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/admin') || req.url.startsWith('/api/admin/licenca') || !req.usuario) return
    if (!(await licencaAtivada(pool))) {
      return reply.code(403).send({ mensagem: 'O sistema precisa ser ativado com a chave de ativação.', licencaPendente: true })
    }
  })

  app.decorate('exigirLogin', async (req, reply) => {
    if (!req.usuario) return reply.code(401).send({ mensagem: 'Faça login para continuar.' })
    if (req.usuario.trocar_senha) return reply.code(403).send({ mensagem: 'Defina uma nova senha.', trocarSenha: true })
  })
  app.decorate('exigirAdmin', async (req, reply) => {
    if (!req.usuario) return reply.code(401).send({ mensagem: 'Faça login para continuar.' })
    if (req.usuario.papel !== 'admin') return reply.code(403).send({ mensagem: 'Apenas administradores.' })
  })

  app.setErrorHandler((erro, req, reply) => {
    if (erro.statusCode === 429) return reply.code(429).send({ mensagem: 'Muitas tentativas. Aguarde um pouco.' })
    if (erro.validation || (erro.statusCode >= 400 && erro.statusCode < 500)) {
      return reply.code(erro.statusCode || 400).send({ mensagem: 'Requisição inválida.' })
    }
    req.log.error(erro)
    return reply.code(500).send({ mensagem: 'Erro interno. Tente novamente.' })
  })

  await app.register(rotasPublicas)
  await app.register(rotasAuth)
  await app.register(rotasFila)
  await app.register(rotasUsuarios)
  await app.register(rotasNucleos)
  await app.register(rotasAcampamentos)
  await app.register(rotasMarca)
  await app.register(rotasPreferencias)
  await app.register(rotasLicenca)
  await app.register(rotasAtualizacao)

  // ---- Site (arquivos gerados pelo `npm run build`) ----
  if (existsSync(config.pastaSite)) {
    await app.register(estaticos, {
      root: config.pastaSite,
      wildcard: false,
      index: false,
      // index.html só pelas rotas acima (com a marca aplicada)
      allowedPath: (caminho) => !caminho.endsWith('index.html'),
      setHeaders(reply, caminho) {
        reply.header('Cache-Control', caminho.includes('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache')
      },
    })
    // Páginas com nome, cores e ícone do acampamento
    const renderizar = criarRenderizadorHtml(config.pastaSite)
    const pagina = (nome) => async (req, reply) => {
      const html = renderizar(nome, await carregarMarca(pool), config.urlPublica)
      if (!html) return reply.code(404).send('Site não gerado. Rode "npm run build".')
      return reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(html)
    }
    app.get('/', pagina('form'))
    app.get('/admin/', pagina('admin'))
    app.get('/admin', (req, reply) => reply.redirect('/admin/', 301))
  } else {
    app.log.warn(`Pasta do site não encontrada (${config.pastaSite}). Rode "npm run build".`)
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ mensagem: 'Não encontrado.' })
    return reply.code(404).type('text/html').send('<h1>Página não encontrada</h1><p><a href="/">Voltar</a></p>')
  })

  return app
}
