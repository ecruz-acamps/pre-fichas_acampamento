// Listas de opções usadas no formulário e no painel.

export const ESTADOS_CIVIS = [
  { valor: 'solteiro', rotulo: 'Solteiro(a)' },
  { valor: 'casado', rotulo: 'Casado(a)' },
  { valor: 'uniao_estavel', rotulo: 'União estável' },
  { valor: 'divorciado', rotulo: 'Divorciado(a)' },
  { valor: 'viuvo', rotulo: 'Viúvo(a)' },
]

export const SEXOS = [
  { valor: 'masculino', rotulo: 'Masculino' },
  { valor: 'feminino', rotulo: 'Feminino' },
]

export const RELIGIOES = ['Católica', 'Evangélica', 'Espírita', 'Sem religião', 'Outra']

export const COMO_CONHECEU = [
  'Indicação de amigos ou familiares',
  'Paróquia / pastoral',
  'Instagram',
  'Facebook',
  'Já participei antes / ex-campista na família',
  'Outro',
]

// Lista de modalidades. É cadastrável (tela Modalidades do administrador): estes são os valores padrão e a lista é
// ATUALIZADA NO LUGAR por definirModalidades() quando o site/servidor carrega a lista cadastrada (por isso todos os
// `import { MODALIDADES }` continuam enxergando a lista atual).
//   regra: 'idade' (min a max, e opcionalmente só casado(a)), 'senior' (casado(a) 18+ ou idade mínima) ou 'casais' (cônjuge já campista).
export const MODALIDADES = [
  { valor: 'mirim', rotulo: 'Mirim', faixa: '7 a 13 anos', min: 7, max: 13, regra: 'idade', casado: false, ativa: true },
  { valor: 'fac', rotulo: 'FAC', faixa: '13 a 18 anos', min: 13, max: 18, regra: 'idade', casado: false, ativa: true },
  { valor: 'juvenil', rotulo: 'Juvenil', faixa: '18 a 30 anos', min: 18, max: 30, regra: 'idade', casado: false, ativa: true },
  { valor: 'senior', rotulo: 'Sênior', faixa: 'casado(a) ou 30 anos em diante', min: 30, max: 200, regra: 'senior', casado: false, ativa: true },
  { valor: 'casais', rotulo: 'Casais', faixa: 'casal casado(a), com o cônjuge já campista', min: 18, max: 200, regra: 'casais', casado: true, ativa: true },
]

/** Texto da faixa mostrado no formulário e no painel. */
export function faixaDe(m) {
  if (m.regra === 'senior') return `casado(a) ou ${m.min} anos em diante`
  if (m.regra === 'casais') return 'casal casado(a), com o cônjuge já campista'
  const idades = m.max >= 200 ? `${m.min} anos em diante` : `${m.min} a ${m.max} anos`
  const so = m.sexo === 'masculino' ? 'só homens, ' : m.sexo === 'feminino' ? 'só mulheres, ' : ''
  return `${so}${m.casado ? `casado(a), ${idades}` : idades}`
}

/** Troca o conteúdo de MODALIDADES (no lugar) pela lista cadastrada: [{ valor, rotulo, regra, min, max, casado, ativa }]. */
export function definirModalidades(lista) {
  if (!Array.isArray(lista) || !lista.length) return
  const novas = lista.map((m) => ({ valor: m.valor, rotulo: m.rotulo, regra: m.regra ?? 'idade', min: m.min ?? m.idade_min, max: m.max ?? m.idade_max, casado: m.casado === true, ativa: m.ativa !== false, sexo: m.sexo === 'masculino' || m.sexo === 'feminino' ? m.sexo : null }))
    .map((m) => ({ ...m, faixa: faixaDe(m) }))
  MODALIDADES.splice(0, MODALIDADES.length, ...novas)
}

/** Modalidades que aceitam novas inscrições e edições. */
export const modalidadesAtivas = () => MODALIDADES.filter((m) => m.ativa !== false)

export const STATUS = [
  { valor: 'aguardando', rotulo: 'Aguardando', cor: 'amarelo' },
  { valor: 'em_contato', rotulo: 'Em contato', cor: 'azul' },
  { valor: 'confirmado', rotulo: 'Confirmado', cor: 'verde' },
  { valor: 'desistiu', rotulo: 'Desistiu', cor: 'cinza' },
  { valor: 'participou', rotulo: 'Já participou', cor: 'roxo' },
]

export const STATUS_NA_FILA = ['aguardando', 'em_contato']

export const PAPEIS = [
  { valor: 'admin', rotulo: 'Administrador', descricao: 'acesso total, usuários, núcleos e configurações' },
  { valor: 'equipe', rotulo: 'Equipe', descricao: 'vê toda a fila e registra os acampamentos' },
  { valor: 'coordenador', rotulo: 'Coordenador de núcleo', descricao: 'vê só as cidades/bairros do seu núcleo' },
]

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export const rotuloDe = (lista, valor) =>
  lista.find((o) => o.valor === valor)?.rotulo ?? valor ?? ''
