// Modalidades cadastráveis. A lista fica no banco e é espelhada em MODALIDADES (shared/opcoes.js, atualizada no lugar).
import { definirModalidades } from '../shared/opcoes.js'

export async function carregarModalidades(pool) {
  const { rows } = await pool.query('select valor, rotulo, regra, idade_min as min, idade_max as max, casado, ordem, ativa from modalidades order by ordem, valor')
  definirModalidades(rows)
  return rows
}
