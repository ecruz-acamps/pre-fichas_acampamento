import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { PAPEIS } from '../../shared/opcoes.js'
import { formatarDataHora } from '../../shared/util.js'

function SenhaGerada({ info, onFechar }) {
  return (
    <div className="alerta-ok senha-gerada" role="status">
      <p>Senha temporária de <strong>{info.email}</strong>:</p>
      <p className="senha">{info.senha}</p>
      <p>Anote e repasse à pessoa. Ela não será mostrada novamente e deverá ser trocada no primeiro acesso.</p>
      <button className="botao-secundario" onClick={onFechar}>Entendi</button>
    </div>
  )
}

function EscolherNucleos({ nucleos, valor, onChange }) {
  if (!nucleos.length) return <p className="dica">Cadastre um núcleo (menu Núcleos) para associá-lo ao coordenador.</p>
  const alternar = (id) => onChange(valor.includes(id) ? valor.filter((n) => n !== id) : [...valor, id])
  return (
    <div className="escolha-nucleos">
      {nucleos.map((n) => (
        <label key={n.id} className={`pilula ${valor.includes(n.id) ? 'ativa' : ''}`}>
          <input type="checkbox" checked={valor.includes(n.id)} onChange={() => alternar(n.id)} /> {n.nome}
        </label>
      ))}
    </div>
  )
}

export default function Usuarios({ usuarioAtual, nucleos }) {
  const [usuarios, setUsuarios] = useState([])
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState({ email: '', nome: '', papel: 'coordenador', nucleos: [] })
  const [criando, setCriando] = useState(false)
  const [senhaGerada, setSenhaGerada] = useState(null)
  const [editandoNucleos, setEditandoNucleos] = useState(null) // { id, nucleos }

  const carregar = () => api.get('/api/admin/usuarios').then(setUsuarios).catch(() => setErro('Falha ao carregar usuários.'))
  useEffect(() => { carregar() }, [])

  async function criar(e) {
    e.preventDefault()
    setErro(''); setCriando(true)
    try {
      const r = await api.post('/api/admin/usuarios', { ...novo, nucleos: novo.papel === 'coordenador' ? novo.nucleos : [] })
      setSenhaGerada({ email: r.usuario.email, senha: r.senhaTemporaria })
      setNovo({ email: '', nome: '', papel: novo.papel, nucleos: [] })
      carregar()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível criar o usuário.')
    } finally {
      setCriando(false)
    }
  }

  async function alterar(u, campos) {
    setErro('')
    try {
      await api.patch(`/api/admin/usuarios/${u.id}`, campos)
      carregar()
      return true
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível alterar o usuário.')
      return false
    }
  }

  async function redefinir(u) {
    if (!confirm(`Gerar uma nova senha temporária para ${u.nome}? A senha atual deixará de funcionar.`)) return
    setErro('')
    try {
      const r = await api.post(`/api/admin/usuarios/${u.id}/redefinir-senha`)
      setSenhaGerada({ email: u.email, senha: r.senhaTemporaria })
      carregar()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível redefinir a senha.')
    }
  }

  const nomesNucleos = (ids) => ids.map((id) => nucleos.find((n) => n.id === id)?.nome).filter(Boolean).join(', ')

  return (
    <>
      <div className="titulo-secao">
        <h1>Usuários</h1>
        <p className="subtitulo">{PAPEIS.map((p) => `${p.rotulo}: ${p.descricao}`).join(' · ')}</p>
      </div>

      {senhaGerada && <SenhaGerada info={senhaGerada} onFechar={() => setSenhaGerada(null)} />}
      {erro && <div className="alerta-erro" role="alert">{erro}</div>}

      <form className="cartao novo-usuario" onSubmit={criar}>
        <h2>Novo usuário</h2>
        <div className="linha-form">
          <div className="campo">
            <label htmlFor="novo-nome">Nome</label>
            <input id="novo-nome" required maxLength={120} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="novo-email">E-mail</label>
            <input id="novo-email" type="email" required maxLength={200} value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="novo-papel">Papel</label>
            <select id="novo-papel" value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
              {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </div>
          <button className="botao-principal pequeno" disabled={criando}>{criando ? 'Criando…' : 'Criar'}</button>
        </div>
        {novo.papel === 'coordenador' && (
          <div className="campo">
            <label>Núcleos que este coordenador acompanha</label>
            <EscolherNucleos nucleos={nucleos} valor={novo.nucleos} onChange={(v) => setNovo({ ...novo, nucleos: v })} />
          </div>
        )}
      </form>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Núcleos</th><th>Situação</th><th>Último acesso</th><th></th></tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.ativo ? '' : 'inativo'}>
                <td>{u.nome}{u.id === usuarioAtual.id && <span className="selo info">você</span>}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.papel} onChange={(e) => alterar(u, { papel: e.target.value })}
                    disabled={u.id === usuarioAtual.id} aria-label="Papel">
                    {PAPEIS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                  </select>
                </td>
                <td>
                  {u.papel !== 'coordenador' ? <span className="dica">todos</span> : editandoNucleos?.id === u.id ? (
                    <div>
                      <EscolherNucleos nucleos={nucleos} valor={editandoNucleos.nucleos}
                        onChange={(v) => setEditandoNucleos({ id: u.id, nucleos: v })} />
                      <div className="acoes-linha">
                        <button className="botao-secundario" onClick={async () => {
                          if (await alterar(u, { nucleos: editandoNucleos.nucleos })) setEditandoNucleos(null)
                        }}>Salvar</button>
                        <button className="link" onClick={() => setEditandoNucleos(null)}>cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button className="link" onClick={() => setEditandoNucleos({ id: u.id, nucleos: u.nucleos })}>
                      {nomesNucleos(u.nucleos) || <span className="erro">nenhum — definir</span>}
                    </button>
                  )}
                </td>
                <td>{u.ativo ? (u.trocar_senha ? 'Aguardando 1º acesso' : 'Ativo') : 'Desativado'}</td>
                <td className="nowrap">{u.ultimo_login ? formatarDataHora(u.ultimo_login) : '—'}</td>
                <td className="nowrap">
                  <div className="acoes-linha">
                    <button className="botao-secundario" onClick={() => redefinir(u)}>Nova senha</button>
                    {u.id !== usuarioAtual.id && (
                      <button className="botao-secundario" onClick={() => alterar(u, { ativo: !u.ativo })}>
                        {u.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
