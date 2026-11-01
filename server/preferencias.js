// Regra da preferência por cônjuge.
//   Quem fez o acampamento N → o cônjuge tem preferência nas edições N+1 … N+edicoes
//   da mesma modalidade (edicoes = marca.edicoesPreferenciaConjuge, padrão 2).
import { MODALIDADES, rotuloDe } from '../shared/opcoes.js'

const nomeEdicao = (numero, modalidade) => `${numero}º ${rotuloDe(MODALIDADES, modalidade)}`

export function descreverValidade(numero, edicoes, modalidade) {
  const edicoesCobertas = Array.from({ length: edicoes }, (_, i) => `${numero + i + 1}º`)
  const lista = edicoesCobertas.length > 1
    ? `${edicoesCobertas.slice(0, -1).join(', ')} e ${edicoesCobertas.at(-1)}`
    : edicoesCobertas[0]
  return `válida para o ${lista} ${rotuloDe(MODALIDADES, modalidade)}`
}

async function ultimaEdicao(db, modalidade) {
  const { rows: [r] } = await db.query('select max(numero) as n from acampamentos where modalidade = $1', [modalidade])
  return r.n ?? 0
}

/**
 * Cria a preferência para quem é cônjuge de alguém que fez o acampamento.
 * Retorna { criada: true } ou { criada: false, motivo }.
 */
export async function criarPreferencia(db, p) {
  const { beneficiadaId, conjugeFichaId = null, conjugeNome = null, modalidade, numero, acampamentoId = null,
    origem, usuarioId, edicoes, observacao = null } = p
  if (!edicoes) return { criada: false, motivo: 'A preferência por cônjuge está desligada nas configurações.' }
  const ultima = await ultimaEdicao(db, modalidade)
  if (ultima >= numero + edicoes) {
    return { criada: false, motivo: `Já expirou: o ${nomeEdicao(numero + edicoes, modalidade)} já foi cadastrado.` }
  }
  const { rows } = await db.query(
    `insert into preferencias (pre_ficha_id, origem, modalidade, acampamento_numero, edicoes, acampamento_id,
                               conjuge_ficha_id, conjuge_nome, observacao, criado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (pre_ficha_id, modalidade, acampamento_numero) where revogada_em is null do nothing
     returning id`,
    [beneficiadaId, origem, modalidade, numero, edicoes, acampamentoId, conjugeFichaId, conjugeNome, observacao, usuarioId])
  if (!rows.length) return { criada: false, motivo: 'Esta preferência já está registrada.' }

  let nomeConjuge = conjugeNome
  if (conjugeFichaId) {
    nomeConjuge = (await db.query('select nome_completo from pre_fichas where id = $1', [conjugeFichaId])).rows[0]?.nome_completo
  }
  await db.query(
    `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes) values ($1, $2, 'preferencia', $3, $4)`,
    [beneficiadaId, usuarioId,
      `Preferência ${origem === 'automatica' ? 'criada automaticamente' : 'registrada'}: cônjuge ${nomeConjuge} fez o ` +
      `${nomeEdicao(numero, modalidade)} — ${descreverValidade(numero, edicoes, modalidade)}.${observacao ? ` ${observacao}` : ''}`,
      JSON.stringify({ acao: 'criada', id: rows[0].id, origem, modalidade, acampamento_numero: numero, valida_ate: numero + edicoes })])
  return { criada: true, id: rows[0].id }
}

export async function revogarPreferencia(db, id, usuarioId, motivo) {
  const { rows: [pr] } = await db.query(
    `update preferencias set revogada_em = now(), revogada_por = $2, motivo_revogacao = $3
      where id = $1 and revogada_em is null returning pre_ficha_id, modalidade, acampamento_numero`, [id, usuarioId, motivo])
  if (!pr) return false
  await db.query(
    `insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes) values ($1, $2, 'preferencia', $3, $4)`,
    [pr.pre_ficha_id, usuarioId, `Preferência (cônjuge fez o ${nomeEdicao(pr.acampamento_numero, pr.modalidade)}) revogada: ${motivo}`,
      JSON.stringify({ acao: 'revogada', id })])
  return true
}

/**
 * Quando alguém com cônjuge vinculado faz um acampamento, o cônjuge ganha a preferência.
 * (Não cria se o cônjuge já participou.)
 */
export async function preferenciaPorParticipacao(db, { fichaId, acampamento, usuarioId, edicoes }) {
  const { rows: [f] } = await db.query(
    `select c.id, c.status from pre_fichas f join pre_fichas c on c.id = f.conjuge_id where f.id = $1`, [fichaId])
  if (!f || f.status === 'participou') return null
  return criarPreferencia(db, {
    beneficiadaId: f.id, conjugeFichaId: fichaId, modalidade: acampamento.modalidade, numero: acampamento.numero,
    acampamentoId: acampamento.id, origem: 'automatica', usuarioId, edicoes,
  })
}

/** Ao vincular cônjuges: se um deles já fez um acampamento ainda "no prazo", o outro ganha a preferência. */
export async function preferenciaPorVinculo(db, { fichaA, fichaB, usuarioId, edicoes }) {
  for (const [quemFez, beneficiada] of [[fichaA, fichaB], [fichaB, fichaA]]) {
    const { rows: [ultima] } = await db.query(
      `select a.* from participacoes pa join acampamentos a on a.id = pa.acampamento_id
        where pa.pre_ficha_id = $1 order by a.data_inicio desc nulls last, a.numero desc limit 1`, [quemFez])
    const { rows: [b] } = await db.query('select status from pre_fichas where id = $1', [beneficiada])
    if (ultima && b && b.status !== 'participou') {
      await criarPreferencia(db, {
        beneficiadaId: beneficiada, conjugeFichaId: quemFez, modalidade: ultima.modalidade, numero: ultima.numero,
        acampamentoId: ultima.id, origem: 'automatica', usuarioId, edicoes,
      })
    }
  }
}

/** Ao desfazer o registro de participação, cancela a preferência automática que ele gerou. */
export async function revogarPorParticipacaoRemovida(db, { fichaId, acampamento, usuarioId }) {
  const { rows } = await db.query(
    `select id from preferencias
      where acampamento_id = $1 and conjuge_ficha_id = $2 and origem = 'automatica' and revogada_em is null`,
    [acampamento.id, fichaId])
  for (const r of rows) {
    await revogarPreferencia(db, r.id, usuarioId, `registro do cônjuge no ${nomeEdicao(acampamento.numero, acampamento.modalidade)} foi removido`)
  }
}
