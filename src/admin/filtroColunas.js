// Filtros por coluna da fila, no estilo do Excel (lógica pura: sem React, testável).
//   - "lista": marcar/desmarcar valores (com contagem e busca);  - "data": o mesmo, agrupado por ano/mês;
//   - "faixa": de/até (posição);  - "texto": contém (telefone).
// Como no Excel, a lista de valores de uma coluna mostra só o que sobrou dos filtros das OUTRAS colunas.
import { MODALIDADES, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, chaveLocal, melhorGrafia, somenteDigitos } from '../../shared/util.js'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const pt = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { sensitivity: 'base' })
const num = (a, b) => (a ?? Infinity) - (b ?? Infinity)
const mesDe = (l) => { const d = new Date(l.entrada_fila_em ?? l.created_at); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const ordemDe = (lista, v) => { const i = lista.findIndex((x) => x.valor === v); return i < 0 ? 999 : i }

/** Definição das colunas da tabela. `valor(l)` é o que se compara/ordena; `chave(l)` identifica o valor na lista. */
export function criarColunas({ posicoes }) {
  return [
    { id: 'pos', rotulo: 'Pos.', tipo: 'faixa', valor: (l) => posicoes.get(l.id), comparar: num, sentido: ['Do menor para o maior', 'Do maior para o menor'] },
    { id: 'desde', rotulo: 'Na fila desde', tipo: 'data', valor: (l) => new Date(l.entrada_fila_em ?? l.created_at).getTime(), chave: mesDe,
      rotuloChave: (k) => { const [a, m] = k.split('-'); return `${MESES[Number(m) - 1]} de ${a}` }, comparar: num, sentido: ['Do mais antigo para o mais novo', 'Do mais novo para o mais antigo'] },
    { id: 'nome', rotulo: 'Nome', tipo: 'lista', valor: (l) => l.nome_completo, chave: (l) => String(l.nome_completo ?? '').trim(), rotuloChave: (k) => k, comparar: pt, sentido: ['Classificar de A a Z', 'Classificar de Z a A'] },
    { id: 'idade', rotulo: 'Idade', tipo: 'lista', valor: (l) => calcularIdade(l.data_nascimento), chave: (l) => { const i = calcularIdade(l.data_nascimento); return i == null ? '' : String(i) },
      rotuloChave: (k) => (k === '' ? '(vazio)' : k), comparar: num, compararChave: (a, b) => num(a === '' ? null : Number(a), b === '' ? null : Number(b)), sentido: ['Do menor para o maior', 'Do maior para o menor'] },
    { id: 'modalidade', rotulo: 'Modalidade', tipo: 'lista', valor: (l) => ordemDe(MODALIDADES, l.modalidade), chave: (l) => l.modalidade,
      rotuloChave: (k) => rotuloDe(MODALIDADES, k), comparar: num, compararChave: (a, b) => ordemDe(MODALIDADES, a) - ordemDe(MODALIDADES, b), sentido: ['Na ordem das modalidades', 'Na ordem inversa'] },
    { id: 'cidade', rotulo: 'Cidade / bairro', tipo: 'lista', valor: (l) => l.cidade, chave: (l) => chaveLocal(l.cidade) ?? '', rotuloChave: null, comparar: pt, sentido: ['Cidade de A a Z', 'Cidade de Z a A'] },
    { id: 'telefone', rotulo: 'Telefone', tipo: 'texto', valor: (l) => somenteDigitos(l.telefone), comparar: pt, sentido: ['Classificar de A a Z', 'Classificar de Z a A'] },
    { id: 'status', rotulo: 'Status', tipo: 'lista', valor: (l) => ordemDe(STATUS, l.status), chave: (l) => l.status, rotuloChave: (k) => rotuloDe(STATUS, k),
      comparar: num, compararChave: (a, b) => ordemDe(STATUS, a) - ordemDe(STATUS, b), sentido: ['Na ordem dos status', 'Na ordem inversa'] },
  ]
}

/** A ficha passa neste filtro de coluna? (sem filtro = passa) */
export function passaFiltro(l, coluna, filtro) {
  if (!filtro) return true
  if (filtro.tipo === 'lista') return filtro.permitidos.has(coluna.chave(l))
  if (filtro.tipo === 'faixa') {
    const v = coluna.valor(l)
    if (v == null) return false
    return (filtro.min == null || v >= filtro.min) && (filtro.max == null || v <= filtro.max)
  }
  if (filtro.tipo === 'texto') return String(coluna.valor(l) ?? '').includes(somenteDigitos(filtro.texto) || filtro.texto.toLowerCase())
  return true
}

/** Aplica os filtros de todas as colunas (menos `exceto`, usada para montar a lista de valores daquela coluna). */
export function aplicarFiltros(linhas, colunas, filtros, exceto = null) {
  const ativos = colunas.filter((c) => c.id !== exceto && filtros[c.id])
  return ativos.length ? linhas.filter((l) => ativos.every((c) => passaFiltro(l, c, filtros[c.id]))) : linhas
}

/** Valores distintos de uma coluna de lista, com contagem: [{ chave, rotulo, total }], na ordem natural da coluna. */
export function valoresDaColuna(linhas, coluna) {
  const mapa = new Map()
  for (const l of linhas) {
    const chave = coluna.chave(l)
    let item = mapa.get(chave)
    if (!item) { item = { chave, rotulo: coluna.rotuloChave ? coluna.rotuloChave(chave) : '', total: 0 }; mapa.set(chave, item) }
    if (!coluna.rotuloChave) item.rotulo = melhorGrafia(item.rotulo, l.cidade)   // cidade: a grafia mais bonita entre as variações
    item.total++
  }
  const itens = [...mapa.values()].map((i) => ({ ...i, rotulo: i.rotulo || '(vazio)' }))
  if (coluna.tipo === 'data') return itens.sort((a, b) => a.chave.localeCompare(b.chave))
  if (coluna.compararChave) return itens.sort((a, b) => coluna.compararChave(a.chave, b.chave))
  return itens.sort((a, b) => pt(a.rotulo, b.rotulo))
}

/** Ordena (estável) pela coluna; `dir` 1 = crescente, -1 = decrescente. Ficha sem valor fica sempre no fim. */
export function ordenarPorColuna(linhas, coluna, dir) {
  return linhas.map((l, i) => ({ l, i, v: coluna.valor(l) }))
    .sort((a, b) => {
      const va = a.v == null || a.v === '', vb = b.v == null || b.v === ''
      if (va || vb) return va === vb ? a.i - b.i : va ? 1 : -1
      return dir * coluna.comparar(a.v, b.v) || a.i - b.i
    }).map((x) => x.l)
}

/** Um filtro está de fato restringindo algo? */
export const filtroAtivo = (f) => !!f && (f.tipo === 'lista' ? true : f.tipo === 'faixa' ? f.min != null || f.max != null : !!f.texto)
