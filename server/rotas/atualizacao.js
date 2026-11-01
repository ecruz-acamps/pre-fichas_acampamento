// Aviso de atualização para o administrador e botão "Atualizar agora".
import { estadoAtualizador, solicitarAtualizacao } from '../atualizador.js'

export default async function rotasAtualizacao(app) {
  const { config } = app
  const verificador = app.verificadorAtualizacao
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  const resposta = (r) => ({
    ativo: config.atualizacao.ativo,
    pasta: config.atualizacao.pasta,
    docker: config.atualizacao.docker,
    instalada: verificador.instalada,
    atualizador: (({ instalado, pendente, estado }) => ({ instalado, pendente, estado }))(estadoAtualizador(config.atualizacao.pastaControle)),
    ...(r ?? { verificado_em: null, desatualizado: null }),
  })

  // Última verificação (feita ao iniciar e a cada N horas)
  app.get('/api/admin/atualizacao', soAdmin, async () => {
    if (config.atualizacao.ativo && !verificador.ultima()) await verificador.verificar()
    return resposta(verificador.ultima())
  })

  // "Verificar agora"
  app.post('/api/admin/atualizacao/verificar', {
    ...soAdmin,
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async () => resposta(await verificador.verificar()))

  // Botão "Atualizar agora": grava o pedido para o atualizador do servidor
  app.post('/api/admin/atualizacao/executar', {
    ...soAdmin,
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const r = solicitarAtualizacao(config.atualizacao.pastaControle, req.usuario)
    if (r.erro) return reply.code(409).send({ mensagem: r.erro, emAndamento: Boolean(r.emAndamento) })
    req.log.info({ por: req.usuario.email }, 'Atualização solicitada pelo painel')
    return { ok: true }
  })

  // Andamento da atualização (o painel consulta a cada poucos segundos)
  app.get('/api/admin/atualizacao/progresso', soAdmin, async () => {
    const s = estadoAtualizador(config.atualizacao.pastaControle)
    return { ...s, instalada: verificador.instalada }
  })
}
