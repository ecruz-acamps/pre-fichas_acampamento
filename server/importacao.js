// Importação de pré-fichas de outro sistema (planilha exportada em CSV).
//
//   node server/cli.js fichas importar arquivo.csv            → SIMULAÇÃO: só gera o relatório, não grava nada
//   node server/cli.js fichas importar arquivo.csv --aplicar  → grava tudo numa única transação
//   node server/cli.js fichas desfazer LOTE                   → apaga o lote importado
//
// Regras principais:
//   - a DATA DA PRÉ-FICHA da planilha é a data de inscrição e de entrada na fila (nunca é alterada);
//   - nada é inventado: o que faltar fica vazio; o que merece conferência vai para as observações internas da ficha;
//   - o que não dá para importar com segurança (ex.: data de nascimento impossível) fica numa lista de quarentena;
//   - quem já tem ficha ativa com o mesmo CPF no sistema não é duplicado.
import { calcularIdade, cpfValido, modalidadesCompativeis, somenteDigitos } from '../shared/util.js'
import { MODALIDADES, rotuloDe, ESTADOS_CIVIS } from '../shared/opcoes.js'
import { carregarMarca, salvarMarca } from './marca.js'
import { transacao } from './db.js'

// ------------------------------------------------------------------ CSV
/** Texto do arquivo: UTF-8; se não for (CSV "ANSI" do Excel), lê como Windows-1252 para não quebrar os acentos. */
export function decodificar(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { return new TextDecoder('windows-1252').decode(buffer) }
}
/** Lê um CSV (UTF-8; separador ; ou , detectado pelo cabeçalho; aspas e quebras de linha dentro de aspas). */
export function lerCsv(texto) {
  const t = String(texto).replace(/^﻿/, '')
  const primeira = t.slice(0, t.search(/\r?\n/) === -1 ? t.length : t.search(/\r?\n/))
  const sep = (primeira.match(/;/g) ?? []).length >= (primeira.match(/,/g) ?? []).length ? ';' : ','
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++ } else aspas = false } else campo += c
    } else if (c === '"') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((x) => x !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  linha.push(campo)
  if (linha.some((x) => x !== '')) linhas.push(linha)
  if (!linhas.length) return { cabecalho: [], registros: [] }
  const cabecalho = linhas[0].map((h) => semAcento(h))
  const registros = linhas.slice(1).map((l, i) => ({
    numero: i + 2,   // número da linha na planilha (1 = cabeçalho)
    valores: Object.fromEntries(cabecalho.map((h, j) => [h, (l[j] ?? '').trim()])),
  }))
  return { cabecalho, registros }
}

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const pegar = (v, nome) => v[nome] ?? ''
const comecaCom = (v, prefixo) => { const k = Object.keys(v).find((x) => x.startsWith(prefixo)); return k ? v[k] : '' }

export const COLUNAS_OBRIGATORIAS = ['nome', 'cpf', 'data de nascimento', 'sexo', 'estado civil', 'data da pre-ficha',
  'aguardando acampamento', 'telefone', 'cidade', 'estado']

