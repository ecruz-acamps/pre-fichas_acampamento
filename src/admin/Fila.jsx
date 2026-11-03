import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { MODALIDADES, STATUS, STATUS_NA_FILA, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, chaveLocal, formatarDataHora, linkWhatsApp, melhorGrafia, somenteDigitos } from '../../shared/util.js'
import Detalhe from './Detalhe.jsx'
import { SeloPreferencia, declarouSemValidar, preferenciaAtiva } from './Preferencia.jsx'
import { exportarCsv } from './csv.js'

/** Posição na fila: por modalidade, ordem de chegada, contando só quem ainda está na fila. */
export function calcularPosicoes(linhas) {
  const contador = {}
  const posicoes = new Map()
  for (const l of linhas) {
    if (!STATUS_NA_FILA.includes(l.status)) continue
    contador[l.modalidade] = (contador[l.modalidade] || 0) + 1
    posicoes.set(l.id, contador[l.modalidade])
  }
  return posicoes
}

/** Marca fichas com o mesmo e-mail ou telefone (possível cadastro repetido). */
function calcularDuplicados(linhas) {
  const porChave = new Map()
  const chaves = (l) => [`e:${l.email}`, `t:${somenteDigitos(l.telefone)}`]
  for (const l of linhas) for (const c of chaves(l)) porChave.set(c, (porChave.get(c) || 0) + 1)
  return new Set(linhas.filter((l) => chaves(l).some((c) => porChave.get(c) > 1)).map((l) => l.id))
}

/** Lista de opções {chave, nome, total} a partir de um campo (agrupando grafias diferentes). */
export function opcoesLocais(linhas, campo) {
  const mapa = new Map()
  for (const l of linhas) {
    const chave = chaveLocal(l[campo])
    if (!chave) continue
    const item = mapa.get(chave) ?? { chave, nome: l[campo], total: 0 }
    item.nome = melhorGrafia(item.nome, l[campo])
    item.total++
    mapa.set(chave, item)
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Lista compartilhada entre as telas (Fila, Nomes, Resumo, Acampamentos): baixa uma vez e
// reaproveita ao trocar de aba. "Atualizar" (ou uma alteração) busca de novo.
const cacheFichas = { lista: null, pedido: null, ouvintes: new Set() }
const avisar = () => cacheFichas.ouvintes.forEach((f) => f(cacheFichas.lista))
export function limparCacheFichas() { cacheFichas.lista = null; cacheFichas.pedido = null }

export function useFichas() {
  const [linhas, setLinhasLocal] = useState(cacheFichas.lista ?? [])
  const [carregando, setCarregando] = useState(!cacheFichas.lista)
  const [erro, setErro] = useState('')
  useEffect(() => {
    cacheFichas.ouvintes.add(setLinhasLocal)
    return () => { cacheFichas.ouvintes.delete(setLinhasLocal) }
  }, [])
  const setLinhas = useCallback((valor) => {
    cacheFichas.lista = typeof valor === 'function' ? valor(cacheFichas.lista ?? []) : valor
    avisar()
  }, [])
  const recarregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      cacheFichas.pedido ??= api.get('/api/admin/pre-fichas')
      const lista = await cacheFichas.pedido
      cacheFichas.lista = lista
      avisar()
      return lista
    } catch (e) {
      console.error(e)
      setErro('Não foi possível carregar as pré-fichas. Tente novamente.')
    } finally {
      cacheFichas.pedido = null
      setCarregando(false)
    }
  }, [])
  useEffect(() => { if (!cacheFichas.lista) recarregar() }, [recarregar])
  return { linhas, setLinhas, carregando, erro, recarregar }
}

// Texto de busca de cada ficha, normalizado uma vez por carga (não a cada tecla)
const indiceBusca = new WeakMap()
function textoBusca(l) {
  let t = indiceBusca.get(l)
  if (t === undefined) {
    t = normalizar([l.nome_completo, l.email, l.cidade, l.bairro, l.paroquia].join(' '))
    indiceBusca.set(l, t)
  }
  return t
}
const POR_PAGINA = 200

