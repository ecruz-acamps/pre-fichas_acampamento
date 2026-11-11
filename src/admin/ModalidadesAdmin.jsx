import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { carregarModalidades } from '../lib/modalidades.js'

const VAZIO = { rotulo: '', min: 18, max: 30, casado: false }

function Formulario({ inicial, onSalvar, onCancelar, titulo }) {
  const [m, setM] = useState({ ...inicial })
  const [erros, setErros] = useState({})
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const especial = inicial.regra === 'senior' || inicial.regra === 'casais'
  async function salvar(e) {
    e.preventDefault(); setErros({}); setMsg(''); setSalvando(true)
    try { await onSalvar({ ...m, min: Number(m.min), max: Number(m.max) }) } catch (err) { setErros(err.dados?.erros ?? {}); setMsg(err.dados?.mensagem || 'Não foi possível salvar.') } finally { setSalvando(false) }
  }
  return (
    <form className="cartao" onSubmit={salvar}>
      <h3>{titulo}</h3>
      <div className="campo">
        <label htmlFor="mod-nome">Nome da modalidade</label>
        <input id="mod-nome" required maxLength={40} value={m.rotulo} onChange={(e) => setM({ ...m, rotulo: e.target.value })} />
        {erros.rotulo && <small className="erro">{erros.rotulo}</small>}
      </div>
      <div className="linha-form" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="campo">
          <label htmlFor="mod-min">{inicial.regra === 'senior' ? 'A partir de (anos)' : 'Idade mínima'}</label>
          <input id="mod-min" type="number" min="0" max="120" required value={m.min} onChange={(e) => setM({ ...m, min: e.target.value })} className="numero-curto" />
          {erros.min && <small className="erro">{erros.min}</small>}
        </div>
        {!especial && (
          <div className="campo">
            <label htmlFor="mod-max">Idade máxima</label>
            <input id="mod-max" type="number" min="0" max="200" required value={m.max} onChange={(e) => setM({ ...m, max: e.target.value })} className="numero-curto" />
            {erros.max && <small className="erro">{erros.max}</small>}
          </div>
        )}
      </div>
      {!especial && (
        <label className="check"><input type="checkbox" checked={m.casado === true} onChange={(e) => setM({ ...m, casado: e.target.checked })} /> <span>Só para casado(a) ou em união estável</span></label>
      )}
      {especial && <p className="dica">{inicial.regra === 'senior' ? 'Sênior: aceita casado(a) com 18+ ou quem tem a idade mínima acima.' : 'Casais: casado(a)/união estável, com o cônjuge já campista (conferido pelo CPF). A inscrição é feita pela área da conta.'}</p>}
      {msg && <div className="alerta-erro" role="alert">{msg}</div>}
      <div className="acoes">
        <button className="botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>{' '}
        <button type="button" className="link" onClick={onCancelar}>cancelar</button>
      </div>
    </form>
  )
}

/** Modalidades: criar, editar (nome, idades, estado civil), ordenar, desativar e excluir (só as sem uso). Só administrador. */
export default function ModalidadesAdmin() {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null)   // null | 'nova' | modalidade
  const [erro, setErro] = useState('')
  const recarregar = async () => { setLista(await api.get('/api/admin/modalidades')); await carregarModalidades() }
  useEffect(() => { recarregar().catch(() => setErro('Não foi possível carregar.')) }, [])

  const rodar = async (fn) => { setErro(''); try { await fn(); await recarregar() } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível concluir.') } }
  const mover = (i, d) => { const v = lista.map((m) => m.valor); [v[i], v[i + d]] = [v[i + d], v[i]]; return rodar(() => api.put('/api/admin/modalidades/ordem', { valores: v })) }

  if (!lista) return <p className="carregando">{erro || 'Carregando…'}</p>
  if (editando) {
    const nova = editando === 'nova'
    return (
      <Formulario titulo={nova ? 'Nova modalidade' : `Editar ${editando.rotulo}`} inicial={nova ? VAZIO : editando} onCancelar={() => setEditando(null)}
        onSalvar={async (m) => { if (nova) await api.post('/api/admin/modalidades', m); else await api.put(`/api/admin/modalidades/${editando.valor}`, { ...m, ativa: editando.ativa }); setEditando(null); await recarregar() }} />
    )
  }
  return (
    <>
      <div className="titulo-secao com-acoes">
        <div>
          <h1>Modalidades</h1>
          <p className="subtitulo">Cadastre e edite as modalidades do acampamento (nome e faixa de idade). A ordem aqui é a ordem em que aparecem no formulário e nas telas. Mudar a faixa não altera fichas já existentes.</p>
        </div>
        <div className="acoes-linha"><button className="botao-principal pequeno" onClick={() => setEditando('nova')}>+ Nova modalidade</button></div>
      </div>
      {erro && <div className="alerta-erro" role="alert">{erro}</div>}
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Ordem</th><th>Nome</th><th>Quem pode</th><th>Uso</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>
            {lista.map((m, i) => (
              <tr key={m.valor}>
                <td className="nowrap">
                  <button className="link" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${m.rotulo}`}>↑</button>{' '}
                  <button className="link" disabled={i === lista.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer ${m.rotulo}`}>↓</button>
                </td>
                <td><strong>{m.rotulo}</strong>{m.regra !== 'idade' && <small className="dica bloco">regra própria do sistema</small>}</td>
                <td>{m.faixa}</td>
                <td>{m.fichas} ficha(s) · {m.edicoes} edição(ões)</td>
                <td>{m.ativa ? <span className="selo">ativa</span> : <span className="selo alerta">desativada</span>}</td>
                <td className="nowrap">
                  <button className="botao-secundario" onClick={() => setEditando(m)}>Editar</button>{' '}
                  <button className="link" onClick={() => rodar(() => api.put(`/api/admin/modalidades/${m.valor}`, { rotulo: m.rotulo, min: m.min, max: m.max, casado: m.casado, ativa: !m.ativa }))}>{m.ativa ? 'desativar' : 'ativar'}</button>
                  {m.regra === 'idade' && !m.fichas && !m.edicoes && <> <button className="link perigo" onClick={() => confirm(`Excluir a modalidade ${m.rotulo}?`) && rodar(() => api.delete(`/api/admin/modalidades/${m.valor}`))}>excluir</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dica">Desativada: não aparece para novas inscrições nem novas edições, mas as fichas e edições antigas continuam. Excluir só é possível para modalidades sem nenhuma ficha ou edição.</p>
    </>
  )
}