// ------------------------------------------------------------------ conversões
function dataBR(s) {
  const t = String(s ?? '').trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  let a, mes, d
  if (m) { d = +m[1]; mes = +m[2]; a = +m[3] } else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) { a = +m[1]; mes = +m[2]; d = +m[3] } else return null
  const dt = new Date(0); dt.setUTCFullYear(a, mes - 1, d)   // setUTCFullYear: anos de 0 a 99 não viram 19xx
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null
  return { a, mes, d, iso: `${String(a).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}
const SEXO = { masculino: 'masculino', feminino: 'feminino' }
const ESTADO_CIVIL = {
  solteiro: ['solteiro'], solteira: ['solteiro'], casado: ['casado'], casada: ['casado'],
  'uniao estavel': ['uniao_estavel'], divorciado: ['divorciado'], divorciada: ['divorciado'],
  viuvo: ['viuvo'], viuva: ['viuvo'],
  separado: ['divorciado', 'Estado civil original: Separado(a) (importado como Divorciado(a)).'],
  separada: ['divorciado', 'Estado civil original: Separado(a) (importado como Divorciado(a)).'],
  padre: ['solteiro', 'Estado civil original: Padre (importado como Solteiro).'],
}
const MODALIDADE = { mirim: ['mirim'], fac: ['fac'], 'fac ii': ['fac', 'Modalidade original: FAC II (importada como FAC).'], juvenil: ['juvenil'],
  senior: ['senior'], casais: ['casais'] }
const NEGATIVO = /^(n[aã]o|nenhum[a]?|nada|n\/?a|-+|sem [a-zç ]+|n[aã]o (tenho|possuo|h[aá]|existe)( nenhum[a]?)?|nao se aplica)[.!]?$/i
const vazioOuNegativo = (s) => !s || NEGATIVO.test(semAcento(s)) || NEGATIVO.test(s.trim())
const sim = (s) => { const x = semAcento(s); return x === 'sim' ? true : x === 'nao' ? false : null }
const cortar = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** "16º Sênior - São Padre Pio (Vermelha)" → { numero, modalidade, tribo }. null se não seguir o padrão. */
export function lerEdicao(texto) {
  const t = limpar(texto)
  const m = /^(\d+)\s*[º°o]?\s*(?:acampamento\s+(?:de\s+)?)?(s[eê]nior|fac(?:\s*ii)?|mirim|juvenil|casais)\b[\s\-–:]*(.*?)\s*(?:\(([^()]*)\))?\s*$/i.exec(t)
  if (!m) return null
  const mod = semAcento(m[2]).replace(/\s+/g, ' ')
  return { numero: +m[1], modalidade: mod === 'fac ii' ? 'fac' : mod, tribo: limpar(m[4] ?? ''), original: t }
}

const TRIBO_CANONICA = { amarela: ['Amarelo', '#f2c200'], amarelo: ['Amarelo', '#f2c200'], azul: ['Azul', '#1e5bd6'], laranja: ['Laranja', '#ef7d1a'],
  marrom: ['Marrom', '#7b4a1e'], preta: ['Preto', '#222222'], preto: ['Preto', '#222222'], roxa: ['Roxo', '#7b3fa8'], roxo: ['Roxo', '#7b3fa8'],
  verde: ['Verde', '#2e8b3e'], vermelha: ['Vermelho', '#c62828'], vermelho: ['Vermelho', '#c62828'], rosa: ['Rosa', '#e0559b'], cinza: ['Cinza', '#7a7a7a'], branca: ['Branco', '#d9d9d9'], branco: ['Branco', '#d9d9d9'] }
/** Nome da tribo como o sistema usa ("Vermelha" → "Vermelho"). */
export function nomeDeTribo(texto) {
  const k = semAcento(texto)
  return TRIBO_CANONICA[k]?.[0] ?? (limpar(texto).charAt(0).toUpperCase() + limpar(texto).slice(1).toLowerCase())
}
const corDeTribo = (nome) => TRIBO_CANONICA[semAcento(nome)]?.[1] ?? '#888888'

/** Procura a tribo da marca (aceita masculino/feminino: "Vermelha" = "Vermelho"). */
export function casarTribo(nome, tribos) {
  const raiz = (s) => semAcento(s).replace(/(a|o|as|os)$/, '')
  const alvo = raiz(nome)
  return tribos.find((t) => semAcento(t) === semAcento(nome))
    ?? tribos.find((t) => raiz(t) === alvo)
    ?? null
}

// ------------------------------------------------------------------ uma linha → uma ficha
/**
 * Converte a linha da planilha. Devolve { quarentena: 'motivo' } se não puder ser importada com segurança,
 * ou { ficha, notas, campista, servo }.
 */
export function mapearLinha(registro, { hoje = new Date(), tribos = [] } = {}) {
  const v = registro.valores
  const notas = [], alertas = []                       // notas: tudo vai para a ficha; alertas: o que pede conferência da equipe
  const info = (t) => notas.push(t)
  const aviso = (t) => { notas.push(t); alertas.push(t) }
  const q = (motivo) => ({ quarentena: motivo })

  const nome = limpar(pegar(v, 'nome'))
  if (nome.length < 3) return q('Nome vazio ou curto demais.')
  if (nome.split(' ').length < 2) aviso('Nome com uma palavra só: conferir o sobrenome.')
  if (nome.length > 150) return q('Nome com mais de 150 caracteres.')

  const nasc = dataBR(pegar(v, 'data de nascimento'))
  const pre = dataBR(pegar(v, 'data da pre-ficha'))
  const modRaw = semAcento(pegar(v, 'aguardando acampamento'))
  const mod = MODALIDADE[modRaw]
  if (!mod) return q(`Modalidade desconhecida: "${pegar(v, 'aguardando acampamento')}".`)
  if (!nasc) return q(`Data de nascimento ilegível: "${pegar(v, 'data de nascimento')}".`)
  if (nasc.a < 1900) return q(`Data de nascimento impossível: ${pegar(v, 'data de nascimento')}.`)
  const idade = calcularIdade(nasc.iso, hoje)
  if (idade < 0) return q(`Data de nascimento no futuro: ${pegar(v, 'data de nascimento')}.`)
  if (idade > 110) return q(`Data de nascimento impossível (${idade} anos): ${pegar(v, 'data de nascimento')}.`)
  if (idade < 3 || (idade < 7 && mod[0] !== 'mirim')) return q(`Data de nascimento improvável (${idade} anos para ${rotuloDe(MODALIDADES, mod[0])}): ${pegar(v, 'data de nascimento')}. Provável erro de digitação.`)
  if (idade < 7) aviso(`Idade de ${idade} anos na modalidade Mirim (mínimo do sistema: 7): conferir a data de nascimento.`)
  if (!pre) return q(`Data da pré-ficha ilegível: "${pegar(v, 'data da pre-ficha')}".`)
  if (pre.a < 2000) return q(`Data da pré-ficha improvável: ${pegar(v, 'data da pre-ficha')}.`)
  if (new Date(`${pre.iso}T12:00:00Z`) > hoje) return q(`Data da pré-ficha no futuro: ${pegar(v, 'data da pre-ficha')}.`)

  const sexo = SEXO[semAcento(pegar(v, 'sexo'))]
  if (!sexo) return q(`Sexo não reconhecido: "${pegar(v, 'sexo')}".`)
  const ec = ESTADO_CIVIL[semAcento(pegar(v, 'estado civil'))]
  if (!ec) return q(`Estado civil não reconhecido: "${pegar(v, 'estado civil')}".`)
  if (ec[1]) info(ec[1])
  if (mod[1]) info(mod[1])

  const telDigitos = somenteDigitos(pegar(v, 'telefone'))
  if (telDigitos.length < 10 || telDigitos.length > 13) return q(`Telefone inválido: "${pegar(v, 'telefone')}".`)
  const telefone = limpar(pegar(v, 'telefone')).length >= 10 && limpar(pegar(v, 'telefone')).length <= 20
    ? limpar(pegar(v, 'telefone'))
    : `(${telDigitos.slice(0, 2)}) ${telDigitos.slice(2, -4)}-${telDigitos.slice(-4)}`

  const cidade = limpar(pegar(v, 'cidade'))
  const uf = limpar(pegar(v, 'estado')).toUpperCase()
  if (!cidade) return q('Cidade vazia.')
  if (!/^[A-Z]{2}$/.test(uf)) return q(`UF inválida: "${pegar(v, 'estado')}".`)

  // CPF: sem CPF válido a ficha entra assim mesmo (sem o CPF), com aviso
  let cpf = somenteDigitos(pegar(v, 'cpf'))
  if (cpf.length >= 9 && cpf.length < 11 && cpfValido(cpf.padStart(11, '0'))) cpf = cpf.padStart(11, '0')   // o Excel come o zero à esquerda
  if (!cpfValido(cpf)) { if (cpf) aviso(`CPF da planilha inválido (${pegar(v, 'cpf')}): ficha importada sem CPF.`); cpf = null }

  // contatos
  let email = limpar(pegar(v, 'email')).toLowerCase()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { aviso(`E-mail da planilha inválido: ${email}`); email = '' }
  if (email.length > 200) email = ''
  const cepDig = somenteDigitos(pegar(v, 'cep'))
  const cep = cepDig.length === 8 ? cepDig : null

  // textos (cortados no limite do sistema; o texto completo vai para as observações)
  const limitar = (rotulo, valor, max) => {
    if (valor.length <= max) return valor
    aviso(`${rotulo} (texto completo, foi cortado na ficha): ${valor}`)
    return cortar(valor, max)
  }
  const como = limitar('Como conheceu', limpar(comecaCom(v, 'como voce conheceu')), 200)
  const motivo = limitar('Por que quer participar', limpar(comecaCom(v, 'por que voce quer')), 2000)
  const complemento = limitar('Complemento', limpar(pegar(v, 'complemento')), 100)
  const vicioTxt = limpar(pegar(v, 'vicios')), restr = limpar(pegar(v, 'restricoes medicas'))
  const pastoral = limpar(pegar(v, 'pastoral'))

  // cônjuge
  const conjugeNome = limpar(pegar(v, 'nome do conjuge'))
  let conjugeCpfBruto = somenteDigitos(pegar(v, 'cpf do conjuge'))
  if (conjugeCpfBruto.length >= 9 && conjugeCpfBruto.length < 11 && cpfValido(conjugeCpfBruto.padStart(11, '0'))) conjugeCpfBruto = conjugeCpfBruto.padStart(11, '0')
  const conjugeCpf = cpfValido(conjugeCpfBruto) ? conjugeCpfBruto : null
  if (conjugeCpfBruto && !conjugeCpf) aviso(`CPF do cônjuge inválido na planilha: ${pegar(v, 'cpf do conjuge')}.`)
  if (pegar(v, 'data de casamento')) info(`Data de casamento: ${pegar(v, 'data de casamento')}.`)
  if (pegar(v, 'casado no religioso')) info(`Casado(a) no religioso: ${pegar(v, 'casado no religioso')}.`)
  const conhecidos = limpar(pegar(v, 'campistas conhecidos').replace(/\n+/g, '; '))
  if (conhecidos) info(`Campistas conhecidos: ${conhecidos}`)

  // histórico (vira participação no acampamento)
  const campista = []
  const campistaTxt = pegar(v, 'onde fui campista')
  if (campistaTxt) {
    for (const parte of campistaTxt.split(/\n+/).map(limpar).filter(Boolean)) {
      const e = lerEdicao(parte)
      if (e) campista.push(e); else aviso(`Foi campista (texto fora do padrão, não registrado como participação): ${parte}`)
    }
  }
  for (const e of campista) {
    e.triboSistema = e.tribo ? (casarTribo(e.tribo, tribos) ?? nomeDeTribo(e.tribo)) : null   // tribo que não existe ainda é acrescentada à marca
  }
  const servoTxt = pegar(v, 'onde fui servo')
  if (servoTxt) info(`Foi servo: ${servoTxt.split(/\n+/).map(limpar).filter(Boolean).join('; ')}`)
  const retiros = limitar('Retiros frequentados', limpar(pegar(v, 'retiros frequentados')), 1000)

  // a modalidade que a pessoa esperava é mantida (a ordem da fila não muda); se não bate com a regra do sistema, vira aviso
  const compat = modalidadesCompativeis(idade, ec[0])
  if (!compat.includes(mod[0])) {
    const t = `REVISAR MODALIDADE: aguarda ${rotuloDe(MODALIDADES, mod[0])}, mas pela regra do sistema (${idade} anos, ${rotuloDe(ESTADOS_CIVIS, ec[0])}) cabem: ${compat.map((x) => rotuloDe(MODALIDADES, x)).join(', ') || 'nenhuma'}.`
    notas.unshift(t); alertas.unshift(t)
  }

  const ficha = {
    // data original da pré-ficha, ao meio-dia (Brasília): o dia exibido é sempre o da planilha
    criado_em: `${pre.iso} 12:00:00-03`,
    data_pre_ficha: pre.iso,
    nome_completo: nome, data_nascimento: nasc.iso, estado_civil: ec[0], sexo,
    profissao: cortar(limpar(pegar(v, 'profissao')), 120) || null,
    telefone,
    religiao: (() => { const r = limpar(pegar(v, 'religiao')); return r ? cortar(r.replace(/^Sem Religião$/i, 'Sem religião'), 80) : 'Não informada' })(),
    batizado: sim(pegar(v, 'batizado')) ?? false,
    primeira_eucaristia: sim(pegar(v, 'primeira comunhao')) ?? false,
    crismado: sim(pegar(v, 'crismado')) ?? false,
    paroquia: cortar(limpar(pegar(v, 'paroquia')), 150) || null,
    participa_pastoral: !vazioOuNegativo(pastoral), pastoral_qual: vazioOuNegativo(pastoral) ? null : cortar(pastoral, 150),
    email: email || null, instagram: cortar(limpar(pegar(v, 'instagram')), 100) || null, facebook: cortar(limpar(pegar(v, 'facebook')), 150) || null,
    cep, logradouro: cortar(limpar(pegar(v, 'rua')), 200) || null, numero: cortar(limpar(pegar(v, 'numero')), 20) || null,
    complemento: complemento || null, bairro: cortar(limpar(pegar(v, 'bairro')), 100) || null, cidade: cortar(cidade, 100), uf,
    como_conheceu: como || null, motivo: motivo || null, modalidade: mod[0],
    possui_vicio: !vazioOuNegativo(vicioTxt), vicio_qual: vazioOuNegativo(vicioTxt) ? null : cortar(vicioTxt, 200),
    restricoes_medicas: vazioOuNegativo(restr) ? null : cortar(restr, 1000),
    retiros_anteriores: retiros || null,
    cpf, conjuge_nome: conjugeNome ? cortar(conjugeNome, 150) : null, conjuge_cpf: conjugeCpf,
  }
  return { ficha, notas, alertas, campista, idade }
}

// ------------------------------------------------------------------ plano (simulação)
/**
 * Lê as linhas, aplica as regras e confere com o banco. NÃO grava nada.
 * Devolve { importar, quarentena, ignoradas, edicoesNovas, edicoesExistentes, resumo }.
 */
export async function planejar(pool, registros, { hoje = new Date() } = {}) {
  const marca = await carregarMarca(pool)
  const tribos = (marca.tribos ?? []).map((t) => t.nome)
  const importar = [], quarentena = [], ignoradas = []
  const vistosCpf = new Map(), porNomeNasc = new Map()

  for (const r of registros) {
    const m = mapearLinha(r, { hoje, tribos })
    if (m.quarentena) { quarentena.push({ linha: r.numero, nome: limpar(r.valores.nome), cpf: r.valores.cpf, telefone: r.valores.telefone, motivo: m.quarentena }); continue }
    const cpf = m.ficha.cpf
    if (cpf) {
      if (vistosCpf.has(cpf)) { quarentena.push({ linha: r.numero, nome: m.ficha.nome_completo, cpf, telefone: m.ficha.telefone, motivo: `CPF repetido na planilha (já na linha ${vistosCpf.get(cpf)}).` }); continue }
      vistosCpf.set(cpf, r.numero)
    }
    const chave = `${semAcento(m.ficha.nome_completo)}|${m.ficha.data_nascimento}`
    if (porNomeNasc.has(chave)) {
      const outra = porNomeNasc.get(chave)
      for (const [alvo, ref] of [[m, outra.linha], [outra.m, r.numero]]) {
        const t = `Possível duplicata: mesmo nome e nascimento da linha ${ref} (CPF diferente).`
        alvo.notas.push(t); alvo.alertas.push(t)
      }
    } else porNomeNasc.set(chave, { linha: r.numero, m })
    importar.push({ linha: r.numero, ...m })
  }

  // quem já tem ficha ativa com o mesmo CPF no sistema não é duplicado
  const cpfs = importar.map((x) => x.ficha.cpf).filter(Boolean)
  const existentes = new Set()
  for (let i = 0; i < cpfs.length; i += 5000) {
    const { rows } = await pool.query(
      `select distinct cpf from pre_fichas where cpf = any($1) and status in ('aguardando','em_contato','confirmado')`, [cpfs.slice(i, i + 5000)])
    for (const x of rows) existentes.add(x.cpf)
  }
  const aImportar = []
  for (const x of importar) {
    if (x.ficha.cpf && existentes.has(x.ficha.cpf)) ignoradas.push({ linha: x.linha, nome: x.ficha.nome_completo, cpf: x.ficha.cpf, motivo: 'Já existe ficha ativa com este CPF no sistema.' })
    else aImportar.push(x)
  }

  // tribos usadas no histórico que a marca ainda não tem (ex.: "Vermelha" → "Vermelho") são acrescentadas
  const triboExiste = new Set(tribos.map(semAcento))
  const tribosNovas = new Map()
  for (const x of aImportar) for (const e of x.campista) {
    if (e.triboSistema && !triboExiste.has(semAcento(e.triboSistema)) && !tribosNovas.has(e.triboSistema)) tribosNovas.set(e.triboSistema, { nome: e.triboSistema, cor: corDeTribo(e.triboSistema) })
  }

  // edições (acampamentos) que faltam
  const necessarias = new Map()
  for (const x of aImportar) for (const e of x.campista) necessarias.set(`${e.modalidade}:${e.numero}`, { modalidade: e.modalidade, numero: e.numero })
  const { rows: ja } = await pool.query('select id, modalidade, numero from acampamentos')
  const jaMapa = new Map(ja.map((a) => [`${a.modalidade}:${a.numero}`, a.id]))
  const edicoesNovas = [...necessarias.values()].filter((e) => !jaMapa.has(`${e.modalidade}:${e.numero}`))
    .sort((a, b) => a.modalidade.localeCompare(b.modalidade) || a.numero - b.numero)

  const porModalidade = {}
  for (const x of aImportar) porModalidade[x.ficha.modalidade] = (porModalidade[x.ficha.modalidade] ?? 0) + 1
  const resumo = {
    linhas: registros.length, importar: aImportar.length, quarentena: quarentena.length, ignoradas: ignoradas.length,
    porModalidade, revisarModalidade: aImportar.filter((x) => x.notas.some((n) => n.startsWith('REVISAR MODALIDADE'))).length,
    comAlerta: aImportar.filter((x) => x.alertas.length).length, tribosNovas: [...tribosNovas.keys()], semEmail: aImportar.filter((x) => !x.ficha.email).length, semCep: aImportar.filter((x) => !x.ficha.cep).length,
    semMotivo: aImportar.filter((x) => !x.ficha.motivo).length, semCpf: aImportar.filter((x) => !x.ficha.cpf).length,
    participacoes: aImportar.reduce((s, x) => s + x.campista.length, 0), edicoesNovas: edicoesNovas.length,
    edicoesExistentes: necessarias.size - edicoesNovas.length,
    primeiraData: aImportar.map((x) => x.ficha.data_pre_ficha).sort()[0] ?? null,
    ultimaData: aImportar.map((x) => x.ficha.data_pre_ficha).sort().at(-1) ?? null,
  }
  return { importar: aImportar, quarentena, ignoradas, edicoesNovas, tribosNovas: [...tribosNovas.values()], jaMapa, resumo }
}

// ------------------------------------------------------------------ aplicação
const COLUNAS = ['created_at', 'nome_completo', 'data_nascimento', 'estado_civil', 'sexo', 'profissao', 'telefone', 'religiao', 'batizado',
  'primeira_eucaristia', 'crismado', 'paroquia', 'participa_pastoral', 'pastoral_qual', 'email', 'instagram', 'facebook', 'cep', 'logradouro',
  'numero', 'complemento', 'bairro', 'cidade', 'uf', 'como_conheceu', 'motivo', 'modalidade', 'possui_vicio', 'vicio_qual', 'restricoes_medicas',
  'retiros_anteriores', 'termos_aceitos', 'status', 'observacoes_internas', 'cpf', 'conjuge_nome', 'conjuge_cpf', 'importada_lote', 'importada_em']

export const loteNovo = (agora = new Date()) => `importacao-${agora.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`

/** Grava o plano numa transação única: ou entra tudo, ou nada. A data da pré-ficha da planilha é mantida. */
export async function aplicar(pool, plano, { lote, arquivo = null } = {}) {
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(lote ?? '')) throw new Error('Nome de lote inválido (3 a 60 letras, números, ponto, hífen ou sublinhado).')
  const ordenadas = [...plano.importar].sort((a, b) => a.ficha.data_pre_ficha.localeCompare(b.ficha.data_pre_ficha) || a.linha - b.linha)
  return transacao(pool, async (db) => {
    const { rowCount } = await db.query('select 1 from importacoes where lote = $1', [lote])
    if (rowCount) throw new Error(`O lote "${lote}" já existe. Use outro nome (ou desfaça o anterior).`)
    await db.query(`select set_config('app.importacao', 'sim', true)`)   // autoriza manter a data original (só nesta transação)

    const ids = new Map(plano.jaMapa)
    const criadas = []
    for (const e of plano.edicoesNovas) {
      const { rows: [a] } = await db.query(
        `insert into acampamentos (numero, modalidade, observacao) values ($1, $2, $3) returning id`,
        [e.numero, e.modalidade, `Criado na importação ${lote} (sem datas: complete se quiser).`])
      ids.set(`${e.modalidade}:${e.numero}`, a.id); criadas.push(a.id)
    }
    await db.query('insert into importacoes (lote, arquivo) values ($1, $2)', [lote, arquivo])

    const termos = JSON.stringify([`Ficha importada do sistema anterior (lote ${lote}). O aceite dos termos foi dado no formulário original.`])
    const dataImportacao = new Date().toLocaleDateString('pt-BR')
    let fichas = 0, participacoes = 0
    for (const x of ordenadas) {
      const f = x.ficha
      const obs = cortar([`Importada do sistema anterior em ${dataImportacao} (lote ${lote}). Data da pré-ficha original: ${f.data_pre_ficha.split('-').reverse().join('/')}.`, ...x.notas].join('\n'), 4000)
      const valores = [f.criado_em, f.nome_completo, f.data_nascimento, f.estado_civil, f.sexo, f.profissao, f.telefone, f.religiao, f.batizado,
        f.primeira_eucaristia, f.crismado, f.paroquia, f.participa_pastoral, f.pastoral_qual, f.email, f.instagram, f.facebook, f.cep, f.logradouro,
        f.numero, f.complemento, f.bairro, f.cidade, f.uf, f.como_conheceu, f.motivo, f.modalidade, f.possui_vicio, f.vicio_qual, f.restricoes_medicas,
        f.retiros_anteriores, termos, 'aguardando', obs, f.cpf, f.conjuge_nome, f.conjuge_cpf, lote, new Date()]
      const { rows: [nova] } = await db.query(
        `insert into pre_fichas (${COLUNAS.join(', ')}) values (${COLUNAS.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, valores)
      fichas++
      for (const e of x.campista) {
        const acampamento = ids.get(`${e.modalidade}:${e.numero}`)
        const r = await db.query(
          'insert into participacoes (acampamento_id, pre_ficha_id, tribo) values ($1, $2, $3) on conflict do nothing',
          [acampamento, nova.id, e.triboSistema ?? null])
        participacoes += r.rowCount
      }
    }
    const resumo = { ...plano.resumo, gravadas: fichas, participacoesGravadas: participacoes, edicoesCriadas: criadas.length }
    await db.query('update importacoes set resumo = $2, acampamentos_criados = $3 where lote = $1', [lote, JSON.stringify(resumo), criadas])
    return resumo
  }).then(async (resumo) => {
    if (plano.tribosNovas?.length) {
      const marca = await carregarMarca(pool)
      const r = await salvarMarca(pool, { ...marca, tribos: [...(marca.tribos ?? []), ...plano.tribosNovas] })
      if (r.erros) throw new Error(`Importado, mas não consegui acrescentar as tribos ${plano.tribosNovas.map((t) => t.nome).join(', ')}: ${JSON.stringify(r.erros)}`)
    }
    return resumo
  })
}

