import { useState } from 'react'
import { api } from '../lib/api.js'

export default function Login({ marca, onEntrar, onEsqueci }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pedeCodigo, setPedeCodigo] = useState(false)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    try {
      onEntrar(await api.post('/api/auth/login', { email, senha, ...(pedeCodigo ? { codigo } : {}) }))
    } catch (err) {
      setCarregando(false)
      if (err.dados?.precisa2fa) {
        setPedeCodigo(true)
        if (pedeCodigo) setErro(err.dados.mensagem)
        return
      }
      setErro(err.dados?.mensagem || (err.status === 429
        ? 'Muitas tentativas. Aguarde um minuto e tente novamente.'
        : 'Não foi possível entrar.'))
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
        {pedeCodigo && (
          <div className="campo">
            <label htmlFor="codigo">Código do aplicativo autenticador</label>
            <input id="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required
              placeholder="000000" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
            <small className="dica">Abra o aplicativo (Google Authenticator, Microsoft Authenticator…) e digite os 6 números.</small>
          </div>
        )}
        {erro && <div className="alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="botao-principal" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
        </div>
        <p className="centro"><button type="button" className="link" onClick={onEsqueci}>Esqueci minha senha</button></p>
        <p className="dica centro">Perdeu o celular do autenticador? Peça a um administrador para redefinir o seu acesso.</p>
      </form>
    </main>
  )
}
