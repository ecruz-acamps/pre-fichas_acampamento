import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const TAMANHO = 64

/** Gera o hash da senha (scrypt, nativo do Node — sem dependências externas). */
export async function gerarHash(senha) {
  const sal = randomBytes(16)
  const hash = await scryptAsync(senha.normalize('NFKC'), sal, TAMANHO, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, sal.toString('base64'), hash.toString('base64')].join('$')
}

export async function verificarSenha(senha, armazenado) {
  const [alg, N, r, p, salB64, hashB64] = String(armazenado).split('$')
  if (alg !== 'scrypt') return false
  const esperado = Buffer.from(hashB64, 'base64')
  const calculado = await scryptAsync(senha.normalize('NFKC'), Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  })
  return timingSafeEqual(esperado, calculado)
}

// Hash fictício para gastar o mesmo tempo quando o e-mail não existe.
let hashFicticio
export async function verificarSenhaFicticia(senha) {
  hashFicticio ??= await gerarHash('senha-ficticia-para-tempo-constante')
  await verificarSenha(senha, hashFicticio)
  return false
}

/** Senha temporária fácil de ditar por telefone (sem caracteres ambíguos). */
export function gerarSenhaTemporaria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  const digitos = '23456789'
  const bloco = (n, fonte) => Array.from({ length: n }, () => fonte[randomInt(fonte.length)]).join('')
  return `${bloco(4, letras)}-${bloco(4, digitos)}-${bloco(4, letras)}`
}

export function senhaForte(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (senha.length > 200) return 'A senha é longa demais.'
  return null
}