/** Apaga um lote importado. Se a equipe já mexeu em alguma ficha do lote, só com `forcar`. */
export async function desfazer(pool, lote, { forcar = false } = {}) {
  return transacao(pool, async (db) => {
    const { rows: [imp] } = await db.query('select acampamentos_criados from importacoes where lote = $1', [lote])
    if (!imp) throw new Error(`Lote "${lote}" não encontrado.`)
    const { rows: [m] } = await db.query(
      `select count(*)::int total, count(*) filter (where status <> 'aguardando' or atualizado_em is not null or conjuge_id is not null or participante_id is not null)::int mexidas
         from pre_fichas where importada_lote = $1`, [lote])
    if (m.mexidas > 0 && !forcar) {
      throw new Error(`${m.mexidas} ficha(s) deste lote já foram alteradas pela equipe (status, vínculos ou conta). Para apagar mesmo assim, use --forcar.`)
    }
    await db.query('delete from pre_fichas where importada_lote = $1', [lote])
    // as edições criadas pela importação só somem se ficaram sem nenhuma participação
    const { rowCount } = await db.query(
      `delete from acampamentos a where a.id = any($1) and not exists (select 1 from participacoes p where p.acampamento_id = a.id)`, [imp.acampamentos_criados])
    await db.query('delete from importacoes where lote = $1', [lote])
    return { fichas: m.total, edicoes: rowCount }
  })
}

