// Versão para impressão da pré-ficha (papel A4). Só aparece na impressão: na tela fica oculta.
// Não inclui observações internas nem o histórico da equipe (só os dados da pessoa).
import { createPortal } from 'react-dom'
import { ESTADOS_CIVIS, MODALIDADES, SEXOS, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, formatarData, formatarDataHora, mascaraCep, mascaraCpf, simNao } from '../../shared/util.js'

function L({ r, children, largo }) {
  const vazio = children === null || children === undefined || children === ''
  return (
    <div className={`imp-item ${largo ? 'largo' : ''}`}>
      <span className="imp-rotulo">{r}</span>
      <span className="imp-valor">{vazio ? '—' : children}</span>
    </div>
  )
}

export default function FichaImpressao({ f, marca, posicao, nomeNucleo, usuario }) {
  const endereco = [f.logradouro, f.numero, f.complemento].filter(Boolean).join(', ')
  return createPortal(
    <div className="ficha-impressao" aria-hidden="true">
      <header className="imp-topo">
        {marca?.logoUrl && <img src={marca.logoUrl} alt="" />}
        <div>
          <p className="imp-acampamento">{marca?.nome}</p>
          <h1>Pré-ficha de inscrição</h1>
        </div>
        <div className="imp-num">Ficha nº {f.id}</div>
      </header>

      <section>
        <h2>Situação</h2>
        <div className="imp-grade">
          <L r="Status">{rotuloDe(STATUS, f.status)}</L>
          <L r="Modalidade">{rotuloDe(MODALIDADES, f.modalidade)}</L>
          <L r="Posição na fila">{posicao ? `${posicao}º` : null}</L>
          <L r="Inscrição">{formatarDataHora(f.created_at)}</L>
          <L r="Na fila desde">{formatarDataHora(f.entrada_fila_em ?? f.created_at)}</L>
          <L r="Núcleo">{f.nucleos?.map(nomeNucleo).filter(Boolean).join(', ')}</L>
        </div>
      </section>

      <section>
        <h2>Dados pessoais</h2>
        <div className="imp-grade">
          <L r="Nome" largo>{f.nome_completo}</L>
          <L r="CPF">{f.cpf ? mascaraCpf(f.cpf) : null}</L>
          <L r="Nascimento">{f.data_nascimento ? `${formatarData(f.data_nascimento)} (${calcularIdade(f.data_nascimento)} anos)` : null}</L>
          <L r="Sexo">{rotuloDe(SEXOS, f.sexo)}</L>
          <L r="Estado civil">{rotuloDe(ESTADOS_CIVIS, f.estado_civil)}</L>
          <L r="Profissão">{f.profissao}</L>
          <L r="Telefone">{f.telefone}</L>
          {(f.responsavel_nome || f.responsavel_telefone) && (
            <L r="Responsável" largo>{[f.responsavel_nome, f.responsavel_telefone].filter(Boolean).join(' · ')}</L>
          )}
          {(f.conjuge_nome || f.conjuge_telefone) && (
            <L r="Cônjuge" largo>{[f.conjuge_nome, f.conjuge_telefone].filter(Boolean).join(' · ')}</L>
          )}
        </div>
      </section>

      <section>
        <h2>Contato e endereço</h2>
        <div className="imp-grade">
          <L r="E-mail" largo>{f.email}</L>
          <L r="Instagram">{f.instagram}</L>
          <L r="Facebook">{f.facebook}</L>
          <L r="Endereço" largo>{endereco}</L>
          <L r="Bairro">{f.bairro}</L>
          <L r="Cidade/UF">{f.cidade ? `${f.cidade}/${f.uf}` : null}</L>
          <L r="CEP">{f.cep ? mascaraCep(f.cep) : null}</L>
        </div>
      </section>

      <section>
        <h2>Informações religiosas</h2>
        <div className="imp-grade">
          <L r="Religião">{f.religiao}</L>
          <L r="Batizado(a)">{simNao(f.batizado)}</L>
          <L r="Primeira eucaristia">{simNao(f.primeira_eucaristia)}</L>
          <L r="Crismado(a)">{simNao(f.crismado)}</L>
          <L r="Paróquia">{f.paroquia}</L>
          <L r="Pastoral">{f.participa_pastoral ? `Sim — ${f.pastoral_qual || ''}` : f.participa_pastoral === false ? 'Não' : null}</L>
        </div>
      </section>

      <section>
        <h2>Acampamento</h2>
        <div className="imp-grade">
          <L r="Como conheceu" largo>{f.como_conheceu}</L>
          <L r="Por que deseja participar" largo>{f.motivo}</L>
          <L r="Vício">{f.possui_vicio ? `Sim — ${f.vicio_qual || ''}` : f.possui_vicio === false ? 'Não' : null}</L>
          <L r="Restrições médicas" largo>{f.restricoes_medicas}</L>
          <L r="Retiros anteriores" largo>{f.retiros_anteriores}</L>
          {f.participacoes?.length > 0 && (
            <L r="Já fez" largo>{f.participacoes.map((p) => `${p.numero}º ${rotuloDe(MODALIDADES, p.modalidade)}${p.tribo ? ` (tribo ${p.tribo})` : ''}`).join(', ')}</L>
          )}
        </div>
      </section>

      {f.termos_aceitos?.length > 0 && (
        <section>
          <h2>Declarações aceitas no envio</h2>
          <ul className="imp-termos">{f.termos_aceitos.map((t, i) => <li key={i}>☑ {t}</li>)}</ul>
        </section>
      )}

      <footer className="imp-rodape">
        Impresso por {usuario?.nome ?? '—'} em {formatarDataHora(new Date().toISOString())}.
        Documento com dados pessoais (LGPD): use só para o acampamento e guarde ou descarte com cuidado.
      </footer>
    </div>,
    document.body,
  )
}
