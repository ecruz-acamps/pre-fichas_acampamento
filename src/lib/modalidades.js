import { definirModalidades } from '../../shared/opcoes.js'
import { api } from './api.js'

/** Carrega a lista de modalidades cadastradas e atualiza MODALIDADES (se falhar, ficam as padrão). */
export async function carregarModalidades() {
  try { definirModalidades(await api.get('/api/modalidades')) } catch { /* usa a lista padrão */ }
}