// ------------------------------------------------------------------ relatórios
const csvCelula = (x) => { const s = String(x ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const paraCsv = (cabecalho, linhas) => `﻿${[cabecalho, ...linhas].map((l) => l.map(csvCelula).join(';')).join('\r\n')}\r\n`

export function relatorios(plano) {
  const r = plano.resumo
  const por = Object.entries(r.porModalidade).map(([m, n]) => `    ${rotuloDe(MODALIDADES, m)}: ${n}`).join('\n')
  const resumo = `RELATÓRIO DA IMPORTAÇÃO
=======================
Linhas lidas ........................ ${r.linhas}
Serão importadas .................... ${r.importar}
  por modalidade:
${por}
  datas de pré-ficha mantidas ....... de ${r.primeiraData?.split('-').reverse().join('/')} a ${r.ultimaData?.split('-').reverse().join('/')}
  pedem conferência da equipe ....... ${r.comAlerta}  (modalidade a revisar: ${r.revisarModalidade})  → revisar.csv
  tribos acrescentadas ao sistema ... ${r.tribosNovas.join(', ') || 'nenhuma'}
  sem e-mail / sem CEP / sem motivo . ${r.semEmail} / ${r.semCep} / ${r.semMotivo}
  sem CPF (inválido na planilha) .... ${r.semCpf}
  participações em acampamentos ..... ${r.participacoes}  (edições novas: ${r.edicoesNovas}; já existentes: ${r.edicoesExistentes})
Quarentena (NÃO importadas) ......... ${r.quarentena}  → quarentena.csv
Já existiam no sistema (ignoradas) .. ${r.ignoradas}  → ignoradas.csv

Observações:
 - A "Data da Pré-Ficha" da planilha é mantida como data de inscrição e de entrada na fila. A planilha não tem horário:
   no mesmo dia, a ordem é a da planilha.
 - Nenhum dado foi inventado: o que faltava na planilha continua vazio.
 - Cada ficha leva nas observações internas o que veio da planilha e não tem campo próprio (campistas conhecidos, casamento,
   foi servo...). O que pede conferência está também em revisar.csv.
`
  return {
    'resumo.txt': resumo,
    'quarentena.csv': paraCsv(['linha', 'nome', 'cpf', 'telefone', 'motivo'], plano.quarentena.map((q) => [q.linha, q.nome, q.cpf, q.telefone, q.motivo])),
    'ignoradas.csv': paraCsv(['linha', 'nome', 'cpf', 'motivo'], plano.ignoradas.map((q) => [q.linha, q.nome, q.cpf, q.motivo])),
    'revisar.csv': paraCsv(['linha', 'nome', 'cpf', 'modalidade', 'observacoes'],
      plano.importar.filter((x) => x.alertas.length).map((x) => [x.linha, x.ficha.nome_completo, x.ficha.cpf ?? '', rotuloDe(MODALIDADES, x.ficha.modalidade), x.alertas.join(' | ')])),
  }
}
