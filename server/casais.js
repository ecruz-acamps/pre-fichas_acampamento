// Regras da inscrição na modalidade "Casais".
//   - o CPF do cônjuge é obrigatório e o cônjuge precisa já ser CAMPISTA cadastrado no sistema
//     (ter participado de algum acampamento);
//   - se a regra do acampamento exigir (Configurações → casaisExigeSenior), os DOIS precisam ter feito o Sênior;
//   - o casal se inscreve uma vez só (se o cônjuge já inscreveu o casal, não duplica).
//
// Segurança: a mensagem de recusa do cônjuge é a MESMA para "CPF não encontrado" e "encontrado, mas não
// atende" (não revela quem é campista), e há limite de tentativas falhas por conta (ver rotas/conta.js).

const STATUS_ATIVOS = ['aguardando', 'em_contato', 'confirmado']

/** A pessoa (conta ou CPF) tem participação em algum acampamento? `apenasSenior`: só nos do Sênior. */
export async function jaFezAcampamento(pool, { participanteId = null, cpf, apenasSenior = false }) {
  const { rows: [r] } = await pool.query(
    `select exists (
       select 1 from pre_fichas f
         join participacoes pa on pa.pre_ficha_id = f.id
         join acampamentos a on a.id = pa.acampamento_id
        where (f.cpf = $1 or ($2::bigint is not null and f.participante_id = $2))
          and ($3::boolean is false or a.modalidade = 'senior')) as ok`,
    [cpf, participanteId, apenasSenior])
  return r.ok
}

export const fezSenior = (pool, participanteId, cpf) => jaFezAcampamento(pool, { participanteId, cpf, apenasSenior: true })

/**
 * Confere a inscrição de casal. Retorna { erros } (vazio = ok) e, quando o problema é o cônjuge,
 * `falhaConjuge: true` (a rota conta isso para o limite de tentativas).
 */
export async function validarCasais(pool, { marca, participanteId, cpf, conjugeCpf }) {
  const exigeSenior = marca.casaisExigeSenior !== false
  if (conjugeCpf === cpf) {
    return { erros: { conjuge_cpf: 'O CPF do cônjuge deve ser diferente do seu.' } }
  }
  if (exigeSenior && !(await fezSenior(pool, participanteId, cpf))) {
    return { erros: { modalidade: 'Para a modalidade Casais é preciso já ter feito o Sênior.' } }
  }
  // o cônjuge já inscreveu o casal com o meu CPF?
  const { rows: [dup] } = await pool.query(
    `select 1 from pre_fichas where modalidade = 'casais' and status = any($1) and cpf = $2 and conjuge_cpf = $3 limit 1`,
    [STATUS_ATIVOS, conjugeCpf, cpf])
  if (dup) return { erros: { modalidade: 'Seu cônjuge já fez a inscrição de casais com o seu CPF. Não é preciso se inscrever de novo.' } }
  if (!(await jaFezAcampamento(pool, { cpf: conjugeCpf, apenasSenior: exigeSenior }))) {
    return {
      falhaConjuge: true,
      erros: {
        conjuge_cpf: `Não foi possível confirmar o seu cônjuge. Ele(a) precisa já ser campista cadastrado(a) no sistema${exigeSenior ? ' e ter feito o Sênior' : ''}. `
          + 'Confira o CPF ou fale com a coordenação do acampamento.',
      },
    }
  }
  return { erros: {} }
}
