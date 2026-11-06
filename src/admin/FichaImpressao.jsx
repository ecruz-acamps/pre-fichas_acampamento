// Versão para impressão da pré-ficha (papel A4), no formato de "ficha de pré-inscrição" com campos em caixas.
// O cabeçalho é configurável em Configurações → Impressão da ficha (textos e logo da esquerda).
// Só aparece na impressão. Não inclui observações internas nem o histórico da equipe.
import { createPortal } from 'react-dom'
import { ESTADOS_CIVIS, MODALIDADES, SEXOS, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, formatarData, mascaraCep, mascaraCpf, formatarDataHora, simNao } from '../../shared/util.js'

/** Campo em caixa: rótulo em cima, valor dentro da caixa. `c` = colunas (de 12). */
function C({ r, c = 4, children, alto }) {
  const vazio = children === null || children === undefined || children === ''
  return (
    <div className="imp-campo" style={{ gridColumn: `span ${c}` }}>
      <span className="imp-rotulo">{r}</span>
      <span className={`imp-caixa ${alto ? 'alto' : ''}`}>{vazio ? '' : children}</span>
    </div>
  )
}
const Linha = ({ children }) => <div className="imp-linha">{children}</div>

/** "Acampamento São Padre Pio" → ACAMPAMENTO / São Padre Pio (como na identidade visual). */
function TextoDireita({ texto }) {
  const m = /^(acampamento)\s+(.+)$/i.exec(texto ?? '')
  if (!m) return <strong className="imp-dir-1">{texto}</strong>
  return <><strong className="imp-dir-1">{m[1].toUpperCase()}</strong><span className="imp-dir-2">{m[2]}</span></>
}

