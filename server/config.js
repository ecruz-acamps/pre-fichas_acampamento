// Configuração lida das variáveis de ambiente (veja .env.example).

function bool(v, padrao) {
  if (v === undefined || v === '') return padrao
  return ['1', 'true', 'sim', 'yes'].includes(String(v).toLowerCase())
}

function int(v, padrao) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : padrao
}

export function lerConfig(env = process.env) {
  const producao = env.NODE_ENV === 'production'
  const config = {
    producao,
    porta: int(env.PORTA, 3000),
    host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL,
    // Cookies só trafegam em HTTPS. Desligue apenas para testes em rede local sem TLS.
    cookieSeguro: bool(env.COOKIE_SEGURO, producao),
    // Número de proxies reversos à frente da aplicação (Caddy/Nginx = 1).
    proxiesConfiaveis: int(env.PROXIES_CONFIAVEIS, 1),
    sessaoHoras: int(env.SESSAO_HORAS, 12),
    limiteEnviosPorHora: int(env.LIMITE_ENVIOS_POR_HORA, 30),
    // Proteção do formulário contra inundação
    limiteEnviosGlobalHora: int(env.LIMITE_ENVIOS_GLOBAL_HORA, 300),   // somando todos os IPs
    limiteEnviosPorContatoDia: int(env.LIMITE_ENVIOS_POR_CONTATO_DIA, 3), // mesmo telefone ou e-mail
    // CAPTCHA opcional (Cloudflare Turnstile): ativo só com as duas chaves
    captcha: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? {
      siteKey: env.TURNSTILE_SITE_KEY,
      secret: env.TURNSTILE_SECRET,
      verificarUrl: env.TURNSTILE_VERIFICAR_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    } : null,
    limiteLoginPorMinuto: int(env.LIMITE_LOGIN_POR_MINUTO, 10),
    // Bloqueio por conta: N erros em 15 min bloqueiam aquele e-mail por 15 min (qualquer IP)
    protecaoLogin: { maxFalhas: int(env.LOGIN_MAX_FALHAS_CONTA, 8), janelaMin: 15, bloqueioMin: int(env.LOGIN_BLOQUEIO_MINUTOS, 15), simultaneas: 2, fila: 20 },
    viaCepUrl: env.VIACEP_URL || 'https://viacep.com.br/ws',
    pastaSite: env.PASTA_SITE || new URL('../dist', import.meta.url).pathname,
    // Endereço público do site (ex.: https://prefichas.seuacampamento.com.br), usado na
    // prévia de links (WhatsApp). Nunca é deduzido do cabeçalho da requisição.
    urlPublica: (env.URL_PUBLICA || '').replace(/\/+$/, '') || null,
    // Arquivo de marca aplicado na primeira inicialização (ex.: marcas/sao-padre-pio.json)
    marcaInicial: env.MARCA_INICIAL || null,
    // Aviso de atualização: compara a versão instalada com o GitHub
    atualizacao: {
      ativo: bool(env.ATUALIZACAO_VERIFICAR, true),
      repo: env.ATUALIZACAO_REPO || 'ecruz-acamps/pre-fichas_acampamento',
      branch: env.ATUALIZACAO_BRANCH || 'main',
      token: env.ATUALIZACAO_TOKEN || null, // só se o repositório for privado
      apiUrl: env.ATUALIZACAO_API_URL || 'https://api.github.com',
      horas: int(env.ATUALIZACAO_INTERVALO_HORAS, 6),
      // Pasta da instalação no servidor (Docker: vem do .env; sem Docker: a pasta do próprio sistema)
      pasta: env.PASTA_INSTALACAO || (new URL('..', import.meta.url).pathname.replace(/\/$/, '') === '/app'
        ? null : new URL('..', import.meta.url).pathname.replace(/\/$/, '')),
      docker: new URL('..', import.meta.url).pathname.replace(/\/$/, '') === '/app',
      // Pasta de comunicação com o atualizador do servidor (botão "Atualizar agora")
      pastaControle: env.ATUALIZACAO_PASTA_CONTROLE || new URL('../atualizacao', import.meta.url).pathname,
    },
    logNivel: env.LOG_NIVEL || (producao ? 'info' : 'debug'),
  }
  if (!config.databaseUrl) {
    throw new Error('Defina a variável DATABASE_URL (ex.: postgres://usuario:senha@localhost:5432/prefichas)')
  }
  return config
}
