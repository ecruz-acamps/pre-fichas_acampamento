// Leitor mínimo de planilhas Excel (.xlsx) SEM biblioteca de terceiros: só lê a primeira aba e devolve as linhas como texto.
// Um .xlsx é um ZIP com XML dentro. Como o arquivo vem do usuário, há limites contra arquivos malformados ou "bomba de zip".
import { inflateRawSync } from 'node:zlib'

const MAX_ENTRADAS = 2000
const MAX_DESCOMPACTADO = 150 * 1024 * 1024     // por arquivo dentro do zip
const MAX_LINHAS = 60000
const MAX_COLUNAS = 200

export const ehXlsx = (buf) => Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04

// ------------------------------------------------------------------ ZIP
function indiceZip(buf) {
  const limite = Math.max(0, buf.length - 65557)
  let fim = -1
  for (let i = buf.length - 22; i >= limite; i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break }
  if (fim < 0) throw new Error('Arquivo Excel inválido (não é um .xlsx).')
  const total = buf.readUInt16LE(fim + 10)
  let pos = buf.readUInt32LE(fim + 16)
  if (total > MAX_ENTRADAS) throw new Error('Arquivo Excel com itens demais.')
  const entradas = new Map()
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Arquivo Excel corrompido.')
    const metodo = buf.readUInt16LE(pos + 10), tamDesc = buf.readUInt32LE(pos + 24), tamNome = buf.readUInt16LE(pos + 28)
    const tamExtra = buf.readUInt16LE(pos + 30), tamCom = buf.readUInt16LE(pos + 32), local = buf.readUInt32LE(pos + 42)
    entradas.set(buf.toString('utf8', pos + 46, pos + 46 + tamNome), { metodo, tamDesc, local })
    pos += 46 + tamNome + tamExtra + tamCom
  }
  return entradas
}
function extrair(buf, entradas, nome) {
  const e = entradas.get(nome)
  if (!e) return null
  if (e.tamDesc > MAX_DESCOMPACTADO) throw new Error('Arquivo Excel grande demais depois de descompactado.')
  if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('Arquivo Excel corrompido.')
  const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
  const bruto = buf.subarray(ini, buf.length)
  if (e.metodo === 0) return bruto.subarray(0, e.tamDesc).toString('utf8')
  if (e.metodo !== 8) throw new Error('Arquivo Excel com compactação não suportada.')
  return inflateRawSync(bruto, { maxOutputLength: MAX_DESCOMPACTADO }).toString('utf8')
}

// ------------------------------------------------------------------ XML
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodificarXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : '' }
  return ENTIDADES[e.toLowerCase()] ?? ''
})
const textosDe = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificarXml(m[1])).join('')
const colunaDe = (ref) => { let n = 0; for (const c of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + c.charCodeAt(0) - 64; return n - 1 }

/** Número serial de data do Excel → dd/mm/aaaa. */
export function serialParaData(n) {
  const ms = Math.round(n) * 86400000 + Date.UTC(1899, 11, 30)
  const d = new Date(ms)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}
const COLUNAS_DE_DATA = ['data de nascimento', 'data da pre-ficha', 'data de casamento']
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Lê a primeira aba. Devolve as linhas (listas de texto), a primeira é o cabeçalho. */
export function lerXlsx(buf) {
  if (!ehXlsx(buf)) throw new Error('Arquivo Excel inválido (não é um .xlsx).')
  const zip = indiceZip(buf)
  const livro = extrair(buf, zip, 'xl/workbook.xml')
  if (!livro) throw new Error('Arquivo Excel sem planilhas.')
  // aba: a primeira listada no livro (via relacionamentos) ou, se não der, sheet1
  let alvo = 'xl/worksheets/sheet1.xml'
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(livro)?.[1]
  const rels = extrair(buf, zip, 'xl/_rels/workbook.xml.rels')
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (new RegExp(`\\bId="${rid}"`).test(m[1])) { const t = /\bTarget="([^"]+)"/.exec(m[1])?.[1]; if (t) alvo = t.startsWith('/') ? t.slice(1) : `xl/${t}`; break }
    }
  }
  const planilha = extrair(buf, zip, alvo)
  if (!planilha) throw new Error('Não encontrei a aba da planilha no arquivo.')
  const comuns = extrair(buf, zip, 'xl/sharedStrings.xml')
  const strings = comuns ? [...comuns.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textosDe(m[1])) : []

  const linhas = []
  for (const r of planilha.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (linhas.length >= MAX_LINHAS) throw new Error(`A planilha tem linhas demais (máximo ${MAX_LINHAS}).`)
    const celulas = []
    let proxima = 0
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], corpo = c[2] ?? ''
      const col = /\br="([A-Z]+\d+)"/.exec(attrs) ? colunaDe(/\br="([A-Z]+\d+)"/.exec(attrs)[1]) : proxima
      if (col < 0 || col >= MAX_COLUNAS) continue
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      let valor = ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1]
      if (tipo === 's') valor = strings[Number(v)] ?? ''
      else if (tipo === 'inlineStr') valor = textosDe(corpo)
      else if (v !== undefined) valor = decodificarXml(v)
      if (tipo === 'n' && /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(valor)) valor = BigInt(Math.round(Number(valor))).toString()   // 2.595029959E9
      while (celulas.length < col) celulas.push('')
      celulas[col] = String(valor).trim()
      proxima = col + 1
    }
    linhas.push(celulas)
  }
  if (!linhas.length) throw new Error('A planilha está vazia.')
  // datas que o Excel guardou como número serial (nas colunas de data conhecidas)
  const cab = linhas[0].map(semAcento)
  const colsData = cab.map((h, i) => (COLUNAS_DE_DATA.includes(h) ? i : -1)).filter((i) => i >= 0)
  for (const l of linhas.slice(1)) {
    for (const i of colsData) if (/^\d{4,6}(\.\d+)?$/.test(l[i] ?? '') && Number(l[i]) > 1 && Number(l[i]) < 80000) l[i] = serialParaData(Number(l[i]))
  }
  return linhas
}
