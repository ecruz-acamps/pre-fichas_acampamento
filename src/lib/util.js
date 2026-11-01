import { MODALIDADES } from './opcoes.js'

export const somenteDigitos = (v = '') => String(v).replace(/\D/g, '')

export function mascaraCep(v) {
  const d = somenteDigitos(v).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export function mascaraTelefone(v) {
  const d = somenteDigitos(v).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Idade completa em anos numa data de referência (padrão: hoje). */
export function calcularIdade(dataNascimento, referencia = new Date()) {
  if (!dataNascimento) return null
  const [a, m, d] = String(dataNascimento).split('-').map(Number)
  if (!a || !m || !d) return null
  let idade = referencia.getFullYear() - a
  const mes = referencia.getMonth() + 1
  if (mes < m || (mes === m && referencia.getDate() < d)) idade--
  return idade
}

/** Modalidades compatíveis com a idade/estado civil informados. */
export function modalidadesCompativeis(idade, estadoCivil) {
  if (idade == null) return MODALIDADES.map((m) => m.valor)
  const casado = estadoCivil === 'casado' || estadoCivil === 'uniao_estavel'
  return MODALIDADES.filter((m) => {
    if (m.valor === 'senior') return idade >= 30 || (casado && idade >= 18)
    return idade >= m.min && idade <= m.max
  }).map((m) => m.valor)
}

export function formatarDataHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function formatarData(isoDate) {
  if (!isoDate) return ''
  const [a, m, d] = String(isoDate).split('-')
  return `${d}/${m}/${a}`
}

export const simNao = (v) => (v === true ? 'Sim' : v === false ? 'Não' : '')

export function linkWhatsApp(telefone) {
  const d = somenteDigitos(telefone)
  if (!d) return null
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`
}
