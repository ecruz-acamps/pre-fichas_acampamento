// Aviso de atualização para o administrador.
export default async function rotasAtualizacao(app) {
  const { config } = app
  const verificador = app.verificadorAtualizacao
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  const resposta = (r) => ({
    ativo: config.atualizacao.ativo,
    pasta: config.atualizacao.pasta,
    docker: config.atualizacao.docker,
    instalada: verificador.instalada,
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
}