/** Filtro de núcleo usado na fila e no resumo. */
export function filtrarNucleo(linhas, nucleo) {
  if (!nucleo) return linhas
  if (nucleo === 'sem') return linhas.filter((l) => !l.nucleos.length)
  return linhas.filter((l) => l.nucleos.includes(Number(nucleo)))
}

export function SeletorNucleo({ nucleos, coordenador, valor, onChange }) {
  if (nucleos.length <= (coordenador ? 1 : 0)) return null
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value)} aria-label="Núcleo">
      <option value="">{coordenador ? 'Todos os meus núcleos' : 'Todos os núcleos'}</option>
      {nucleos.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
      {!coordenador && <option value="sem">Sem núcleo definido</option>}
    </select>
  )
}

export default function Fila({ usuario, marca, nucleos }) {
  const { linhas, setLinhas, carregando, erro, recarregar } = useFichas()
  const [modalidade, setModalidade] = useState('todas')
  const [filtroStatus, setFiltroStatus] = useState('fila')
  const [nucleo, setNucleo] = useState('')
  const [cidade, setCidade] = useState('')
  const [bairro, setBairro] = useState('')
  const [busca, setBusca] = useState('')
  const buscaAdiada = useDeferredValue(busca)
  const [limite, setLimite] = useState(POR_PAGINA)
  const [preferenciaEscolhida, setPreferencia] = useState('')
  const prefLigada = marca?.preferenciaConjuge !== false
  const preferencia = prefLigada ? preferenciaEscolhida : ''
  const [ordem, setOrdem] = useState('fila')
  const [selecionada, setSelecionada] = useState(null)

  const posicoes = useMemo(() => calcularPosicoes(linhas), [linhas])
  const duplicados = useMemo(() => calcularDuplicados(linhas), [linhas])

  // Filtros de lugar (núcleo → cidade → bairro), antes de modalidade/status
  const doNucleo = useMemo(() => filtrarNucleo(linhas, nucleo), [linhas, nucleo])
  const porLugar = useMemo(() => doNucleo.filter((l) =>
    (!cidade || chaveLocal(l.cidade) === cidade) && (!bairro || chaveLocal(l.bairro) === bairro)), [doNucleo, cidade, bairro])
  const cidades = useMemo(() => opcoesLocais(doNucleo, 'cidade'), [doNucleo])
  const bairros = useMemo(() => (cidade ? opcoesLocais(doNucleo.filter((l) => chaveLocal(l.cidade) === cidade), 'bairro') : []), [doNucleo, cidade])

  const contagemFila = useMemo(() => {
    const c = { todas: 0 }
    for (const l of porLugar) {
      if (!STATUS_NA_FILA.includes(l.status)) continue
      c.todas++
      c[l.modalidade] = (c[l.modalidade] || 0) + 1
    }
    return c
  }, [porLugar])

  const visiveis = useMemo(() => {
    const termo = normalizar(buscaAdiada.trim())
    const termoDigitos = somenteDigitos(buscaAdiada)
    return porLugar.filter((l) => {
      if (modalidade !== 'todas' && l.modalidade !== modalidade) return false
      if (filtroStatus === 'fila' && !STATUS_NA_FILA.includes(l.status)) return false
      if (filtroStatus !== 'fila' && filtroStatus !== 'todos' && l.status !== filtroStatus) return false
      if (preferencia === 'ativa' && !preferenciaAtiva(l)) return false
      if (preferencia === 'validar' && !declarouSemValidar(l)) return false
      if (preferencia === 'sem' && preferenciaAtiva(l)) return false
      if (!termo) return true
      return textoBusca(l).includes(termo) ||
        (termoDigitos.length >= 4 && (somenteDigitos(l.telefone).includes(termoDigitos) || (l.cpf ?? '').includes(termoDigitos)))
    })
  }, [porLugar, modalidade, filtroStatus, buscaAdiada, preferencia])

  // Mostra 200 linhas por vez (desenhar milhares de linhas travava a tela)
  useEffect(() => { setLimite(POR_PAGINA) }, [modalidade, filtroStatus, buscaAdiada, preferencia, nucleo, cidade, bairro, ordem])

  const ordenadas = useMemo(() => (ordem === 'nome'
    ? [...visiveis].sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, 'pt-BR', { sensitivity: 'base' }))
    : visiveis), [visiveis, ordem])

  const comPreferencia = useMemo(() => porLugar.filter((l) => STATUS_NA_FILA.includes(l.status) && preferenciaAtiva(l)).length, [porLugar])

  async function atualizar(id, campos) {
    try {
      const atualizada = await api.patch(`/api/admin/pre-fichas/${id}`, campos)
      setLinhas((ls) => ls.map((l) => (l.id === id ? atualizada : l)))
      setSelecionada((s) => (s?.id === id ? atualizada : s))
      return true
    } catch (e) {
      console.error(e)
      alert('Não foi possível salvar a alteração.')
      return false
    }
  }

  // Recusa / fim da fila: atualiza a ficha e reordena pela entrada na fila
  function filaAlterada(atualizada) {
    setLinhas((ls) => ls.map((l) => (l.id === atualizada.id ? atualizada : l))
      .sort((a, b) => new Date(a.entrada_fila_em) - new Date(b.entrada_fila_em) || a.id - b.id))
    setSelecionada(atualizada)
  }

  const nomeNucleo = (id) => nucleos.find((n) => n.id === id)?.nome
  const coordenador = usuario.papel === 'coordenador'

  return (
    <>
      <div className="titulo-secao">
        <h1>Fila de espera</h1>
        <p className="subtitulo">
          {contagemFila.todas} pessoa(s) aguardando · ordem de entrada na fila (data da inscrição, ou de quando foi para o fim da fila)
          {prefLigada && comPreferencia > 0 && <> · <button className="link inline" onClick={() => setPreferencia('ativa')}>★ {comPreferencia} com preferência</button></>}
          {coordenador && nucleos.length > 0 && ` · ${nucleos.map((n) => n.nome).join(', ')}`}
        </p>
      </div>

      {coordenador && nucleos.length === 0 && (
        <div className="alerta-ok">Seu usuário ainda não está ligado a nenhum núcleo. Peça a um administrador para definir as suas cidades/bairros.</div>
      )}

      <nav className="abas" aria-label="Modalidades">
        {[{ valor: 'todas', rotulo: 'Todas' }, ...MODALIDADES].map((m) => (
          <button key={m.valor} className={`aba ${modalidade === m.valor ? 'ativa' : ''}`} onClick={() => setModalidade(m.valor)}>
            {m.rotulo} <span className="contador">{contagemFila[m.valor] || 0}</span>
          </button>
        ))}
      </nav>

      <div className="filtros">
        <input type="search" placeholder="Buscar por nome, e-mail, telefone, bairro ou paróquia"
          value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Status">
          <option value="fila">Na fila (aguardando + em contato)</option>
          <option value="todos">Todos os status</option>
          {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
        {prefLigada && <select value={preferencia} onChange={(e) => setPreferencia(e.target.value)} aria-label="Preferência"
          className={preferencia ? 'filtro-ativo' : ''}>
          <option value="">Preferência: todas as fichas</option>
          <option value="ativa">★ Com preferência ativa (cônjuge)</option>
          <option value="validar">Declarou que o cônjuge fez — a validar</option>
          <option value="sem">Sem preferência</option>
        </select>}
        <select value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
          <option value="fila">Ordem: posição na fila</option>
          <option value="nome">Ordem: nome (A–Z)</option>
        </select>
      </div>
      <div className="filtros">
        <SeletorNucleo nucleos={nucleos} coordenador={coordenador} valor={nucleo}
          onChange={(v) => { setNucleo(v); setCidade(''); setBairro('') }} />
        <select value={cidade} onChange={(e) => { setCidade(e.target.value); setBairro('') }} aria-label="Cidade">
          <option value="">Todas as cidades</option>
          {cidades.map((c) => <option key={c.chave} value={c.chave}>{c.nome} ({c.total})</option>)}
        </select>
        <select value={bairro} onChange={(e) => setBairro(e.target.value)} disabled={!cidade} aria-label="Bairro">
          <option value="">{cidade ? 'Todos os bairros' : 'Bairro (escolha a cidade)'}</option>
          {bairros.map((b) => <option key={b.chave} value={b.chave}>{b.nome} ({b.total})</option>)}
        </select>
        <button className="botao-secundario" onClick={recarregar} disabled={carregando}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
        <button className="botao-secundario" onClick={async () => {
          // A planilha usa todas as colunas: busca a versão completa só na hora de exportar
          try {
            const completas = new Map((await api.get('/api/admin/pre-fichas?completo=1')).map((f) => [f.id, f]))
            exportarCsv(ordenadas.map((l) => completas.get(l.id) ?? l), posicoes, nomeNucleo)
          } catch { alert('Não foi possível exportar. Tente novamente.') }
        }} disabled={!visiveis.length}>
          Exportar CSV
        </button>
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th title="Posição na fila da modalidade">Pos.</th>
              <th title="Data que define a posição. Muda quando a pessoa vai para o fim da fila.">Na fila desde</th>
              <th>Nome</th>
              <th>Idade</th>
              <th>Modalidade</th>
              <th>Cidade / bairro</th>
              <th>Telefone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.slice(0, limite).map((l) => {
              const wa = linkWhatsApp(l.telefone)
              return (
                <tr key={l.id} onClick={() => setSelecionada(l)} className="clicavel">
                  <td className="posicao">{posicoes.get(l.id) ?? '—'}</td>
                  <td className="nowrap">
                    {formatarDataHora(l.entrada_fila_em ?? l.created_at)}
                    {l.entrada_fila_em && l.entrada_fila_em !== l.created_at && (
                      <small className="dica bloco" title={`Inscrição original: ${formatarDataHora(l.created_at)}`}>
                        <span className="selo movida">fim da fila</span> inscrita {formatarDataHora(l.created_at).slice(0, 10)}
                      </small>
                    )}
                  </td>
                  <td>
                    {l.nome_completo}
                    {l.tem_conta && <span className="selo-conta" title={`Tem conta${l.conta_email ? `: ${l.conta_email}` : ''}`}> 🔑</span>}
                    {duplicados.has(l.id) && <span className="selo alerta" title="Mesmo e-mail ou telefone de outra ficha">possível duplicado</span>}
                    {prefLigada && <SeloPreferencia ficha={l} />}
                    {l.recusas_seguidas > 0 && (
                      <span className="selo recusa" title="Recusas seguidas ao ser chamada">
                        {l.recusas_seguidas} recusa{l.recusas_seguidas > 1 ? 's' : ''}
                      </span>
                    )}
                  </td>
                  <td>{calcularIdade(l.data_nascimento)}</td>
                  <td>{rotuloDe(MODALIDADES, l.modalidade)}</td>
                  <td>{l.cidade}/{l.uf}{l.bairro && <small className="dica bloco">{l.bairro}</small>}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {wa ? <a href={wa} target="_blank" rel="noreferrer">{l.telefone}</a> : l.telefone}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className={`status status-${l.status}`} value={l.status}
                      onChange={(e) => atualizar(l.id, { status: e.target.value })} aria-label="Alterar status">
                      {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
            {!carregando && !visiveis.length && (
              <tr><td colSpan={8} className="vazio">Nenhuma pré-ficha encontrada com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ordenadas.length > limite && (
        <div className="acoes">
          <button className="botao-secundario" onClick={() => setLimite((n) => n + POR_PAGINA)}>
            Mostrar mais ({limite} de {ordenadas.length})
          </button>
        </div>
      )}

      {selecionada && (
        <Detalhe
          ficha={selecionada}
          marca={marca}
          posicao={posicoes.get(selecionada.id)}
          nomeNucleo={nomeNucleo}
          onFechar={() => setSelecionada(null)}
          onSalvar={(campos) => atualizar(selecionada.id, campos)}
          onFilaAlterada={filaAlterada}
          usuario={usuario}
          todas={linhas}
          onFichaAtualizada={async (f) => {
            const lista = await recarregar()
            setSelecionada(lista?.find((x) => x.id === f.id) ?? f)
          }}
        />
      )}
    </>
  )
}
