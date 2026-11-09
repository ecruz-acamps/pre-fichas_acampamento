import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { MARCA_PADRAO, ajustarCor, corTextoSobre, validarMarca } from '../shared/marca.js'

export const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
export const LOGO_MAX_BYTES = 1024 * 1024

// Cache em memória (a marca muda raramente).
let cache = null

export async function carregarMarca(pool) {
  if (cache) return cache
  const { rows: [r] } = await pool.query(
    `select dados, logo is not null as tem_logo, logo_impressao is not null as tem_logo_impressao, logo_tipo, atualizado_em from marca where id`)
  const { marca } = validarMarca({ ...MARCA_PADRAO, ...(r?.dados ?? {}) })
  const versao = createHash('sha1').update(String(r?.atualizado_em ?? '')).digest('hex').slice(0, 10)
  cache = {
    ...marca, logoUrl: r?.tem_logo ? `/api/marca/logo?v=${versao}` : null,
    logoImpressaoUrl: r?.tem_logo_impressao ? `/api/marca/logo-impressao?v=${versao}` : null, versao,
  }
  return cache
}

export function invalidarMarca() {
  cache = null
}

export async function salvarMarca(pool, entrada) {
  const { marca, erros } = validarMarca(entrada)
  if (Object.keys(erros).length) return { erros }
  await pool.query('update marca set dados = $1, atualizado_em = now() where id', [JSON.stringify(marca)])
  invalidarMarca()
  return { marca: await carregarMarca(pool) }
}

/** Confere pelos primeiros bytes se o arquivo é mesmo uma imagem do tipo declarado. */
export function conferirImagem(buffer, tipo) {
  if (!TIPOS_LOGO.includes(tipo) || !buffer?.length || buffer.length > LOGO_MAX_BYTES) return false
  const hex = buffer.subarray(0, 12).toString('hex')
  if (tipo === 'image/png') return hex.startsWith('89504e470d0a1a0a')
  if (tipo === 'image/jpeg') return hex.startsWith('ffd8ff')
  if (tipo === 'image/webp') return hex.startsWith('52494646') && buffer.subarray(8, 12).toString() === 'WEBP'
  // SVG: precisa ser um <svg> e não pode conter scripts (é servido com CSP restritiva também)
  const texto = buffer.toString('utf8')
  return /<svg[\s>]/i.test(texto) && !/<script|on\w+\s*=|javascript:/i.test(texto)
}

export async function salvarLogo(pool, buffer, tipo) {
  await pool.query('update marca set logo = $1, logo_tipo = $2, atualizado_em = now() where id', [buffer, tipo])
  invalidarMarca()
}

export async function removerLogo(pool) {
  await pool.query('update marca set logo = null, logo_tipo = null, atualizado_em = now() where id')
  invalidarMarca()
}

/** Logo do cabeçalho da impressão (buffer null = remover). */
export async function salvarLogoImpressao(pool, buffer, tipo) {
  await pool.query('update marca set logo_impressao = $1, logo_impressao_tipo = $2, atualizado_em = now() where id',
    [buffer, buffer ? tipo : null])
  invalidarMarca()
}

export async function lerLogoImpressao(pool) {
  const { rows: [r] } = await pool.query(
    'select logo_impressao as logo, logo_impressao_tipo as logo_tipo from marca where id and logo_impressao is not null')
  return r ?? null
}

export async function lerLogo(pool) {
  const { rows: [r] } = await pool.query('select logo, logo_tipo from marca where id and logo is not null')
  return r ?? null
}

/** Folha de estilo com as cores da marca (variáveis CSS). */
export function temaCss(marca) {
  const c = marca.corPrimaria
  return `:root{--cor:${c};--cor-escura:${ajustarCor(c, -0.25)};--cor-clara:${ajustarCor(c, 0.88)};` +
    `--cor-texto:${corTextoSobre(c)};--cor-foco:${c}2e;--fundo:${ajustarCor(c, 0.955)};--fundo-linha:${ajustarCor(c, 0.975)}}\n`
}

/**
 * Na primeira inicialização (marca ainda não configurada), aplica o arquivo
 * indicado em MARCA_INICIAL. Depois disso, as mudanças são feitas pelo painel.
 */
