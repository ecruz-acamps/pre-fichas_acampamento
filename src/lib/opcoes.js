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

export const MODALIDADES = [
  { valor: 'mirim', rotulo: 'Mirim', faixa: '7 a 13 anos', min: 7, max: 13 },
  { valor: 'fac', rotulo: 'FAC', faixa: '13 a 18 anos', min: 13, max: 18 },
  { valor: 'juvenil', rotulo: 'Juvenil', faixa: '18 a 30 anos', min: 18, max: 30 },
  { valor: 'senior', rotulo: 'Sênior', faixa: 'casado(a) ou 30 anos em diante', min: 30, max: 200 },
]

export const STATUS = [
  { valor: 'aguardando', rotulo: 'Aguardando', cor: 'amarelo' },
  { valor: 'em_contato', rotulo: 'Em contato', cor: 'azul' },
  { valor: 'confirmado', rotulo: 'Confirmado', cor: 'verde' },
  { valor: 'desistiu', rotulo: 'Desistiu', cor: 'cinza' },
  { valor: 'participou', rotulo: 'Já participou', cor: 'roxo' },
]

export const STATUS_NA_FILA = ['aguardando', 'em_contato']

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export const rotuloDe = (lista, valor) =>
  lista.find((o) => o.valor === valor)?.rotulo ?? valor ?? ''
