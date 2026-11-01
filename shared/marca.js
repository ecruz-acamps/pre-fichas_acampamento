// Identidade (marca) do acampamento: valores padrão e validação.
// Cada instalação ajusta pelo painel (Configurações) ou com um arquivo de
// marcas/ (node server/cli.js marca aplicar marcas/arquivo.json).

export const TRIBOS_PADRAO = [
  { nome: 'Azul', cor: '#1e5bd6' },
  { nome: 'Preto', cor: '#222222' },
  { nome: 'Amarelo', cor: '#f2c200' },
  { nome: 'Verde', cor: '#2e8b3e' },
  { nome: 'Roxo', cor: '#7b3fa8' },
  { nome: 'Laranja', cor: '#ef7d1a' },
  { nome: 'Marrom', cor: '#7b4a1e' },
]

export const MARCA_PADRAO = {
  nome: 'Acampamento',
  nomeCurto: 'Acampamento',
  corPrimaria: '#7b5612',
  whatsapp: '',
  email: '',
  instagram: '',
  site: '',
  tituloFormulario: 'Pré-ficha de inscrição',
  textoFormulario:
    'Preencha seus dados para entrar na **lista de espera** do acampamento. A ordem da fila segue a data e hora de envio da pré-ficha.',
  mensagemSucesso:
    'Você entrou na **lista de espera**. A ordem é definida pela data e hora do envio. Quando chegar a sua vez, alguém da equipe entrará em contato pelo telefone informado.',
  termos: [
    'Autorizo o uso dos meus dados pessoais exclusivamente para fins do acampamento, sem exposição pública.',
    'Entendo que durante o acampamento são realizadas atividades físicas moderadas. Por questões de segurança, não é permitida a participação de gestantes ou pessoas com restrições médicas graves.',
    'Entendo que estou entrando em uma **lista de espera** e que o preenchimento dessa pré-ficha não significa que estarei automaticamente participando do próximo acampamento. Compreendo que quando chegar a minha vez de participar, alguém irá entrar em contato comigo por telefone.',
  ],
  tribos: TRIBOS_PADRAO,
}

const COR = /^#[0-9a-fA-F]{6}$/

const LIMITES = {
  nome: 120, nomeCurto: 60, whatsapp: 20, email: 200, instagram: 100, site: 200,
  tituloFormulario: 120, textoFormulario: 1500, mensagemSucesso: 1500,
}

/** Valida e normaliza a marca. Retorna { marca, erros }. */
export function validarMarca(entrada) {
  const e = {}
  const m = { ...MARCA_PADRAO }
  const bruto = entrada && typeof entrada === 'object' ? entrada : {}

  for (const [campo, max] of Object.entries(LIMITES)) {
    if (bruto[campo] === undefined) continue
    const v = typeof bruto[campo] === 'string' ? bruto[campo].trim() : ''
    if (v.length > max) e[campo] = `Máximo de ${max} caracteres.`
    m[campo] = v
  }
  if (!m.nome) e.nome = 'Informe o nome do acampamento.'
  if (!m.nomeCurto) m.nomeCurto = m.nome.slice(0, 60)
  m.whatsapp = m.whatsapp.replace(/\D/g, '')
  if (m.whatsapp && (m.whatsapp.length < 10 || m.whatsapp.length > 13)) e.whatsapp = 'WhatsApp inválido (use DDD + número).'
  if (m.whatsapp && m.whatsapp.length <= 11) m.whatsapp = `55${m.whatsapp}`
  if (m.site && !/^https?:\/\//i.test(m.site)) m.site = `https://${m.site}`
  m.instagram = m.instagram.replace(/^@/, '')

  if (bruto.corPrimaria !== undefined) {
    if (!COR.test(bruto.corPrimaria)) e.corPrimaria = 'Cor inválida (formato #RRGGBB).'
    else m.corPrimaria = bruto.corPrimaria.toLowerCase()
  }

  if (bruto.termos !== undefined) {
    const termos = Array.isArray(bruto.termos)
      ? bruto.termos.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
      : []
    if (termos.length > 10) e.termos = 'No máximo 10 declarações.'
    if (termos.some((t) => t.length > 1000)) e.termos = 'Cada declaração pode ter até 1000 caracteres.'
    m.termos = termos
  }

  if (bruto.tribos !== undefined) {
    const tribos = Array.isArray(bruto.tribos)
      ? bruto.tribos
        .map((t) => ({ nome: typeof t?.nome === 'string' ? t.nome.trim() : '', cor: t?.cor }))
        .filter((t) => t.nome)
      : []
    if (tribos.length > 20) e.tribos = 'No máximo 20 tribos.'
    if (tribos.some((t) => t.nome.length > 40)) e.tribos = 'Nome de tribo com até 40 caracteres.'
    if (tribos.some((t) => !COR.test(t.cor))) e.tribos = 'Cada tribo precisa de uma cor no formato #RRGGBB.'
    if (new Set(tribos.map((t) => t.nome.toLowerCase())).size !== tribos.length) e.tribos = 'Há tribos com o mesmo nome.'
    m.tribos = tribos.map((t) => ({ nome: t.nome, cor: String(t.cor).toLowerCase() }))
  }

  return { marca: m, erros: e }
}

/** Ajusta a luminosidade de uma cor #RRGGBB (fator < 0 escurece, > 0 clareia). */
export function ajustarCor(hex, fator) {
  const n = Number.parseInt(hex.slice(1), 16)
  const canais = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(fator < 0 ? c * (1 + fator) : c + (255 - c) * fator))
  return `#${canais.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Cor de texto legível (preto ou branco) sobre a cor informada. */
export function corTextoSobre(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminancia > 0.4 ? '#1d1a17' : '#ffffff'
}
