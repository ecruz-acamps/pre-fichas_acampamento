import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function NovaSenha({ onConcluir }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (senha.length < 8) return setErro('A senha deve ter pelo menos 8 caracteres.')
    if (senha !== confirmacao) return setErro('As senhas não conferem.')
    setSalvando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setSalvando(false)
    if (error) return setErro('Não foi possível salvar a nova senha.')
    window.history.replaceState(null, '', window.location.pathname)
    onConcluir()
  }

  return (
    <main className="pagina estreita">
      <form className="cartao login" onSubmit={salvar}>
        <h1>Definir senha</h1>
        <p className="subtitulo">Crie uma senha para acessar a fila de espera.</p>
        <div className="campo">
          <label htmlFor="nova-senha">Nova senha</label>
          <input id="nova-senha" type="password" autoComplete="new-password" value={senha}
            onChange={(e) => setSenha(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="confirmar-senha">Confirmar senha</label>
          <input id="confirmar-senha" type="password" autoComplete="new-password" value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)} />
        </div>
        {erro && <div className="alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar senha'}</button>
        </div>
      </form>
    </main>
  )
}
