import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ESTADOS_CIVIS, MODALIDADES, SEXOS, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, formatarData, formatarDataHora, linkWhatsApp, mascaraCep, simNao } from '../../shared/util.js'

function Item({ rotulo, children }) {
  const vazio = children === null || children === undefined || children === ''
  return (
    <div className="item">
      <dt>{rotulo}</dt>
      <dd className={vazio ? 'vazio' : ''}>{vazio ? '—' : children}</dd>
    </div>
  )
}

export default function Detalhe({ ficha: f, posicao, onFechar, onSalvar }) {
  const [status, setStatus] = useState(f.status)
  const [obs, setObs] = useState(f.observacoes_internas || '')
  const [salvando, setSalvando] = useState(false)
  const [historico, setHistorico] = useState([])

  useEffect(() => {
    api.get(`/api/admin/pre-fichas/${f.id}/historico`).then(setHistorico).catch(() => setHistorico([]))
  }, [f.id, f.atualizado_em])

  useEffect(() => { setStatus(f.status); setObs(f.observacoes_internas || '') }, [f])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const alterado = status !== f.status || obs !== (f.observacoes_internas || '')
  const wa = linkWhatsApp(f.telefone)
  const endereco = [f.logradouro, f.numero, f.complemento].filter(Boolean).join(', ')

  async function salvar() {
    setSalvando(true)
    await onSalvar({ status, observacoes_internas: obs.trim() || null })
    setSalvando(false)
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <aside className="modal" role="dialog" aria-modal="true" aria-label={f.nome_completo} onClick={(e) => e.stopPropagation()}>
        <header className="modal-topo">
          <div>
            <h2>{f.nome_completo}</h2>
            <p className="subtitulo">
              {rotuloDe(MODALIDADES, f.modalidade)}
              {posicao ? ` · ${posicao}º na fila` : ''} · inscrito em {formatarDataHora(f.created_at)}
            </p>
          </div>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <div className="modal-corpo">
          <section className="gestao">
            <div className="campo">
              <label htmlFor="det-status">Status</label>
              <select id="det-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="det-obs">Observações internas</label>
              <textarea id="det-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
                placeholder="Ex.: liguei em 10/11, retornar semana que vem" />
            </div>
            <div className="linha-acoes">
              {f.atualizado_em && (
                <small className="dica">
                  Última alteração: {formatarDataHora(f.atualizado_em)}{f.atualizado_por_nome ? ` por ${f.atualizado_por_nome}` : ''}
                </small>
              )}
              <button className="botao-principal pequeno" disabled={!alterado || salvando} onClick={salvar}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </section>

          <h3>Dados pessoais</h3>
          <dl className="grade">
            <Item rotulo="Data de nascimento">{formatarData(f.data_nascimento)} ({calcularIdade(f.data_nascimento)} anos)</Item>
            <Item rotulo="Sexo">{rotuloDe(SEXOS, f.sexo)}</Item>
            <Item rotulo="Estado civil">{rotuloDe(ESTADOS_CIVIS, f.estado_civil)}</Item>
            <Item rotulo="Profissão">{f.profissao}</Item>
            <Item rotulo="Telefone">{wa ? <a href={wa} target="_blank" rel="noreferrer">{f.telefone}</a> : f.telefone}</Item>
            {(f.responsavel_nome || f.responsavel_telefone) && (
              <Item rotulo="Responsável">{f.responsavel_nome} · {f.responsavel_telefone}</Item>
            )}
          </dl>

          <h3>Informações religiosas</h3>
          <dl className="grade">
            <Item rotulo="Religião">{f.religiao}</Item>
            <Item rotulo="Batizado(a)">{simNao(f.batizado)}</Item>
            <Item rotulo="Primeira eucaristia">{simNao(f.primeira_eucaristia)}</Item>
            <Item rotulo="Crismado(a)">{simNao(f.crismado)}</Item>
            <Item rotulo="Paróquia">{f.paroquia}</Item>
            <Item rotulo="Pastoral">{f.participa_pastoral ? `Sim — ${f.pastoral_qual || ''}` : 'Não'}</Item>
          </dl>

          <h3>Contato</h3>
          <dl className="grade">
            <Item rotulo="E-mail"><a href={`mailto:${f.email}`}>{f.email}</a></Item>
            <Item rotulo="Instagram">{f.instagram}</Item>
            <Item rotulo="Facebook">{f.facebook}</Item>
          </dl>

          <h3>Endereço</h3>
          <dl className="grade">
            <Item rotulo="CEP">{mascaraCep(f.cep)}</Item>
            <Item rotulo="Endereço">{endereco}</Item>
            <Item rotulo="Bairro">{f.bairro}</Item>
            <Item rotulo="Cidade/UF">{f.cidade}/{f.uf}</Item>
          </dl>

          <h3>Acampamento</h3>
          <dl className="grade">
            <Item rotulo="Modalidade">{rotuloDe(MODALIDADES, f.modalidade)}</Item>
            <Item rotulo="Como conheceu">{f.como_conheceu}</Item>
          </dl>
          <dl>
            <Item rotulo="Por que deseja participar"><span className="texto-longo">{f.motivo}</span></Item>
          </dl>

          <h3>Informações adicionais</h3>
          <dl>
            <Item rotulo="Vício">{f.possui_vicio ? `Sim — ${f.vicio_qual || ''}` : 'Não'}</Item>
            <Item rotulo="Restrições médicas"><span className="texto-longo">{f.restricoes_medicas}</span></Item>
            <Item rotulo="Retiros que já participou"><span className="texto-longo">{f.retiros_anteriores}</span></Item>
          </dl>

          <h3>Histórico</h3>
          {historico.length ? (
            <ol className="historico">
              {historico.map((h) => (
                <li key={h.id}>
                  <small className="dica">{formatarDataHora(h.criado_em)} · {h.usuario || 'usuário removido'}</small>
                  {h.status_novo && (
                    <div>Status: {rotuloDe(STATUS, h.status_anterior)} → <strong>{rotuloDe(STATUS, h.status_novo)}</strong></div>
                  )}
                  {h.observacao && <div className="texto-longo">Observação: {h.observacao}</div>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="dica">Nenhuma alteração registrada ainda.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