export async function aplicarMarcaInicial(pool, arquivo, log, nome = null) {
  if (!arquivo && !nome) return
  const { rows: [r] } = await pool.query(`select dados = '{}'::jsonb as vazia from marca where id`)
  if (!r?.vazia) return
  if (!arquivo) {
    // Só o nome escolhido na instalação; o resto fica no padrão (ajustável no painel)
    const { erros } = await salvarMarca(pool, { nome: nome.slice(0, 120), nomeCurto: nome.replace(/^acampamento\s+/i, '').slice(0, 60) })
    if (erros) throw new Error(`NOME_ACAMPAMENTO inválido: ${JSON.stringify(erros)}`)
    log.info(`Nome do acampamento definido: ${nome}`)
    return
  }
  const { logo, ...dados } = JSON.parse(await readFile(arquivo, 'utf8'))
  if (nome) { dados.nome = nome; dados.nomeCurto = nome.replace(/^acampamento\s+/i, '') }
  const { erros } = await salvarMarca(pool, dados)
  if (erros) throw new Error(`MARCA_INICIAL inválida (${arquivo}): ${JSON.stringify(erros)}`)
  if (logo) {
    const caminho = resolve(dirname(arquivo), logo)
    const tipo = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[extname(caminho).toLowerCase()]
    const buffer = await readFile(caminho)
    if (tipo && conferirImagem(buffer, tipo)) await salvarLogo(pool, buffer, tipo)
    else log.warn(`Logo ignorada (formato inválido): ${caminho}`)
  }
  log.info(`Marca inicial aplicada: ${dados.nome}`)
}

// ---------------------------------------------------------------------
// Páginas HTML com título, descrição, cor e ícone da marca.
// ---------------------------------------------------------------------
const escapar = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const semNegrito = (s) => String(s ?? '').replace(/\*\*/g, '')

export function criarRenderizadorHtml(pastaSite) {
  const modelos = {}
  for (const [pagina, arquivo] of [['form', 'index.html'], ['admin', 'admin/index.html']]) {
    try { modelos[pagina] = readFileSync(join(pastaSite, arquivo), 'utf8') } catch { /* sem build */ }
  }

  return function renderizar(pagina, marca, urlBase) {
    const modelo = modelos[pagina]
    if (!modelo) return null
    const titulo = pagina === 'admin'
      ? `Fila de espera · ${marca.nomeCurto}`
      : `${marca.tituloFormulario} · ${marca.nome}`
    const descricao = semNegrito(marca.textoFormulario).slice(0, 200)
    const icone = marca.logoUrl || '/favicon.svg'
    const meta = [
      `<title>${escapar(titulo)}</title>`,
      `<meta name="description" content="${escapar(descricao)}" />`,
      `<meta name="theme-color" content="${escapar(marca.corPrimaria)}" />`,
      `<meta property="og:title" content="${escapar(titulo)}" />`,
      `<meta property="og:description" content="${escapar(descricao)}" />`,
      `<meta property="og:site_name" content="${escapar(marca.nome)}" />`,
      // Só com o endereço configurado (URL_PUBLICA); nunca a partir do cabeçalho Host
      marca.logoUrl && urlBase ? `<meta property="og:image" content="${escapar(urlBase + marca.logoUrl)}" />` : '',
      `<link rel="icon" href="${escapar(icone)}" />`,
      // PWA: instalável na tela inicial (manifesto próprio do painel e do formulário)
      `<link rel="manifest" href="${pagina === 'admin' ? '/admin/manifest.webmanifest' : '/manifest.webmanifest'}" />`,
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<meta name="mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
      `<meta name="apple-mobile-web-app-title" content="${escapar(pagina === 'admin' ? marca.nomeCurto : marca.nome).slice(0, 30)}" />`,
      // Cores da marca já na primeira pintura (sem "piscar" a cor padrão)
      `<link rel="stylesheet" href="/api/marca/tema.css?v=${escapar(marca.versao)}" />`,
    ].filter(Boolean).join('\n    ')
    return modelo
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace(/\s*<meta name="description"[^>]*>/, '')
      .replace(/\s*<link rel="icon"[^>]*>/, '')
      .replace('</head>', `    ${meta}\n  </head>`)
  }
}

/** Manifesto do PWA com o nome e a cor do acampamento. `admin` = o painel (escopo /admin/). */
export function manifesto(marca, admin = false) {
  return {
    name: admin ? `Fila de espera · ${marca.nomeCurto}` : `${marca.tituloFormulario} · ${marca.nome}`,
    short_name: (admin ? 'Fila' : marca.nomeCurto).slice(0, 12),
    description: semNegrito(marca.textoFormulario).slice(0, 200),
    lang: 'pt-BR',
    id: admin ? '/admin/' : '/',
    start_url: admin ? '/admin/' : '/',
    scope: admin ? '/admin/' : '/',
    display: 'standalone',
    background_color: '#faf7f2',
    theme_color: marca.corPrimaria,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
