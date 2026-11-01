import { useState } from 'react'
import { api } from '../lib/api.js'

export default function Login({ marca, onEntrar }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    try {
      const { usuario } = await api.post('/api/auth/login', { email, senha })
      onEntrar(usuario)
    } catch (err) {
      setCarregando(false)
      setErro(err.status === 429
        ? 'Muitas tentativas. Aguarde um minuto e tente novamente.'
        : err.dados?.mensagem || 'Não foi possível entrar.')
    }
  }

  return (
    <main className="pagina estreita">
      <form className="cartao login" onSubmit={entrar}>
        {marca?.logoUrl && <img className="logo" src={marca.logoUrl} alt="" />}
        <h1>Fila de espera</h1>
        <p className="subtitulo">{marca?.nome ? `${marca.nome} · ` : ''}acesso restrito à equipe.</p>
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="senha">Senha</label>
          <input id="senha" type="password" autoComplete="current-password" required value={senha}
            onChange={(e) => setSenha(e.target.value)} />
        </div>
        {erro && <div className="alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="botao-principal" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
        </div>
        <p className="dica centro">Esqueceu a senha? Peça a um administrador para redefini-la.</p>
      </form>
    </main>
  )
}
