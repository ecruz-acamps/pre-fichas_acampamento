import { api } from './api.js'
import { somenteDigitos } from '../../shared/util.js'

/**
 * Busca o endereço pelo CEP através do nosso servidor (que consulta o ViaCEP).
 * Retorna { logradouro, bairro, cidade, uf } ou lança um erro com mensagem amigável.
 */
export async function buscarCep(cep) {
  const d = somenteDigitos(cep)
  if (d.length !== 8) throw new Error('O CEP deve ter 8 dígitos.')
  try {
    return await api.get(`/api/cep/${d}`)
  } catch (e) {
    if (e.status === 404) throw new Error('CEP não encontrado. Confira o número ou preencha manualmente.')
    throw new Error('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.')
  }
}
