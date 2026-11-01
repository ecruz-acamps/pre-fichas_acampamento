import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { chaveLocal, somenteDigitos } from '../../shared/util.js'

export const SITUACOES_PREFERENCIA = {
  ativa: 'Ativa', usada: 'Usada', expirada: 'Expirada', revogada: 'Revogada',
}

export const preferenciaAtiva = (f) => f.preferencias?.find((p) => p.situacao === 'ativa') ?? null

/** Declarou no formulário que o cônjuge fez o acampamento, mas a equipe ainda não validou. */
export const declarouSemValidar = (f) => f.conjuge_fez_acampamento === true && !(f.preferencias?.length)

export function edicoesCobertas(p) {
  const lista = []
  for (let n = p.valida_de; n <= p.valida_ate; n++) lista.push(`${n}º`)
  const texto = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} e ${lista.at(-1)}` : lista[0]
  return `${texto} ${rotuloDe(MODALIDADES, p.modalidade)}`
}

export function SeloPreferencia({ ficha }) {
  const p = preferenciaAtiva(ficha)
  if (p) {
    return (
      <span className="selo preferencia" title={`Cônjuge (${p.conjuge_nome}) fez o ${p.acampamento_numero}º — preferência no ${edicoesCobertas(p)}`}>
        ★ preferência até o {p.valida_ate}º
      </span>
    )
  }
  if (declarouSemValidar(ficha)) {
    return <span className="selo a-validar" title="Declarou no formulário que o cônjuge já fez o acampamento">cônjuge fez? validar</span>
  }
  return null
}

/** Possíveis cônjuges entre as fichas carregadas (pelo telefone ou nome declarados). */
export function sugerirConjuges(ficha, todas) {
  const telDeclarado = somenteDigitos(ficha.conjuge_telefone)
  const nomeDeclarado = chaveLocal(ficha.conjuge_nome)
  const meuTel = somenteDigitos(ficha.telefone)
  const meuNome = chaveLocal(ficha.nome_completo)
  return todas.filter((o) => o.id !== ficha.id && (
    (telDeclarado.length >= 10 && somenteDigitos(o.telefone) === telDeclarado) ||
    (nomeDeclarado && chaveLocal(o.nome_completo) === nomeDeclarado) ||
    (meuTel.length >= 10 && somenteDigitos(o.conjuge_telefone) === meuTel) ||
    (meuNome && chaveLocal(o.conjuge_nome) === meuNome)
  ))
}
