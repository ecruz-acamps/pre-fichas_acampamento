import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Login from './Login.jsx'
import Fila from './Fila.jsx'
import AlterarSenha from './AlterarSenha.jsx'
import Usuarios from './Usuarios.jsx'

export default function App() {
  const [usuario, setUsuario] = useState(undefined) // undefined = carregando
  const [tela, setTela] = useState('fila')

  const carregarUsuario = useCallback(async () => {
    try {
      const { usuario } = await api.get('/api/auth/eu')
      setUsuario(usuario ?? null)
    } catch {
      setUsuario(null)
    }
  }, [])

  useEffect(() => { carregarUsuario() }, [carregarUsuario])

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
  if (!usuario) return <Login onEntrar={(u) => { setUsuario(u); setTela('fila') }} />

  if (usuario.trocar_senha) {
    return (
      <AlterarSenha
        primeiroAcesso
        onConcluir={() => setUsuario({ ...usuario, trocar_senha: false })}
        onSair={sair}
      />
    )
  }

  const menu = (
    <div className="painel-usuario">
      <span>{usuario.nome}</span>
      {tela !== 'fila' && <button className="botao-secundario" onClick={() => setTela('fila')}>Fila</button>}
      {usuario.papel === 'admin' && tela !== 'usuarios' && (
        <button className="botao-secundario" onClick={() => setTela('usuarios')}>Usuários</button>
      )}
      {tela !== 'senha' && <button className="botao-secundario" onClick={() => setTela('senha')}>Alterar senha</button>}
      <button className="botao-secundario" onClick={sair}>Sair</button>
    </div>
  )

  if (tela === 'senha') {
    return <AlterarSenha menu={menu} onConcluir={() => setTela('fila')} />
  }
  if (tela === 'usuarios' && usuario.papel === 'admin') {
    return <Usuarios menu={menu} usuarioAtual={usuario} />
  }
  return <Fila menu={menu} />
}
