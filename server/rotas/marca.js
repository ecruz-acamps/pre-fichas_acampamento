import { conferirImagem, LOGO_MAX_BYTES, removerLogo, salvarLogo, salvarLogoImpressao, salvarMarca, TIPOS_LOGO } from '../marca.js'

export default async function rotasMarca(app) {
  const { pool } = app
  const soAdmin = () => ({ onRequest: [app.exigirLogin, app.exigirAdmin] })

  // Upload da logo: corpo da requisição = o próprio arquivo de imagem
  for (const tipo of TIPOS_LOGO) {
    app.addContentTypeParser(tipo, { parseAs: 'buffer', bodyLimit: LOGO_MAX_BYTES }, (req, corpo, feito) => feito(null, corpo))
  }

  app.put('/api/admin/marca', soAdmin(), async (req, reply) => {
    const { marca, erros } = await salvarMarca(pool, req.body)
    if (erros) return reply.code(400).send({ mensagem: 'Confira os campos destacados.', erros })
    req.log.info({ por: req.usuario.email }, 'Marca atualizada')
    return marca
  })

  app.put('/api/admin/marca/logo', { ...soAdmin(), bodyLimit: LOGO_MAX_BYTES }, async (req, reply) => {
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim()
    if (!Buffer.isBuffer(req.body) || !conferirImagem(req.body, tipo)) {
      return reply.code(400).send({ mensagem: 'Envie uma imagem PNG, JPG, WEBP ou SVG de até 1 MB.' })
    }
    await salvarLogo(pool, req.body, tipo)
    return { ok: true }
  })

  // Logo do cabeçalho da ficha impressa (ex.: brasão da paróquia)
  app.put('/api/admin/marca/logo-impressao', { ...soAdmin(), bodyLimit: LOGO_MAX_BYTES }, async (req, reply) => {
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim()
    if (!Buffer.isBuffer(req.body) || !conferirImagem(req.body, tipo)) {
      return reply.code(400).send({ mensagem: 'Envie uma imagem PNG, JPG, WEBP ou SVG de até 1 MB.' })
    }
    await salvarLogoImpressao(pool, req.body, tipo)
    return { ok: true }
  })
  app.delete('/api/admin/marca/logo-impressao', soAdmin(), async () => {
    await salvarLogoImpressao(pool, null, null)
    return { ok: true }
  })

  app.delete('/api/admin/marca/logo', soAdmin(), async () => {
    await removerLogo(pool)
    return { ok: true }
  })
}
