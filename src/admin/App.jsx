import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { carregarMarca } from '../lib/marca.jsx'
import Login from './Login.jsx'
import Fila from './Fila.jsx'
import Resumo from './Resumo.jsx'
import Acampamentos from './Acampamentos.jsx'
import Nucleos from './Nucleos.jsx'
import Usuarios from './Usuarios.jsx'
import Configuracoes from './Configuracoes.jsx'
import Auditoria from './Auditoria.jsx'
import Nomes from './Nomes.jsx'
import AlterarSenha from './AlterarSenha.jsx'
import Ativacao from './Ativacao.jsx'

// Telas do painel e quem pode ver cada uma
const TELAS = [
  { id: 'fila', rotulo: 'Fila', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'nomes', rotulo: 'Nomes (A–Z)', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'resumo', rotulo: 'Resumo por cidade', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'acampamentos', rotulo: 'Acampamentos', papeis: ['admin', 'equipe'] },
  { id: 'auditoria', rotulo: 'Auditoria', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'nucleos', rotulo: 'Núcleos', papeis: ['admin'] },
  { id: 'usuarios', rotulo: 'Usuários', papeis: ['admin'] },
  { id: 'configuracoes', rotulo: 'Configurações', papeis: ['admin'] },
]

export default function App() {
  const [usuario, setUsuario] = useState(undefined) // undefined = carregando
  const [licencaAtivada, setLicencaAtivada] = useState(true)
  const [marca, setMarca] = useState(null)
  const [nucleos, setNucleos] = useState([])
  const [tela, setTela] = useState('fila')

  const carregarUsuario = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/eu')
      setUsuario(r.usuario ?? null)
      setLicencaAtivada(r.licencaAtivada !== false)
    } catch {
      setUsuario(null)
    }
  }, [])

  const recarregarNucleos = useCallback(() => api.get('/api/admin/nucleos').then(setNucleos).catch(() => {}), [])

  useEffect(() => { carregarUsuario(); carregarMarca().then(setMarca).catch(() => {}) }, [carregarUsuario])
  useEffect(() => {
    if (usuario && !usuario.trocar_senha && licencaAtivada) recarregarNucleos()
  }, [usuario, licencaAtivada, recarregarNucleos])

  useEffect(() => {
    const pendente = () => setLicencaAtivada(false)
    window.addEventListener('licenca-pendente', pendente)
    return () => window.removeEventListener('licenca-pendente', pendente)
  }, [])

  useEffect(() => {
    const expirou = () => setUsuario(null)
    window.addEventListener('sessao-expirada', expirou)
    return () => window.removeEventListener('sessao-expirada', expirou)
  }, [])

  async function sair() {
    await api.post('/api/auth/logout').catch(() => {})
    setUsuario(null)
    setTela('fila')
  }

  if (usuario === undefined) return <main className="pagina estreita"><p className="carregando">Carregando…</p></main>
  if (!usuario) {
    return <Login marca={marca} onEntrar={(r) => { setUsuario(r.usuario); setLicencaAtivada(r.licencaAtivada !== false); setTela('fila') }} />
  }
  if (usuario.trocar_senha) {
    return <AlterarSenha primeiroAcesso onConcluir={() => setUsuario({ ...usuario, trocar_senha: false })} onSair={sair} />
  }
  // Depois da instalação e do primeiro acesso, o sistema pede a chave de ativação
  if (!licencaAtivada) {
    return <Ativacao marca={marca} usuario={usuario} onSair={sair} onAtivado={() => { setLicencaAtivada(true); setTela('fila') }} />
  }

  const telas = TELAS.filter((t) => t.papeis.includes(usuario.papel))
  const atual = telas.some((t) => t.id === tela) || tela === 'senha' ? tela : 'fila'
  const props = { usuario, marca, nucleos }

  return (
    <div className="painel">
      <header className="painel-cabecalho">
        <div className="marca-painel">
          {marca?.logoUrl && <img src={marca.logoUrl} alt="" />}
          <div>
            <strong>{marca?.nomeCurto ?? 'Pré-fichas'}</strong>
            <span>Fila de espera</span>
          </div>
        </div>
        <div className="painel-usuario">
          <span title={usuario.email}>
            {usuario.nome}
            <small> · {usuario.papel === 'coordenador' ? 'coordenador(a)' : usuario.papel}</small>
          </span>
          <button className="link" onClick={() => setTela('senha')}>Alterar senha</button>
          <button className="botao-secundario" onClick={sair}>Sair</button>
        </div>
      </header>

      <nav className="menu" aria-label="Seções do painel">
        {telas.map((t) => (
          <button key={t.id} className={`aba ${atual === t.id ? 'ativa' : ''}`} onClick={() => setTela(t.id)}>{t.rotulo}</button>
        ))}
      </nav>

      {atual === 'fila' && <Fila {...props} />}
      {atual === 'nomes' && <Nomes {...props} />}
      {atual === 'resumo' && <Resumo {...props} />}
      {atual === 'acampamentos' && <Acampamentos {...props} />}
      {atual === 'auditoria' && <Auditoria {...props} />}
      {atual === 'nucleos' && <Nucleos {...props} onAlterar={recarregarNucleos} />}
      {atual === 'usuarios' && <Usuarios {...props} usuarioAtual={usuario} />}
      {atual === 'configuracoes' && <Configuracoes {...props} onSalvar={(m) => setMarca(m)} />}
      {atual === 'senha' && <AlterarSenha onConcluir={() => setTela('fila')} />}
    </div>
  )
}
