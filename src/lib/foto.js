// Prepara a foto no próprio aparelho: corrige a rotação, recorta no formato retrato (3:4), reduz e converte para JPG.
// Assim a foto sai leve (poucas dezenas de KB) e sem os dados da câmera (local, modelo do aparelho).
// O servidor confere de novo e também remove os metadados.
export const FOTO_MAX_LADO = 640
export const FOTO_MAX_BYTES = 200 * 1024

const paraBlob = (canvas, qualidade) => new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('falha'))), 'image/jpeg', qualidade))

export async function prepararFoto(arquivo) {
  if (!arquivo || !String(arquivo.type).startsWith('image/')) throw new Error('Escolha um arquivo de imagem (foto).')
  if (arquivo.size > 25 * 1024 * 1024) throw new Error('Essa imagem é grande demais. Escolha uma foto de até 25 MB.')
  let imagem
  try { imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' }) } catch { throw new Error('Não foi possível ler essa imagem. Tente outra foto (JPG ou PNG).') }
  try {
    // recorte central 3:4 (retrato)
    let lw = imagem.width, lh = Math.round(lw * 4 / 3)
    if (lh > imagem.height) { lh = imagem.height; lw = Math.round(lh * 3 / 4) }
    const sx = Math.round((imagem.width - lw) / 2), sy = Math.round((imagem.height - lh) / 2)
    const escala = Math.min(1, FOTO_MAX_LADO / lh)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(32, Math.round(lw * escala)); canvas.height = Math.max(32, Math.round(lh * escala))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)   // PNG transparente vira fundo branco
    ctx.drawImage(imagem, sx, sy, lw, lh, 0, 0, canvas.width, canvas.height)
    let blob
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) { blob = await paraBlob(canvas, q); if (blob.size <= FOTO_MAX_BYTES) break }
    if (blob.size > FOTO_MAX_BYTES) throw new Error('Não consegui reduzir essa foto. Tente outra.')
    return blob
  } finally { imagem.close?.() }
}
