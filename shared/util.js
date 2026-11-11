import { modalidadesAtivas } from './opcoes.js'

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
export function modalidadesCompativeis(idade, estadoCivil, sexo = '') {
  const ativas = modalidadesAtivas()
  if (idade == null) return ativas.map((m) => m.valor)
  const casado = estadoCivil === 'casado' || estadoCivil === 'uniao_estavel'
  return ativas.filter((m) => {
    if (m.sexo && sexo && m.sexo !== sexo) return false   // modalidade só para um sexo (sem sexo informado ainda, não filtra)
    if (m.regra === 'senior') return idade >= m.min || (casado && idade >= 18)
    if (m.regra === 'casais') return casado && idade >= m.min // casal: casado(a) ou em união estável
    if (m.casado && !casado) return false
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

/**
 * Normaliza nomes de cidade/bairro para comparação ("São José" = "SAO JOSE").
 * Mesma regra da função chave_local() do banco.
 */
export function chaveLocal(texto) {
  const s = String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return s || null
}

/** Divide um texto com **negrito** em partes para exibir com segurança. */
export function partesNegrito(texto) {
  return String(texto ?? '').split(/\*\*(.+?)\*\*/g).map((parte, i) => ({ texto: parte, negrito: i % 2 === 1 }))
}

/** Escolhe a grafia "mais completa" de um nome: não toda em maiúsculas e com acentos. */
export function melhorGrafia(a, b) {
  if (!a) return b
  if (!b) return a
  const nota = (s) => (s === s.toUpperCase() ? 0 : 4) + (s.normalize('NFD') !== s ? 2 : 0) + (s[0] === s[0].toUpperCase() ? 1 : 0)
  return nota(b) > nota(a) ? b : a
}

/** CPF válido (11 dígitos e dígitos verificadores corretos). */
export function cpfValido(valor) {
  const c = somenteDigitos(valor)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  const dv = (n) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10])
}

/** 000.000.000-00 enquanto digita. */
export function mascaraCpf(valor) {
  const d = somenteDigitos(valor).slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}
