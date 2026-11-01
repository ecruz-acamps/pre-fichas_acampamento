import { ESTADOS_CIVIS, MODALIDADES, SEXOS, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, formatarData, formatarDataHora, simNao } from '../../shared/util.js'

const COLUNAS = [
  ['Posição', (l, pos) => pos.get(l.id) ?? ''],
  ['Na fila desde', (l) => formatarDataHora(l.entrada_fila_em ?? l.created_at)],
  ['Inscrição original', (l) => formatarDataHora(l.created_at)],
  ['Recusas seguidas', (l) => l.recusas_seguidas ?? 0],
  ['Preferência (cônjuge)', (l) => {
    const p = (l.preferencias ?? []).find((x) => x.situacao === 'ativa')
    return p ? `Ativa até o ${p.valida_ate}º ${rotuloDe(MODALIDADES, p.modalidade)} (cônjuge ${p.conjuge_nome} fez o ${p.acampamento_numero}º)` : ''
  }],
  ['Cônjuge vinculado', (l) => l.conjuge_vinculado_nome ?? ''],
  ['Cônjuge (declarado)', (l) => [l.conjuge_nome, l.conjuge_telefone,
    l.conjuge_fez_acampamento ? `já fez${l.conjuge_acampamento_numero ? ` o ${l.conjuge_acampamento_numero}º` : ''}` : ''].filter(Boolean).join(' · ')],
  ['Status', (l) => rotuloDe(STATUS, l.status)],
  ['Modalidade', (l) => rotuloDe(MODALIDADES, l.modalidade)],
  ['Nome', (l) => l.nome_completo],
  ['Nascimento', (l) => formatarData(l.data_nascimento)],
  ['Idade', (l) => calcularIdade(l.data_nascimento)],
  ['Sexo', (l) => rotuloDe(SEXOS, l.sexo)],
  ['Estado civil', (l) => rotuloDe(ESTADOS_CIVIS, l.estado_civil)],
  ['Profissão', (l) => l.profissao],
  ['Telefone', (l) => l.telefone],
  ['Responsável', (l) => l.responsavel_nome],
  ['Tel. responsável', (l) => l.responsavel_telefone],
  ['E-mail', (l) => l.email],
  ['Instagram', (l) => l.instagram],
  ['Facebook', (l) => l.facebook],
  ['Religião', (l) => l.religiao],
  ['Batizado', (l) => simNao(l.batizado)],
  ['1ª eucaristia', (l) => simNao(l.primeira_eucaristia)],
  ['Crismado', (l) => simNao(l.crismado)],
  ['Paróquia', (l) => l.paroquia],
  ['Pastoral', (l) => (l.participa_pastoral ? l.pastoral_qual || 'Sim' : 'Não')],
  ['CEP', (l) => l.cep],
  ['Logradouro', (l) => l.logradouro],
  ['Número', (l) => l.numero],
  ['Complemento', (l) => l.complemento],
  ['Bairro', (l) => l.bairro],
  ['Cidade', (l) => l.cidade],
  ['UF', (l) => l.uf],
  ['Núcleo', (l, pos, nomeNucleo) => (l.nucleos ?? []).map(nomeNucleo).filter(Boolean).join(', ')],
  ['Acampamentos realizados', (l) => (l.participacoes ?? [])
    .map((p) => `${p.numero}º ${rotuloDe(MODALIDADES, p.modalidade)}${p.tribo ? ` (${p.tribo})` : ''}`).join(', ')],
  ['Como conheceu', (l) => l.como_conheceu],
  ['Motivo', (l) => l.motivo],
  ['Vício', (l) => (l.possui_vicio ? l.vicio_qual || 'Sim' : 'Não')],
  ['Restrições médicas', (l) => l.restricoes_medicas],
  ['Retiros anteriores', (l) => l.retiros_anteriores],
  ['Observações internas', (l) => l.observacoes_internas],
]

function celula(v) {
  let s = v === null || v === undefined ? '' : String(v)
  // evita que o Excel interprete o conteúdo como fórmula
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function baixarCsv(nomeArquivo, cabecalhos, linhas) {
  const conteudo = [cabecalhos, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')
  const blob = new Blob(['\uFEFF' + conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(url)
}

export function exportarCsv(linhas, posicoes, nomeNucleo = () => '') {
  baixarCsv(`fila-espera-${new Date().toISOString().slice(0, 10)}.csv`,
    COLUNAS.map(([n]) => n),
    linhas.map((l) => COLUNAS.map(([, fn]) => fn(l, posicoes, nomeNucleo))))
}
