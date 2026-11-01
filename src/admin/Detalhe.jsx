import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { CorTribo } from '../lib/marca.jsx'
import { DescricaoEvento, SeloTipo, autorEvento } from './EventoAuditoria.jsx'
import ConjugePreferencia from './ConjugePreferencia.jsx'
import { SeloPreferencia } from './Preferencia.jsx'
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

export default function Detalhe({ ficha: f, marca, usuario, todas = [], posicao, nomeNucleo, onFechar, onSalvar, onFilaAlterada, onFichaAtualizada, somenteLeitura = false }) {
  const [status, setStatus] = useState(f.status)
  const [obs, setObs] = useState(f.observacoes_internas || '')
  const [salvando, setSalvando] = useState(false)
  const [historico, setHistorico] = useState([])
  const [acao, setAcao] = useState(null) // 'recusa' | 'fim' | null
  const [texto, setTexto] = useState('')
  const [erroAcao, setErroAcao] = useState('')
  const [enviandoAcao, setEnviandoAcao] = useState(false)

  useEffect(() => {
    api.get(`/api/admin/pre-fichas/${f.id}/historico`).then(setHistorico).catch(() => setHistorico([]))
  }, [f.id, f.atualizado_em, f.entrada_fila_em, f.recusas_seguidas, f.conjuge_id, f.preferencias?.length])

  useEffect(() => { setStatus(f.status); setObs(f.observacoes_internas || '') }, [f])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const alterado = status !== f.status || obs !== (f.observacoes_internas || '')
  const wa = linkWhatsApp(f.telefone)
  const endereco = [f.logradouro, f.numero, f.complemento].filter(Boolean).join(', ')

  const limite = marca?.recusasParaFimDaFila ?? 2
  const proximaRecusa = (f.recusas_seguidas ?? 0) + 1
  const proximaMove = limite > 0 && proximaRecusa >= limite
  const movida = f.entrada_fila_em && new Date(f.entrada_fila_em).getTime() !== new Date(f.created_at).getTime()

  async function executarAcao(e) {
    e.preventDefault()
    setErroAcao('')
    if (!texto.trim()) return setErroAcao(acao === 'recusa' ? 'Escreva um comentário sobre a recusa.' : 'Informe o motivo.')
    if (acao === 'fim' && !confirm(`Mover ${f.nome_completo} para o fim da fila? A ação fica registrada e não pode ser desfeita.`)) return
    setEnviandoAcao(true)
    try {
      const r = acao === 'recusa'
        ? await api.post(`/api/admin/pre-fichas/${f.id}/recusa`, { comentario: texto })
        : await api.post(`/api/admin/pre-fichas/${f.id}/fim-da-fila`, { motivo: texto })
      setAcao(null); setTexto('')
      onFilaAlterada(r.ficha)
    } catch (err) {
      setErroAcao(err.dados?.mensagem || 'Não foi possível registrar.')
    } finally {
      setEnviandoAcao(false)
    }
  }

  async function salvar() {
    setSalvando(true)
    await onSalvar({ status, observacoes_internas: obs.trim() || null })
    setSalvando(false)
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <aside className="modal" role="dialog" aria-modal="true" aria-label={f.nome_completo} onClick={(e) => e.stopPropagation()}>
        {somenteLeitura && (
          <div className="faixa-consulta">Campista de outro núcleo — modo consulta (alterações só pelo núcleo dele, equipe ou administrador)</div>
        )}
        <header className="modal-topo">
          <div>
            <h2>{f.nome_completo}</h2>
            <p className="subtitulo">
              {rotuloDe(MODALIDADES, f.modalidade)}
              {posicao ? ` · ${posicao}º na fila` : ''} <SeloPreferencia ficha={f} />
            </p>
          </div>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </header>

        <div className="modal-corpo">
          <section className="posicao-fila">
            <dl className="grade">
              <Item rotulo="Inscrição original">{formatarDataHora(f.created_at)}</Item>
              <Item rotulo="Na fila desde (define a posição)">
                <span className={movida ? 'movida' : ''}>{formatarDataHora(f.entrada_fila_em ?? f.created_at)}</span>
                {movida && <small className="dica bloco">movida para o fim da fila — veja o histórico</small>}
              </Item>
              <Item rotulo="Recusas seguidas">
                {f.recusas_seguidas ?? 0}{limite > 0 ? ` de ${limite}` : ''}
              </Item>
            </dl>
            {f.status !== 'participou' && !acao && !somenteLeitura && (
              <div className="acoes-linha">
                <button className="botao-secundario" onClick={() => { setAcao('recusa'); setTexto(''); setErroAcao('') }}>Registrar recusa</button>
                <button className="link perigo" onClick={() => { setAcao('fim'); setTexto(''); setErroAcao('') }}>Mover para o fim da fila…</button>
              </div>
            )}
            {acao && (
              <form className="form-acao" onSubmit={executarAcao}>
                <label htmlFor="acao-texto">
                  {acao === 'recusa' ? 'A pessoa foi chamada e disse não. Comentário (obrigatório):' : 'Motivo para mover para o fim da fila (obrigatório):'}
                </label>
                <textarea id="acao-texto" rows={2} maxLength={1000} value={texto} autoFocus onChange={(e) => setTexto(e.target.value)}
                  placeholder={acao === 'recusa' ? 'Ex.: liguei em 01/11, não pode por causa do trabalho' : 'Ex.: pediu para adiar a participação'} />
                {acao === 'recusa' && (
                  <p className={proximaMove ? 'alerta-aviso' : 'dica'}>
                    {proximaMove
                      ? `Esta será a ${proximaRecusa}ª recusa seguida: a pessoa irá para o FIM da fila (a data na fila passa a ser agora).`
                      : `Esta será a ${proximaRecusa}ª recusa seguida.${limite > 0 ? ` Com ${limite} seguidas, a pessoa vai para o fim da fila.` : ''}`}
                  </p>
                )}
                {acao === 'fim' && <p className="alerta-aviso">A data na fila passa a ser agora. A inscrição original continua registrada.</p>}
                {erroAcao && <div className="alerta-erro">{erroAcao}</div>}
                <div className="acoes-linha">
                  <button className="botao-principal pequeno" disabled={enviandoAcao}>
                    {enviandoAcao ? 'Registrando…' : acao === 'recusa' ? 'Registrar recusa' : 'Mover para o fim'}
                  </button>
                  <button type="button" className="link" onClick={() => setAcao(null)}>cancelar</button>
                </div>
              </form>
            )}
          </section>

          <ConjugePreferencia ficha={f} todas={todas} marca={marca}
            podeGerir={!somenteLeitura && ['admin', 'equipe'].includes(usuario?.papel)} onFichaAtualizada={onFichaAtualizada} />

          {somenteLeitura ? (
            <section className="gestao somente-leitura">
              <p><strong>Status:</strong> {rotuloDe(STATUS, f.status)}</p>
              {f.observacoes_internas && <p className="texto-longo"><strong>Observações internas:</strong> {f.observacoes_internas}</p>}
            </section>
          ) : (
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
          )}

          {f.participacoes?.length > 0 && (
            <>
              <h3>Acampamentos realizados</h3>
              <ul className="lista-participacoes">
                {f.participacoes.map((p) => (
                  <li key={p.acampamento_id}>
                    <strong>{p.numero}º {rotuloDe(MODALIDADES, p.modalidade)}</strong>
                    {p.data_inicio && <span className="dica"> · {formatarData(p.data_inicio)}</span>}
                    {' · '}<CorTribo tribo={p.tribo} marca={marca} />
                  </li>
                ))}
              </ul>
            </>
          )}

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
            <Item rotulo="Núcleo">{f.nucleos?.map(nomeNucleo).filter(Boolean).join(', ') || 'Nenhum núcleo cobre este endereço'}</Item>
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

          {f.termos_aceitos?.length > 0 && (
            <details className="termos-aceitos">
              <summary>Declarações aceitas no envio ({f.termos_aceitos.length})</summary>
              <ul>{f.termos_aceitos.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </details>
          )}

          <h3>Histórico (trilha de auditoria)</h3>
          {historico.length ? (
            <ol className="historico">
              {historico.map((h) => (
                <li key={h.id} className={`evento-${h.tipo}`}>
                  <small className="dica"><SeloTipo tipo={h.tipo} /> {formatarDataHora(h.criado_em)} · {autorEvento(h)}</small>
                  <DescricaoEvento e={h} />
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
