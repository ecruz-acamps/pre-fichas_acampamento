import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [modoRecuperar, setModoRecuperar] = useState(false)
  const [aviso, setAviso] = useState('')

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setAviso(''); setCarregando(true)
    if (modoRecuperar) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/admin/`,
      })
      setCarregando(false)
      if (error) setErro('Não foi possível enviar o e-mail de recuperação.')
      else setAviso('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.')
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setCarregando(false)
    if (error) setErro('E-mail ou senha incorretos.')
  }

  return (
    <main className="pagina estreita">
      <form className="cartao login" onSubmit={entrar}>
        <h1>Fila de espera</h1>
        <p className="subtitulo">Acesso restrito à equipe do acampamento.</p>
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        {!modoRecuperar && (
          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="password" autoComplete="current-password" required value={senha}
              onChange={(e) => setSenha(e.target.value)} />
          </div>
        )}
        {erro && <div className="alerta-erro" role="alert">{erro}</div>}
        {aviso && <div className="alerta-ok">{aviso}</div>}
        <div className="acoes">
          <button className="botao-principal" disabled={carregando}>
            {carregando ? 'Aguarde…' : modoRecuperar ? 'Enviar link' : 'Entrar'}
          </button>
        </div>
        <button type="button" className="link" onClick={() => { setModoRecuperar(!modoRecuperar); setErro(''); setAviso('') }}>
          {modoRecuperar ? 'Voltar ao login' : 'Esqueci minha senha'}
        </button>
      </form>
    </main>
  )
}
