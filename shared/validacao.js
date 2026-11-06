// Regras da pré-ficha, usadas no navegador (orientar quem preenche)
// e no servidor (quem realmente garante). Mantenha em um só lugar.
import {
  COMO_CONHECEU, ESTADOS_CIVIS, MODALIDADES, RELIGIOES, SEXOS, UFS,
} from './opcoes.js'
import { calcularIdade, cpfValido, modalidadesCompativeis, somenteDigitos } from './util.js'

/** Formato dos dados do formulário (e valores iniciais). */
export const INICIAL = {
  nome_completo: '', data_nascimento: '', estado_civil: '', sexo: '', profissao: '',
  telefone: '', responsavel_nome: '', responsavel_telefone: '',
  conjuge_nome: '', conjuge_telefone: '', conjuge_fez_acampamento: null, conjuge_acampamento_numero: '',
  religiao: '', religiao_outra: '',
  batizado: null, primeira_eucaristia: null, crismado: null,
  paroquia: '', participa_pastoral: null, pastoral_qual: '',
  email: '', instagram: '', facebook: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  como_conheceu: '', como_conheceu_outro: '', motivo: '', modalidade: '',
  conjuge_cpf: '', // só na modalidade Casais
  possui_vicio: null, vicio_qual: '', restricoes_medicas: '', retiros_anteriores: '',
  aceites: [], // uma marcação (true) para cada declaração configurada na marca
  website: '', // honeypot anti-robô (fica escondido)
}

/** Casado(a) ou em união estável: o formulário pergunta sobre o cônjuge. */
export const temConjuge = (f) => f.estado_civil === 'casado' || f.estado_civil === 'uniao_estavel'

/** Tamanho máximo de cada campo de texto. */
export const MAXIMO = {
  nome_completo: 150, profissao: 120, telefone: 20, responsavel_nome: 150, responsavel_telefone: 20,
  conjuge_nome: 150, conjuge_telefone: 20, conjuge_acampamento_numero: 6,
  religiao_outra: 70, paroquia: 150, pastoral_qual: 150,
  email: 200, instagram: 100, facebook: 150,
  cep: 9, logradouro: 200, numero: 20, complemento: 100, bairro: 100, cidade: 100,
  como_conheceu_outro: 180, motivo: 2000, vicio_qual: 200,
  restricoes_medicas: 1000, retiros_anteriores: 1000, website: 200, conjuge_cpf: 14,
}

/**
 * Pega só os campos conhecidos e com o tipo certo. Protege o servidor contra
 * dados malformados (número no lugar de texto, campos extras etc.).
 */
