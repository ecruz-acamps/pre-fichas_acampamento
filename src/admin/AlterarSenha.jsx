import { useState } from 'react'
import { api } from '../lib/api.js'
import DuasEtapas from './DuasEtapas.jsx'

export default function AlterarSenha({ primeiroAcesso = false, onConcluir, onSair, usuario, onUsuario }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (nova.length < 8) return setErro('A nova senha deve ter pelo menos 8 caracteres.')
    if (nova !== confirmacao) return setErro('A confirmação não confere com a nova senha.')
    setSalvando(true)
    try {
      await api.post('/api/auth/senha', { senhaAtual: atual, novaSenha: nova })
      onConcluir()
    } catch (err) {
      setSalvando(false)
      setErro(err.dados?.mensagem || 'Não foi possível alterar a senha.')
    }
  }

  const formulario = (
    <form className="cartao login" onSubmit={salvar}>
      <h1>{primeiroAcesso ? 'Crie sua senha' : 'Alterar senha'}</h1>
      <p className="subtitulo">
        {primeiroAcesso
          ? 'Você entrou com uma senha temporária. Defina uma senha pessoal para continuar.'
          : 'Ao alterar, as suas outras sessões abertas serão encerradas.'}
      </p>
      <div className="campo">
        <label htmlFor="senha-atual">{primeiroAcesso ? 'Senha temporária' : 'Senha atual'}</label>
        <input id="senha-atual" type="password" autoComplete="current-password" required value={atual}
          onChange={(e) => setAtual(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor="nova-senha">Nova senha</label>
        <input id="nova-senha" type="password" autoComplete="new-password" required value={nova}
          onChange={(e) => setNova(e.target.value)} />
        <small className="dica">Mínimo de 8 caracteres.</small>
      </div>
      <div className="campo">
        <label htmlFor="confirmar-senha">Confirmar nova senha</label>
        <input id="confirmar-senha" type="password" autoComplete="new-password" required value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)} />
      </div>
      {erro && <div className="alerta-erro" role="alert">{erro}</div>}
      <div className="acoes">
        <button className="botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar senha'}</button>
      </div>
      {onSair && <button type="button" className="link" onClick={onSair}>Sair</button>}
    </form>
  )

  if (primeiroAcesso) return <main className="pagina estreita">{formulario}</main>
  return (
    <div className="estreito">
      {formulario}
      {usuario && <DuasEtapas usuario={usuario} onAlterado={onUsuario} />}
    </div>
  )
}
