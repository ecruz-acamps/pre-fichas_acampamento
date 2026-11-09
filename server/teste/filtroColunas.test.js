// Lógica dos filtros por coluna da fila (estilo Excel). Sem banco de dados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarFiltros, criarColunas, filtroAtivo, ordenarPorColuna, passaFiltro, valoresDaColuna } from '../../src/admin/filtroColunas.js'

const ficha = (id, nome, extra = {}) => ({ id, nome_completo: nome, data_nascimento: '1990-01-01', modalidade: 'senior', status: 'aguardando', cidade: 'Palhoça', uf: 'SC', telefone: '(48) 99999-0000',
  created_at: '2025-03-15T15:00:00Z', entrada_fila_em: '2025-03-15T15:00:00Z', ...extra })
const linhas = [
  ficha(1, 'Ana Souza', { data_nascimento: '2010-05-05', modalidade: 'fac', cidade: 'Florianópolis', telefone: '(48) 91111-2222', entrada_fila_em: '2024-01-10T15:00:00Z' }),
  ficha(2, 'bruno Lima', { data_nascimento: '1980-05-05', cidade: 'florianopolis', status: 'em_contato', entrada_fila_em: '2025-06-20T15:00:00Z' }),
  ficha(3, 'Carla Dias', { data_nascimento: '1995-05-05', modalidade: 'juvenil', cidade: 'São José', entrada_fila_em: '2025-03-01T15:00:00Z' }),
  ficha(4, 'Daniel Pinto', { status: 'participou', cidade: 'Palhoça', telefone: '(48) 98888-7777' }),
  ficha(5, 'Eva Rocha', { cidade: '', entrada_fila_em: '2024-12-31T15:00:00Z' }),
]
const posicoes = new Map([[1, 1], [2, 1], [3, 1], [5, 2]])          // a 4 (participou) não está na fila: sem posição
const colunas = criarColunas({ posicoes })
const col = (id) => colunas.find((c) => c.id === id)

test('lista de valores: contagem, ordem natural da coluna e grafias de cidade agrupadas', () => {
  assert.deepEqual(valoresDaColuna(linhas, col('status')).map((v) => [v.chave, v.total]), [['aguardando', 3], ['em_contato', 1], ['participou', 1]], 'na ordem dos status')
  assert.deepEqual(valoresDaColuna(linhas, col('modalidade')).map((v) => v.rotulo), ['FAC', 'Juvenil', 'Sênior'], 'na ordem das modalidades')
  const cidades = valoresDaColuna(linhas, col('cidade'))
  assert.deepEqual(cidades.map((v) => [v.rotulo, v.total]), [['(vazio)', 1], ['Florianópolis', 2], ['Palhoça', 1], ['São José', 1]], '"Florianopolis" e "Florianópolis" viram um valor só, com a melhor grafia')
  assert.deepEqual(valoresDaColuna(linhas, col('idade')).map((v) => Number(v.chave)).every((n, i, a) => i === 0 || a[i - 1] <= n), true, 'idades em ordem numérica')
  const datas = valoresDaColuna(linhas, col('desde'))
  assert.deepEqual(datas.map((v) => v.chave), ['2024-01', '2024-12', '2025-03', '2025-06'], 'por mês, do mais antigo ao mais novo')
  assert.match(datas[0].rotulo, /janeiro de 2024/)
})

test('filtros de lista, faixa e texto; "limpar" (null) não restringe; vários filtros se somam', () => {
  const so = (id, ...chaves) => ({ tipo: 'lista', permitidos: new Set(chaves) })
  assert.deepEqual(aplicarFiltros(linhas, colunas, { status: so('status', 'aguardando') }).map((l) => l.id), [1, 3, 5])
  assert.deepEqual(aplicarFiltros(linhas, colunas, { status: so('status', 'aguardando'), modalidade: so('modalidade', 'fac', 'juvenil') }).map((l) => l.id), [1, 3])
  assert.deepEqual(aplicarFiltros(linhas, colunas, { pos: { tipo: 'faixa', min: 2, max: null } }).map((l) => l.id), [5], 'quem não tem posição não passa por uma faixa')
  assert.deepEqual(aplicarFiltros(linhas, colunas, { pos: { tipo: 'faixa', min: null, max: 1 } }).map((l) => l.id), [1, 2, 3])
  assert.deepEqual(aplicarFiltros(linhas, colunas, { telefone: { tipo: 'texto', texto: '9888' } }).map((l) => l.id), [4], 'telefone: contém dígitos, ignora máscara')
  assert.deepEqual(aplicarFiltros(linhas, colunas, { telefone: { tipo: 'texto', texto: '(48) 91111' } }).map((l) => l.id), [1])
  assert.deepEqual(aplicarFiltros(linhas, colunas, { desde: so('desde', '2025-03') }).map((l) => l.id), [3, 4])
  assert.deepEqual(aplicarFiltros(linhas, colunas, {}).length, 5)
  assert.equal(passaFiltro(linhas[0], col('nome'), null), true)
  assert.deepEqual([filtroAtivo(null), filtroAtivo({ tipo: 'faixa', min: null, max: null }), filtroAtivo({ tipo: 'faixa', min: 1, max: null }), filtroAtivo({ tipo: 'texto', texto: '' }), filtroAtivo({ tipo: 'lista', permitidos: new Set() })], [false, false, true, false, true])
})

test('como no Excel: a lista de uma coluna mostra só o que sobrou dos filtros das OUTRAS colunas', () => {
  const filtros = { status: { tipo: 'lista', permitidos: new Set(['aguardando']) }, modalidade: { tipo: 'lista', permitidos: new Set(['fac']) } }
  // lista de status: ignora o filtro de status, respeita o de modalidade (só a ficha 1 é FAC)
  assert.deepEqual(valoresDaColuna(aplicarFiltros(linhas, colunas, filtros, 'status'), col('status')).map((v) => [v.chave, v.total]), [['aguardando', 1]])
  // lista de modalidade: ignora o próprio filtro, respeita o de status (aguardando: fichas 1, 3, 5)
  assert.deepEqual(valoresDaColuna(aplicarFiltros(linhas, colunas, filtros, 'modalidade'), col('modalidade')).map((v) => [v.chave, v.total]), [['fac', 1], ['juvenil', 1], ['senior', 1]])
})

test('classificar por coluna: crescente e decrescente, estável, e o que não tem valor fica no fim nos dois sentidos', () => {
  const ids = (cs, dir) => ordenarPorColuna(linhas, cs, dir).map((l) => l.id)
  assert.deepEqual(ids(col('nome'), 1), [1, 2, 3, 4, 5], 'A→Z sem diferenciar maiúscula/acento ("bruno" entre Ana e Carla)')
  assert.deepEqual(ids(col('nome'), -1), [5, 4, 3, 2, 1])
  assert.deepEqual(ids(col('pos'), 1), [1, 2, 3, 5, 4], 'sem posição vai para o fim')
  assert.deepEqual(ids(col('pos'), -1), [5, 1, 2, 3, 4], 'e continua no fim ao inverter; empates mantêm a ordem original')
  assert.deepEqual(ids(col('desde'), 1), [1, 5, 3, 4, 2])
  assert.deepEqual(ids(col('desde'), -1), [2, 4, 3, 5, 1])
  assert.deepEqual(ids(col('idade'), 1), [1, 3, 4, 5, 2], 'mais novo primeiro')
  assert.deepEqual(ids(col('status'), 1), [1, 3, 5, 2, 4], 'na ordem dos status (aguardando, em contato, participou)')
  assert.deepEqual(ids(col('modalidade'), 1), [1, 3, 2, 4, 5])
})
