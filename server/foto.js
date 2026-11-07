// Foto da conta do participante (opcional). Só JPEG de até 300 KB; o navegador já reduz e converte, mas o servidor
// NÃO confia nisso: confere a estrutura do arquivo e remove os metadados (EXIF, GPS, miniaturas, comentários).
export const FOTO_MAX_BYTES = 300 * 1024
const LADO_MIN = 32, LADO_MAX = 2000
const SOF_ACEITOS = new Set([0xc0, 0xc1, 0xc2])                 // JPEG comum (baseline/progressivo)
const SOF_RECUSADOS = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) // sem perdas / aritmético

/**
 * Valida um JPEG e devolve uma cópia limpa (só os segmentos necessários para a imagem), ou null se for inválido.
 * Recusa: não-JPEG, arquivo truncado, bytes escondidos depois do fim, dimensões fora de 32–2000 px.
 */
export function limparJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.length > FOTO_MAX_BYTES) return null
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null
  const saida = [Buffer.from([0xff, 0xd8])]
  let i = 2, dims = null, varreduras = 0
  for (;;) {
    if (i + 1 >= buf.length || buf[i] !== 0xff) return null
    const m = buf[i + 1]
    if (m === 0xff) { i++; continue }                            // preenchimento
    if (m === 0xd9) { saida.push(Buffer.from([0xff, 0xd9])); i += 2; break }  // fim da imagem
    if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) return null    // marcador fora de lugar
    if (i + 4 > buf.length) return null
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) return null
    const seg = buf.subarray(i, i + 2 + len)
    i += 2 + len
    if (SOF_RECUSADOS.has(m)) return null
    if (SOF_ACEITOS.has(m)) {
      if (len < 8 || dims) return null
      dims = { h: seg.readUInt16BE(5), w: seg.readUInt16BE(7) }
    }
    const metadado = (m >= 0xe1 && m <= 0xef) || m === 0xfe       // APP1..APP15 (EXIF, GPS, ICC…) e comentários
    if (!metadado) saida.push(seg)
    if (m === 0xda) {                                            // dados da varredura: até o próximo marcador de verdade
      if (!dims) return null
      varreduras++
      let j = i
      while (j + 1 < buf.length && !(buf[j] === 0xff && buf[j + 1] !== 0x00 && !(buf[j + 1] >= 0xd0 && buf[j + 1] <= 0xd7))) j++
      if (j + 1 >= buf.length) return null
      saida.push(buf.subarray(i, j)); i = j
    }
  }
  if (i !== buf.length) return null                              // nada pode vir depois do fim da imagem
  if (!dims || !varreduras) return null
  if (dims.w < LADO_MIN || dims.h < LADO_MIN || dims.w > LADO_MAX || dims.h > LADO_MAX) return null
  return Buffer.concat(saida)
}

export async function salvarFoto(pool, participanteId, jpeg) {
  await pool.query(
    `insert into participantes_fotos (participante_id, dados) values ($1, $2)
     on conflict (participante_id) do update set dados = excluded.dados, atualizado_em = now()`, [participanteId, jpeg])
}
export const removerFoto = (pool, participanteId) => pool.query('delete from participantes_fotos where participante_id = $1', [participanteId])
export async function lerFoto(pool, participanteId) {
  const { rows: [f] } = await pool.query('select dados, atualizado_em from participantes_fotos where participante_id = $1', [participanteId])
  return f ?? null
}
/** Cabeçalhos para servir a foto: nunca em cache compartilhado, sem interpretação de tipo, sem scripts. */
export function cabecalhosFoto(reply, atualizadoEm) {
  reply.header('Cache-Control', 'private, no-cache')
  reply.header('Content-Security-Policy', "default-src 'none'")
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Content-Disposition', 'inline; filename="foto.jpg"')
  if (atualizadoEm) reply.header('Last-Modified', new Date(atualizadoEm).toUTCString())
  return reply.type('image/jpeg')
}