export function normalizarEntrada(bruto) {
  const entrada = bruto && typeof bruto === 'object' ? bruto : {}
  const f = {}
  for (const [campo, padrao] of Object.entries(INICIAL)) {
    const v = entrada[campo]
    if (Array.isArray(padrao)) f[campo] = Array.isArray(v) ? v.slice(0, 20).map((x) => x === true) : []
    else if (typeof padrao === 'string') f[campo] = typeof v === 'string' ? v : ''
    else if (padrao === null) f[campo] = v === true || v === false ? v : null
    else f[campo] = v === true
  }
  return f
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const valores = (lista) => lista.map((o) => (typeof o === 'string' ? o : o.valor))

/**
 * Valida a pré-ficha. `quantidadeTermos` é o número de declarações da marca
 * (todas precisam ser aceitas).
 */
export function validar(f, quantidadeTermos = 0) {
  const e = {}
  const idade = DATA_ISO.test(f.data_nascimento) ? calcularIdade(f.data_nascimento) : null
  const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
  const obrig = (campo, msg = 'Campo obrigatório.') => { if (vazio(f[campo])) e[campo] = msg }
  const umDe = (campo, lista, msg = 'Opção inválida.') => {
    if (!e[campo] && !vazio(f[campo]) && !valores(lista).includes(f[campo])) e[campo] = msg
  }

  for (const [campo, max] of Object.entries(MAXIMO)) {
    if (typeof f[campo] === 'string' && f[campo].trim().length > max) e[campo] = `Máximo de ${max} caracteres.`
  }

  obrig('nome_completo')
  if (!e.nome_completo && f.nome_completo.trim().split(/\s+/).length < 2)
    e.nome_completo = 'Informe nome e sobrenome.'
  obrig('data_nascimento')
  if (!e.data_nascimento && (idade == null || idade < 5 || idade > 110))
    e.data_nascimento = 'Data de nascimento inválida.'
  obrig('estado_civil'); umDe('estado_civil', ESTADOS_CIVIS)
  obrig('sexo'); umDe('sexo', SEXOS)
  obrig('telefone')
  if (!e.telefone && somenteDigitos(f.telefone).length < 10) e.telefone = 'Informe o telefone com DDD.'

  if (idade != null && idade < 18) {
    obrig('responsavel_nome', 'Obrigatório para menores de 18 anos.')
    obrig('responsavel_telefone', 'Obrigatório para menores de 18 anos.')
    if (!e.responsavel_telefone && somenteDigitos(f.responsavel_telefone).length < 10)
      e.responsavel_telefone = 'Informe o telefone com DDD.'
  }

  if (temConjuge(f)) {
    if (f.conjuge_telefone.trim() && somenteDigitos(f.conjuge_telefone).length < 10)
      e.conjuge_telefone = 'Informe o telefone com DDD.'
    const n = f.conjuge_acampamento_numero.trim()
    if (f.conjuge_fez_acampamento && n && !/^\d{1,6}$/.test(n)) e.conjuge_acampamento_numero = 'Informe só o número (ex.: 24).'
  }

  obrig('religiao'); umDe('religiao', RELIGIOES)
  if (f.religiao === 'Outra') obrig('religiao_outra', 'Qual religião?')
  obrig('batizado', 'Selecione uma opção.')
  obrig('primeira_eucaristia', 'Selecione uma opção.')
  obrig('crismado', 'Selecione uma opção.')
  obrig('participa_pastoral', 'Selecione uma opção.')
  if (f.participa_pastoral) obrig('pastoral_qual', 'Qual pastoral?')

  obrig('email')
  if (!e.email && !EMAIL.test(f.email.trim())) e.email = 'E-mail inválido.'

  obrig('cep')
  if (!e.cep && somenteDigitos(f.cep).length !== 8) e.cep = 'CEP inválido.'
  obrig('cidade')
  obrig('uf'); umDe('uf', UFS)

  obrig('como_conheceu'); umDe('como_conheceu', COMO_CONHECEU)
  if (f.como_conheceu === 'Outro') obrig('como_conheceu_outro', 'Conte como conheceu.')
  obrig('motivo')
  obrig('modalidade', 'Escolha a modalidade.'); umDe('modalidade', MODALIDADES)
  if (!e.modalidade && idade != null && !modalidadesCompativeis(idade, f.estado_civil).includes(f.modalidade))
    e.modalidade = 'Esta modalidade não corresponde à sua idade / estado civil.'
  if (f.modalidade === 'casais') {
    obrig('conjuge_cpf', 'Informe o CPF do cônjuge.')
    if (!e.conjuge_cpf && !cpfValido(f.conjuge_cpf)) e.conjuge_cpf = 'CPF do cônjuge inválido.'
  }

  obrig('possui_vicio', 'Selecione uma opção.')
  if (f.possui_vicio) obrig('vicio_qual', 'Qual vício?')

  for (let i = 0; i < quantidadeTermos; i++) {
    if (f.aceites[i] !== true) e[`aceite_${i}`] = 'É necessário aceitar.'
  }
  return e
}

/**
 * Converte os dados do formulário (já validados) no registro gravado no banco.
 * `termos` = textos das declarações aceitas (gravados junto com a ficha).
 */
export function montarRegistro(f, termos = []) {
  const t = (v) => (v ?? '').trim() || null
  const menor = calcularIdade(f.data_nascimento) < 18
  return {
    nome_completo: f.nome_completo.trim().replace(/\s+/g, ' '),
    data_nascimento: f.data_nascimento,
    estado_civil: f.estado_civil,
    sexo: f.sexo,
    profissao: t(f.profissao),
    telefone: f.telefone.trim(),
    responsavel_nome: menor ? t(f.responsavel_nome) : null,
    responsavel_telefone: menor ? t(f.responsavel_telefone) : null,
    conjuge_nome: temConjuge(f) ? t(f.conjuge_nome) : null,
    conjuge_telefone: temConjuge(f) ? t(f.conjuge_telefone) : null,
    conjuge_fez_acampamento: temConjuge(f) ? f.conjuge_fez_acampamento : null,
    conjuge_acampamento_numero: temConjuge(f) && f.conjuge_fez_acampamento && /^\d{1,6}$/.test(f.conjuge_acampamento_numero.trim())
      ? Number(f.conjuge_acampamento_numero.trim()) : null,
    religiao: f.religiao === 'Outra' ? `Outra: ${f.religiao_outra.trim()}` : f.religiao,
    batizado: f.batizado,
    primeira_eucaristia: f.primeira_eucaristia,
    crismado: f.crismado,
    paroquia: t(f.paroquia),
    participa_pastoral: f.participa_pastoral,
    pastoral_qual: f.participa_pastoral ? t(f.pastoral_qual) : null,
    email: f.email.trim().toLowerCase(),
    instagram: t(f.instagram),
    facebook: t(f.facebook),
    cep: somenteDigitos(f.cep),
    logradouro: t(f.logradouro),
    numero: t(f.numero),
    complemento: t(f.complemento),
    bairro: t(f.bairro),
    cidade: f.cidade.trim(),
    uf: f.uf,
    como_conheceu: f.como_conheceu === 'Outro' ? `Outro: ${f.como_conheceu_outro.trim()}` : f.como_conheceu,
    motivo: f.motivo.trim(),
    modalidade: f.modalidade,
    conjuge_cpf: f.modalidade === 'casais' ? somenteDigitos(f.conjuge_cpf) : null,
    possui_vicio: f.possui_vicio,
    vicio_qual: f.possui_vicio ? t(f.vicio_qual) : null,
    restricoes_medicas: t(f.restricoes_medicas),
    retiros_anteriores: t(f.retiros_anteriores),
    termos_aceitos: JSON.stringify(termos.map((t) => t.replace(/\*\*/g, ''))),
  }
}
