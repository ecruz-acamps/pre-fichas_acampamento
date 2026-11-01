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
    limiteLoginPorMinuto: int(env.LIMITE_LOGIN_POR_MINUTO, 10),
    viaCepUrl: env.VIACEP_URL || 'https://viacep.com.br/ws',
    pastaSite: env.PASTA_SITE || new URL('../dist', import.meta.url).pathname,
    logNivel: env.LOG_NIVEL || (producao ? 'info' : 'debug'),
  }
  if (!config.databaseUrl) {
    throw new Error('Defina a variável DATABASE_URL (ex.: postgres://usuario:senha@localhost:5432/prefichas)')
  }
  return config
}
