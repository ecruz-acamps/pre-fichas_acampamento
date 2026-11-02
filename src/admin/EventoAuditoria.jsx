import { MODALIDADES, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { formatarDataHora } from '../../shared/util.js'

export const TIPOS_EVENTO = [
  { valor: 'inscricao', rotulo: 'Inscrição', icone: '📝' },
  { valor: 'status', rotulo: 'Status', icone: '🔄' },
  { valor: 'observacao', rotulo: 'Observação', icone: '💬' },
  { valor: 'recusa', rotulo: 'Recusa', icone: '✋' },
  { valor: 'fim_da_fila', rotulo: 'Fim da fila', icone: '⏬' },
  { valor: 'acampamento', rotulo: 'Acampamento', icone: '⛺' },
  { valor: 'preferencia', rotulo: 'Preferência', icone: '★' },
  { valor: 'conjuge', rotulo: 'Cônjuge', icone: '💍' },
  { valor: 'edicao', rotulo: 'Edição de dados', icone: '✏️' },
]

/** Descrição legível de um evento da trilha de auditoria. */
export function DescricaoEvento({ e }) {
  const d = e.detalhes ?? {}
  switch (e.tipo) {
    case 'inscricao':
      return <div>Pré-ficha enviada pelo formulário{d.modalidade ? ` (${rotuloDe(MODALIDADES, d.modalidade)})` : ''}.</div>
    case 'recusa':
      return (
        <>
          <div>
            <strong>Recusou ser chamada</strong> — {d.numero}ª recusa seguida
            {d.limite > 0 && !d.foi_para_o_fim && ` (com ${d.limite} vai para o fim da fila)`}
            {d.foi_para_o_fim && ' → foi para o fim da fila'}
          </div>
          {e.observacao && <div className="texto-longo">Comentário: {e.observacao}</div>}
        </>
      )
    case 'fim_da_fila':
      return (
        <>
          <div><strong>Movida para o fim da fila</strong></div>
          <div className="mudanca-data">
            Na fila desde: <s>{formatarDataHora(d.entrada_anterior)}</s> → <strong>{formatarDataHora(d.entrada_nova)}</strong>
            {d.inscricao_original && <small className="dica bloco">Inscrição original (não muda): {formatarDataHora(d.inscricao_original)}</small>}
          </div>
          {e.observacao && <div className="texto-longo">Motivo: {e.observacao}</div>}
        </>
      )
    case 'edicao':
      return (
        <>
          <div><strong>Dados alterados pela própria pessoa</strong> (área do participante)</div>
          <ul className="lista-mudancas">
            {(d.campos ?? []).map((c) => (
              <li key={c}><code>{c}</code>: <s>{String(d.antes?.[c] ?? '—')}</s> → <strong>{String(d.depois?.[c] ?? '—')}</strong></li>
            ))}
          </ul>
        </>
      )
    default:
      return (
        <>
          {e.status_novo && <div>Status: {rotuloDe(STATUS, e.status_anterior)} → <strong>{rotuloDe(STATUS, e.status_novo)}</strong></div>}
          {e.observacao && <div className="texto-longo">{['acampamento', 'preferencia', 'conjuge'].includes(e.tipo) ? e.observacao : `Observação: ${e.observacao}`}</div>}
        </>
      )
  }
}

export function autorEvento(e) {
  if (e.usuario) return e.usuario
  if (e.tipo === 'inscricao') return 'formulário público'
  if (e.tipo === 'edicao' || /própria pessoa/.test(e.observacao ?? '')) return 'a própria pessoa'
  if (e.tipo === 'fim_da_fila' && /diretamente no banco/.test(e.observacao ?? '')) return 'alteração direta no banco'
  return 'usuário removido'
}

export function SeloTipo({ tipo }) {
  const t = TIPOS_EVENTO.find((x) => x.valor === tipo)
  return <span className={`selo-evento evento-${tipo}`}>{t?.icone} {t?.rotulo ?? tipo}</span>
}