export default function FichaImpressao({ f, marca, posicao, nomeNucleo, usuario }) {
  const rua = [f.logradouro, f.numero].filter(Boolean).join(', ')
  const subtitulo = marca?.impressaoSubtitulo || marca?.nome || ''
  const titulo = marca?.impressaoTitulo || 'Ficha de pré-inscrição'
  const direita = marca?.impressaoTextoDireita || marca?.nome || ''
  const conjugeCampista = f.conjuge_fez_acampamento === true
    ? `Sim${f.conjuge_acampamento_numero ? ` (${f.conjuge_acampamento_numero}º)` : ''}`
    : f.conjuge_fez_acampamento === false ? 'Não' : null
  const pastoral = f.participa_pastoral === true ? 'Sim' : f.participa_pastoral === false ? 'Não' : null

  return createPortal(
    <div className="ficha-impressao" aria-hidden="true">
      <header className="imp-topo">
        <div className="imp-esq">{marca?.logoImpressaoUrl && <img src={marca.logoImpressaoUrl} alt="" />}</div>
        <div className="imp-centro">
          {subtitulo && <p className="imp-subtitulo">{subtitulo}</p>}
          <h1>{titulo}</h1>
        </div>
        <div className="imp-dir">
          {marca?.logoUrl && <img src={marca.logoUrl} alt="" />}
          <div className="imp-dir-texto"><TextoDireita texto={direita} /></div>
        </div>
      </header>

      <Linha><C r="Nome completo" c={8}>{f.nome_completo}</C><C r="CPF">{f.cpf ? mascaraCpf(f.cpf) : null}</C></Linha>
      <Linha><C r="Rua e número" c={8}>{rua}</C><C r="Complemento">{f.complemento}</C></Linha>
      <Linha><C r="Bairro" c={8}>{f.bairro}</C><C r="Cidade e estado">{f.cidade ? `${f.cidade} - ${f.uf}` : null}</C></Linha>
      <Linha><C r="Telefone">{f.telefone}</C><C r="Instagram" c={3}>{f.instagram}</C><C r="E-mail" c={5}>{f.email}</C></Linha>
      <Linha>
        <C r="Data nascimento" c={3}>{f.data_nascimento ? formatarData(f.data_nascimento) : null}</C>
        <C r="Idade" c={3}>{f.data_nascimento ? calcularIdade(f.data_nascimento) : null}</C>
        <C r="Sexo" c={3}>{rotuloDe(SEXOS, f.sexo)}</C>
        <C r="Religião" c={3}>{f.religiao}</C>
      </Linha>
      <Linha>
        <C r="Estado civil" c={5}>{rotuloDe(ESTADOS_CIVIS, f.estado_civil)}</C>
        <C r="Cônjuge é campista?" c={4}>{conjugeCampista}</C>
        <C r="Nome cônjuge" c={3}>{[f.conjuge_nome, f.conjuge_cpf && mascaraCpf(f.conjuge_cpf), f.conjuge_telefone].filter(Boolean).join(' · ')}</C>
      </Linha>
      <Linha>
        <C r="Paróquia que participa" c={3}>{f.paroquia}</C>
        <C r="É batizado?" c={3}>{simNao(f.batizado)}</C>
        <C r="Fez 1ª comunhão?" c={3}>{simNao(f.primeira_eucaristia)}</C>
        <C r="É crismado?" c={3}>{simNao(f.crismado)}</C>
      </Linha>
      <Linha><C r="Participa de pastoral?" c={8}>{pastoral}</C><C r="Se sim, qual pastoral?">{f.participa_pastoral ? f.pastoral_qual : null}</C></Linha>
      <Linha><C r="Como conheceu / campistas conhecidos" c={8}>{f.como_conheceu}</C><C r="Retiros que participou">{f.retiros_anteriores}</C></Linha>
      <Linha>
        <C r="Modalidade aguardada" c={8}>{rotuloDe(MODALIDADES, f.modalidade)}</C>
        <C r="Data de envio da ficha">{f.created_at ? formatarDataHora(f.created_at).slice(0, 10) : null}</C>
      </Linha>
      {(f.responsavel_nome || f.responsavel_telefone) && (
        <Linha><C r="Responsável (menor de idade)" c={8}>{f.responsavel_nome}</C><C r="Telefone do responsável">{f.responsavel_telefone}</C></Linha>
      )}
      <Linha><C r="Por que deseja participar" c={12} alto>{f.motivo}</C></Linha>
      <Linha>
        <C r="Possui vício?" c={4}>{f.possui_vicio ? `Sim — ${f.vicio_qual || ''}` : f.possui_vicio === false ? 'Não' : null}</C>
        <C r="Restrições médicas" c={8}>{f.restricoes_medicas}</C>
      </Linha>
      <Linha>
        <C r="Situação" c={3}>{rotuloDe(STATUS, f.status)}</C>
        <C r="Posição na fila" c={2}>{posicao ? `${posicao}º` : null}</C>
        <C r="CEP" c={3}>{f.cep ? mascaraCep(f.cep) : null}</C>
        <C r="Núcleo" c={4}>{f.nucleos?.map(nomeNucleo).filter(Boolean).join(', ')}</C>
      </Linha>
      {f.participacoes?.length > 0 && (
        <Linha><C r="Acampamentos que já fez" c={12}>
          {f.participacoes.map((p) => `${p.numero}º ${rotuloDe(MODALIDADES, p.modalidade)}${p.tribo ? ` (tribo ${p.tribo})` : ''}`).join(', ')}
        </C></Linha>
      )}

      {f.termos_aceitos?.length > 0 && (
        <div className="imp-termos">
          <span className="imp-rotulo">Declarações aceitas no envio</span>
          <ul>{f.termos_aceitos.map((t, i) => <li key={i}>☑ {t}</li>)}</ul>
        </div>
      )}

      <footer className="imp-rodape">
        Ficha nº {f.id} · impressa por {usuario?.nome ?? '—'} em {formatarDataHora(new Date().toISOString())}.
        Documento com dados pessoais (LGPD): use só para o acampamento e guarde ou descarte com cuidado.
      </footer>
    </div>,
    document.body,
  )
}
