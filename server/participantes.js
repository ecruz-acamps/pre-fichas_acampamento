// Contas dos participantes: sessões, tokens de redefinição e importação de contas antigas.
import { createHash, randomBytes } from 'node:crypto'
import { cpfValido, somenteDigitos } from '../shared/util.js'

export const COOKIE_CONTA = 'prefichas_conta'
export const STATUS_ATIVOS = ['aguardando', 'em_contato', 'confirmado']
const hash = (token) => createHash('sha256').update(token).digest('hex')
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function criarSessaoConta(pool, participanteId, horas) {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `insert into participantes_sessoes (id, participante_id, expira_em) values ($1, $2, now() + make_interval(hours => $3))`,
    [hash(token), participanteId, horas])
  return token
}

export async function buscarSessaoConta(pool, token, horas) {
  if (!token) return null
  const id = hash(token)
  const { rows: [p] } = await pool.query(
    `select p.id, p.cpf, p.email, p.nome, s.expira_em < now() + make_interval(hours => $2) / 2 as renovar
       from participantes_sessoes s join participantes p on p.id = s.participante_id
      where s.id = $1 and s.expira_em > now()`, [id, horas])
  if (!p) return null
  if (p.renovar) await pool.query('update participantes_sessoes set expira_em = now() + make_interval(hours => $2) where id = $1', [id, horas])
  delete p.renovar
  return p
}

export async function encerrarSessaoConta(pool, token) {
  if (token) await pool.query('delete from participantes_sessoes where id = $1', [hash(token)])
}

export async function encerrarSessoesConta(pool, participanteId) {
  await pool.query('delete from participantes_sessoes where participante_id = $1', [participanteId])
}

/** Cria um token de redefinição (1 h). Devolve null se já foi pedido há menos de 2 minutos. */
export async function criarRedefinicao(pool, participanteId) {
  const { rows: [recente] } = await pool.query(
    `select 1 from participantes_redefinicoes where participante_id = $1 and criado_em > now() - interval '2 minutes'`,
    [participanteId])
  if (recente) return null
  await pool.query('delete from participantes_redefinicoes where participante_id = $1', [participanteId])
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `insert into participantes_redefinicoes (id, participante_id, expira_em) values ($1, $2, now() + interval '1 hour')`,
    [hash(token), participanteId])
  return token
}

/** Consome o token (uma vez só). Devolve o id do participante ou null. */
export async function usarRedefinicao(pool, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const { rows: [r] } = await pool.query(
    `update participantes_redefinicoes set usado_em = now()
      where id = $1 and usado_em is null and expira_em > now()
      returning participante_id`, [hash(token)])
  return r?.participante_id ?? null
}

/** Busca a conta pelo que a pessoa digitou no login (CPF ou e-mail). */
export async function buscarPorLogin(pool, login) {
  const texto = String(login ?? '').trim().toLowerCase().slice(0, 200)
  if (!texto) return null
  const { rows: [p] } = texto.includes('@')
    ? await pool.query('select * from participantes where email = $1', [texto])
    : await pool.query('select * from participantes where cpf = $1', [somenteDigitos(texto)])
  return p ?? null
}

// ---------------------------------------------------------------- importação
function lerCsv(texto) {
  const linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!linhas.length) return { cabecalho: [], registros: [] }
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ','
  const quebrar = (linha) => {
    const campos = []
    let atual = '', aspas = false
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]
      if (aspas) {
        if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++ } else if (c === '"') aspas = false
        else atual += c
      } else if (c === '"') aspas = true
      else if (c === sep) { campos.push(atual.trim()); atual = '' } else atual += c
    }
    campos.push(atual.trim())
    return campos
  }
  const normal = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
  return { cabecalho: quebrar(linhas[0]).map(normal), registros: linhas.slice(1).map(quebrar) }
}

function lerData(v) {
  const t = String(v ?? '').trim()
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * Importa contas antigas de uma planilha CSV (colunas: cpf; email; nome; data_nascimento).
 * As contas ficam sem senha: a pessoa cria a senha pelo "Esqueci minha senha".
 */
export async function importarParticipantes(pool, textoCsv) {
  const { cabecalho, registros } = lerCsv(textoCsv)
  const col = (...nomes) => cabecalho.findIndex((c) => nomes.includes(c))
  const iCpf = col('cpf'), iEmail = col('email'), iNome = col('nome', 'nomecompleto'),
    iNasc = col('datanascimento', 'nascimento', 'datadenascimento')
  if (iCpf < 0 || iEmail < 0) return { importados: 0, ignorados: 0, erros: [{ linha: 1, motivo: 'A planilha precisa das colunas "cpf" e "email".' }] }

  let importados = 0, ignorados = 0
  const erros = []
  for (const [i, r] of registros.entries()) {
    const linha = i + 2
    const cpf = somenteDigitos(r[iCpf])
    const email = String(r[iEmail] ?? '').trim().toLowerCase()
    if (!cpfValido(cpf)) { erros.push({ linha, motivo: 'CPF inválido' }); continue }
    if (!EMAIL.test(email) || email.length > 200) { erros.push({ linha, motivo: 'E-mail inválido' }); continue }
    const nome = iNome >= 0 ? String(r[iNome] ?? '').trim().slice(0, 150) || null : null
    const nasc = iNasc >= 0 ? lerData(r[iNasc]) : null
    const { rowCount } = await pool.query(
      `insert into participantes (cpf, email, nome, data_nascimento, importado)
       values ($1, $2, $3, $4, true) on conflict do nothing`, [cpf, email, nome, nasc])
    if (rowCount) importados++
    else ignorados++
  }
  return { importados, ignorados, erros: erros.slice(0, 200) }
}
