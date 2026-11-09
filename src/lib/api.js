// Cliente HTTP do próprio servidor (mesma origem; o cookie de sessão vai junto).

export class ErroApi extends Error {
  constructor(status, dados) {
    super(dados?.mensagem || `Erro ${status}`)
    this.status = status
    this.dados = dados
  }
}

async function requisitar(metodo, url, corpo, arquivo, extra = {}) {
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    // Cabeçalho exigido pelo servidor nas rotas protegidas (defesa contra CSRF).
    headers: { 'X-Requested-With': 'fetch', ...extra },
  }
  if (arquivo) {
    opcoes.headers['Content-Type'] = arquivo.type
    opcoes.body = arquivo
  } else if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json'
    opcoes.body = JSON.stringify(corpo)
  }
  const resposta = await fetch(url, opcoes)
  const texto = await resposta.text()
  let dados = null
  try { dados = texto ? JSON.parse(texto) : null } catch { dados = { mensagem: texto } }
  if (!resposta.ok) {
    if (resposta.status === 401 && url.startsWith('/api/admin')) {
      window.dispatchEvent(new Event('sessao-expirada'))
    }
    if (resposta.status === 403 && dados?.licencaPendente) {
      window.dispatchEvent(new Event('licenca-pendente'))
    }
    throw new ErroApi(resposta.status, dados)
  }
  return dados
}

export const api = {
  get: (url) => requisitar('GET', url),
  post: (url, corpo = {}) => requisitar('POST', url, corpo),
  patch: (url, corpo = {}) => requisitar('PATCH', url, corpo),
  put: (url, corpo = {}) => requisitar('PUT', url, corpo),
  delete: (url) => requisitar('DELETE', url),
  /** Envia um arquivo como corpo da requisição (ex.: logo). */
  enviarArquivo: (url, arquivo, { metodo = 'PUT', cabecalhos = {} } = {}) => requisitar(metodo, url, undefined, arquivo, cabecalhos),
}
