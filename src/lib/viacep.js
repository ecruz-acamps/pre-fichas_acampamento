import { somenteDigitos } from './util.js'

/**
 * Consulta o CEP na API pública ViaCEP (https://viacep.com.br).
 * Retorna { logradouro, bairro, cidade, uf } ou lança um erro com mensagem amigável.
 */
export async function buscarCep(cep, { signal } = {}) {
  const d = somenteDigitos(cep)
  if (d.length !== 8) throw new Error('O CEP deve ter 8 dígitos.')

  let resposta
  try {
    resposta = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.')
  }
  if (!resposta.ok) throw new Error('CEP inválido.')

  const dados = await resposta.json()
  if (dados.erro) throw new Error('CEP não encontrado. Confira o número ou preencha manualmente.')

  return {
    logradouro: dados.logradouro || '',
    bairro: dados.bairro || '',
    cidade: dados.localidade || '',
    uf: dados.uf || '',
  }
}
