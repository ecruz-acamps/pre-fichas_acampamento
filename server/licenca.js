// Ativação do sistema por chave (formato XXX-0000).
//
// As chaves NÃO ficam no código: guardamos apenas o hash scrypt (com sal) de cada
// uma. Para conferir, calculamos o hash do que foi digitado e comparamos.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const PARAMS = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }

/**
 * Hashes das chaves válidas (id é só um identificador interno, não revela a chave).
 * Nova chave: `node server/cli.js licenca gerar-hash XXX-0000` e cole a linha aqui.
 */
export const CHAVES_LICENCA = [
  { id: 'k1', sal: 'nL6eDC6dn+fripMr89wPOw==', hash: 'TdAVKCeDA/82NjrJjZnMD0jTIGBzapbcn2X+QFKMYxg=' },
  { id: 'k2', sal: 'IhgeNLHKjakzlBq407MVIw==', hash: '+PcLU/rvy2qkDbQkW9IdcnscXsbQF2KOaCtX9cXTT6M=' },
]

/** "abc 1234", "ABC-1234", "abc1234" → "ABC1234" (ou null se não estiver no formato). */
export function normalizarChave(chave) {
  const c = String(chave ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z]{3}\d{4}$/.test(c) ? c : null
}

/** Gera o registro {sal, hash} de uma chave (usado para cadastrar novas chaves e nos testes). */
export async function gerarHashChave(chave, id = 'nova') {
  const c = normalizarChave(chave)
  if (!c) throw new Error('Formato de chave inválido (use XXX-0000).')
  const sal = randomBytes(16)
  const hash = await scryptAsync(c, sal, 32, PARAMS)
  return { id, sal: sal.toString('base64'), hash: hash.toString('base64') }
}

/** Retorna o id da chave correspondente, ou null. */
export async function conferirChave(chave, chaves = CHAVES_LICENCA) {
  const c = normalizarChave(chave)
  if (!c) return null
  let encontrada = null
  // Confere todas (mesmo depois de achar) para o tempo não denunciar qual chave é.
  for (const k of chaves) {
    const esperado = Buffer.from(k.hash, 'base64')
    const calculado = await scryptAsync(c, Buffer.from(k.sal, 'base64'), esperado.length, PARAMS)
    if (timingSafeEqual(esperado, calculado) && !encontrada) encontrada = k.id
  }
  return encontrada
}

const mascarar = (chave) => {
  const c = String(chave ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return c ? `${c.slice(0, 1)}**-****` : '(vazia)'
}

// Situação em memória (muda só uma vez por instalação)
let ativada = null
let conferidaEm = 0

export async function licencaAtivada(pool) {
  if (ativada === true) return true
  if (ativada === false && Date.now() - conferidaEm < 10_000) return false
  const { rows: [r] } = await pool.query('select ativada_em is not null as ativa from licenca where id')
  ativada = Boolean(r?.ativa)
  conferidaEm = Date.now()
  return ativada
}

export function esquecerLicenca() {
  ativada = null
}

/**
 * Tenta ativar com a chave informada. Retorna { ok: true } ou { ok: false, mensagem }.
 * `origem`: 'painel' | 'cli'.
 */
export async function ativarLicenca(pool, { chave, usuarioId = null, origem, log, chaves = CHAVES_LICENCA }) {
  if (!normalizarChave(chave)) return { ok: false, mensagem: 'A chave deve ter o formato XXX-0000 (3 letras e 4 números).' }
  const id = await conferirChave(chave, chaves)
  if (!id) {
    log?.warn?.({ chave: mascarar(chave), origem }, 'Tentativa de ativação com chave inválida')
    return { ok: false, mensagem: 'Chave de ativação inválida. Confira e tente novamente.' }
  }
  await pool.query(
    `update licenca set ativada_em = coalesce(ativada_em, now()), ativada_por = coalesce(ativada_por, $1),
            chave_id = coalesce(chave_id, $2), origem = coalesce(origem, $3)
      where id`, [usuarioId, id, origem])
  ativada = true
  log?.info?.({ chave_id: id, origem }, 'Sistema ativado')
  return { ok: true }
}

export async function situacaoLicenca(pool) {
  const { rows: [r] } = await pool.query(
    `select l.ativada_em, l.origem, u.nome as ativada_por
       from licenca l left join usuarios u on u.id = l.ativada_por where l.id`)
  return { ativada: Boolean(r?.ativada_em), ativada_em: r?.ativada_em ?? null, ativada_por: r?.ativada_por ?? null, origem: r?.origem ?? null }
}
