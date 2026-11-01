// Verificação em duas etapas (TOTP, RFC 6238) — compatível com Google Authenticator,
// Microsoft Authenticator, Authy etc. Sem dependências externas.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PASSO = 30

export function gerarSegredo() {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  return bits.match(/.{1,5}/g).map((g) => ALFABETO[Number.parseInt(g.padEnd(5, '0'), 2)]).join('')
}

function decodificar(segredo) {
  const bits = segredo.replace(/[\s=]/g, '').toUpperCase().split('')
    .map((c) => ALFABETO.indexOf(c).toString(2).padStart(5, '0')).join('')
  return Buffer.from(bits.match(/.{8}/g).map((b) => Number.parseInt(b, 2)))
}

function codigoNoPasso(segredo, passo) {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(passo))
  const h = createHmac('sha1', decodificar(segredo)).update(contador).digest()
  const o = h[h.length - 1] & 0xf
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

export const passoAtual = (agora = Date.now()) => Math.floor(agora / 1000 / PASSO)

/**
 * Confere o código (tolerância de ±30 s). Retorna o passo usado ou null.
 * `ultimoPasso` impede reutilizar o mesmo código.
 */
export function conferirCodigo(segredo, codigo, ultimoPasso = null, agora = Date.now()) {
  const c = String(codigo ?? '').replace(/\D/g, '')
  if (!segredo || c.length !== 6) return null
  const atual = passoAtual(agora)
  for (const passo of [atual - 1, atual, atual + 1]) {
    if (ultimoPasso !== null && passo <= ultimoPasso) continue
    if (timingSafeEqual(Buffer.from(codigoNoPasso(segredo, passo)), Buffer.from(c))) return passo
  }
  return null
}

export function uriAutenticador(segredo, conta, emissor) {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`)
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=${PASSO}`
}

export { codigoNoPasso as _codigoNoPasso }
