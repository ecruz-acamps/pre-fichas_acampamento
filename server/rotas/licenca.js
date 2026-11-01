import { ativarLicenca, licencaAtivada, situacaoLicenca } from '../licenca.js'

export default async function rotasLicenca(app) {
  const { pool } = app
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  // O formulário público consulta para saber se pode receber inscrições.
  app.get('/api/licenca', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache')
    return { ativada: await licencaAtivada(pool) }
  })

  app.get('/api/admin/licenca', soAdmin, async () => situacaoLicenca(pool))

  // Poucas tentativas por minuto: dificulta adivinhar a chave.
  app.post('/api/admin/licenca/ativar', {
    ...soAdmin,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (await licencaAtivada(pool)) return { ok: true, jaAtivada: true }
    const r = await ativarLicenca(pool, {
      chave: req.body?.chave, usuarioId: req.usuario.id, origem: 'painel', log: req.log, chaves: app.chavesLicenca,
    })
    if (!r.ok) return reply.code(400).send({ mensagem: r.mensagem })
    return { ok: true }
  })
}
