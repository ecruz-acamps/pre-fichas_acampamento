import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const sem = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const MAX_ITENS = 400

/** Ícone de funil (cheio quando há filtro). */
export const Funil = ({ cheio }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5z" fill={cheio ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
)

/**
 * Janela de filtro de uma coluna, como o filtro automático do Excel: classificar, pesquisar, marcar valores, OK / limpar.
 * Desenhada fora da tabela (portal) para a rolagem da tabela não cortá-la.
 */
export default function FiltroColuna({ coluna, valores, filtro, ordem, ancora, onAplicar, onOrdenar, onFechar }) {
  const ref = useRef(null)
  const [busca, setBusca] = useState('')
  const todas = useMemo(() => new Set(valores.map((v) => v.chave)), [valores])
  const [sel, setSel] = useState(() => new Set(filtro?.tipo === 'lista' ? [...filtro.permitidos].filter((k) => todas.has(k)) : todas))
  const [min, setMin] = useState(filtro?.tipo === 'faixa' && filtro.min != null ? String(filtro.min) : '')
  const [max, setMax] = useState(filtro?.tipo === 'faixa' && filtro.max != null ? String(filtro.max) : '')
  const [texto, setTexto] = useState(filtro?.tipo === 'texto' ? filtro.texto : '')

  // posição: logo abaixo do botão, sem sair da tela
  const largura = 300
  const esquerda = Math.max(8, Math.min(ancora.left, window.innerWidth - largura - 8))
  const topo = Math.min(ancora.bottom + 4, window.innerHeight - 160)

  useEffect(() => {
    const fora = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.('.btn-filtro')) onFechar() }
    const tecla = (e) => { if (e.key === 'Escape') { onFechar(); ancora.botao?.focus?.() } }
    const rolou = (e) => { if (!ref.current?.contains(e.target)) onFechar() }
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', tecla)
    window.addEventListener('scroll', rolou, true); window.addEventListener('resize', onFechar)
    ref.current?.querySelector('input[type=search], input[type=number], input[type=text]')?.focus()
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); window.removeEventListener('scroll', rolou, true); window.removeEventListener('resize', onFechar) }
  }, [onFechar, ancora])

  const termo = sem(busca.trim())
  const visiveis = useMemo(() => (termo ? valores.filter((v) => sem(v.rotulo).includes(termo)) : valores), [valores, termo])
  // Como no Excel: ao pesquisar, ficam marcados só os resultados (o OK filtra por eles); apagando a pesquisa, volta a seleção de antes
  const selRef = useRef(sel); selRef.current = sel
  const antesDaBusca = useRef(null)
  useEffect(() => {
    if (termo) {
      antesDaBusca.current ??= selRef.current
      setSel(new Set(valores.filter((v) => sem(v.rotulo).includes(termo)).map((v) => v.chave)))
    } else if (antesDaBusca.current) { setSel(antesDaBusca.current); antesDaBusca.current = null }
  }, [termo, valores])
  const mostrados = visiveis.slice(0, MAX_ITENS)
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((v) => sel.has(v.chave))
  const alternar = (chave) => setSel((s) => { const n = new Set(s); if (n.has(chave)) n.delete(chave); else n.add(chave); return n })
  const alternarTodos = () => setSel((s) => {
    const n = new Set(s)
    for (const v of visiveis) { if (todosVisiveisMarcados) n.delete(v.chave); else n.add(v.chave) }
    return n
  })
  const aplicarLista = () => onAplicar(sel.size === todas.size ? null : { tipo: 'lista', permitidos: new Set(sel) })

  // data: agrupa por ano (marcar o ano marca os meses)
  const porAno = useMemo(() => {
    if (coluna.tipo !== 'data') return null
    const g = new Map()
    for (const v of mostrados) { const a = v.chave.slice(0, 4); if (!g.has(a)) g.set(a, []); g.get(a).push(v) }
    return [...g.entries()]
  }, [coluna.tipo, mostrados])
  const alternarAno = (itens) => setSel((s) => { const n = new Set(s); const todos = itens.every((v) => n.has(v.chave)); for (const v of itens) { if (todos) n.delete(v.chave); else n.add(v.chave) } return n })

  const Item = ({ v }) => (
    <label className="filtro-item"><input type="checkbox" checked={sel.has(v.chave)} onChange={() => alternar(v.chave)} /><span className="filtro-rotulo">{v.rotulo}</span><span className="filtro-total">{v.total}</span></label>
  )

  return createPortal(
    <div ref={ref} className="filtro-pop" role="dialog" aria-label={`Filtrar a coluna ${coluna.rotulo}`} style={{ left: esquerda, top: topo, width: largura }}>
      <button type="button" className={`filtro-ordem ${ordem === 1 ? 'ativa' : ''}`} onClick={() => { onOrdenar(ordem === 1 ? null : 1); onFechar() }}>↑ {coluna.sentido[0]}</button>
      <button type="button" className={`filtro-ordem ${ordem === -1 ? 'ativa' : ''}`} onClick={() => { onOrdenar(ordem === -1 ? null : -1); onFechar() }}>↓ {coluna.sentido[1]}</button>
      <hr />

      {coluna.tipo === 'faixa' && (
        <div className="filtro-faixa">
          <label>De <input type="number" min="1" value={min} onChange={(e) => setMin(e.target.value)} /></label>
          <label>Até <input type="number" min="1" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        </div>
      )}
      {coluna.tipo === 'texto' && (
        <label className="filtro-texto">Contém
          <input type="text" inputMode="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Digite parte do número" onKeyDown={(e) => e.key === 'Enter' && onAplicar(texto.trim() ? { tipo: 'texto', texto: texto.trim() } : null)} />
        </label>
      )}
      {(coluna.tipo === 'lista' || coluna.tipo === 'data') && (
        <>
          <input type="search" className="filtro-busca" placeholder="Pesquisar" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar nos valores" />
          <div className="filtro-lista" role="group" aria-label="Valores">
            <label className="filtro-item filtro-tudo">
              <input type="checkbox" checked={todosVisiveisMarcados} ref={(el) => { if (el) el.indeterminate = !todosVisiveisMarcados && visiveis.some((v) => sel.has(v.chave)) }} onChange={alternarTodos} disabled={!visiveis.length} />
              <span className="filtro-rotulo">{termo ? '(Selecionar todos os resultados)' : '(Selecionar tudo)'}</span>
            </label>
            {porAno
              ? porAno.map(([ano, itens]) => (
                <div key={ano} className="filtro-ano">
                  <label className="filtro-item"><input type="checkbox" checked={itens.every((v) => sel.has(v.chave))} onChange={() => alternarAno(itens)} /><strong className="filtro-rotulo">{ano}</strong></label>
                  {itens.map((v) => <div key={v.chave} className="filtro-mes"><Item v={v} /></div>)}
                </div>))
              : mostrados.map((v) => <Item key={v.chave} v={v} />)}
            {!visiveis.length && <p className="dica filtro-vazio">Nenhum valor encontrado.</p>}
            {visiveis.length > MAX_ITENS && <p className="dica filtro-vazio">Mostrando {MAX_ITENS} de {visiveis.length}. Refine a pesquisa.</p>}
          </div>
        </>
      )}

      <div className="filtro-rodape">
        {(filtro || ordem !== 0) && <button type="button" className="link" onClick={() => { onAplicar(null); if (ordem) onOrdenar(null) }}>Limpar</button>}
        <span className="filtro-espaco" />
        <button type="button" className="botao-secundario" onClick={onFechar}>Cancelar</button>
        <button type="button" className="botao-principal pequeno"
          disabled={(coluna.tipo === 'lista' || coluna.tipo === 'data') && sel.size === 0}
          onClick={() => {
            if (coluna.tipo === 'faixa') onAplicar(min === '' && max === '' ? null : { tipo: 'faixa', min: min === '' ? null : Number(min), max: max === '' ? null : Number(max) })
            else if (coluna.tipo === 'texto') onAplicar(texto.trim() ? { tipo: 'texto', texto: texto.trim() } : null)
            else aplicarLista()
          }}>OK</button>
      </div>
    </div>,
    document.body,
  )
}
