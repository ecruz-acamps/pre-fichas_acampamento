import { useState } from 'react'
import { api } from '../lib/api.js'

/** Ativar / desativar a verificação em duas etapas (código de aplicativo autenticador). */
export default function DuasEtapas({ usuario, onAlterado }) {
  const [config, setConfig] = useState(null) // { segredo, uri } durante a ativação
  const [codigo, setCodigo] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ativo = usuario.totp_ativo

  async function acao(fn) {
    setErro(''); setOk(''); setEnviando(true)
    try { await fn() } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível concluir.') } finally { setEnviando(false) }
  }

  const iniciar = () => acao(async () => { setConfig(await api.post('/api/auth/2fa/iniciar')); setCodigo('') })
  const ativar = (e) => { e.preventDefault(); acao(async () => {
    await api.post('/api/auth/2fa/ativar', { codigo })
    setConfig(null); setOk('Verificação em duas etapas ativada. No próximo login, o código será pedido.')
    onAlterado({ ...usuario, totp_ativo: true })
  }) }
  const desativar = (e) => { e.preventDefault(); acao(async () => {
    await api.post('/api/auth/2fa/desativar', { senha })
    setSenha(''); setOk('Verificação em duas etapas desativada.')
    onAlterado({ ...usuario, totp_ativo: false })
  }) }

  const segredoFormatado = config?.segredo.match(/.{1,4}/g).join(' ')

  return (
    <section className="cartao duas-etapas">
      <h2>Verificação em duas etapas</h2>
      <p className="dica">
        Além da senha, o login pede um código de 6 números gerado no seu celular. Mesmo que alguém descubra a senha,
        não consegue entrar. {usuario.papel === 'admin' && <strong>Recomendado para administradores.</strong>}
      </p>
      <p>Situação: {ativo ? <span className="situacao ok">Ativa</span> : <span className="situacao neutra">Desligada</span>}</p>

      {!ativo && !config && (
        <button className="botao-secundario" onClick={iniciar} disabled={enviando}>Ativar verificação em duas etapas</button>
      )}

      {!ativo && config && (
        <form onSubmit={ativar}>
          <ol className="passos-2fa">
            <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
            <li>
              No aplicativo, escolha <em>adicionar conta → inserir chave manualmente</em> e digite esta chave:
              <code className="chave-2fa">{segredoFormatado}</code>
              <small className="dica bloco">No próprio celular, você também pode <a href={config.uri}>abrir direto no aplicativo</a>.</small>
            </li>
            <li>
              Digite o código de 6 números que aparece no aplicativo:
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="000000"
                className="codigo-2fa" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
            </li>
          </ol>
          <div className="acoes-linha">
            <button className="botao-principal pequeno" disabled={enviando || codigo.length !== 6}>Confirmar e ativar</button>
            <button type="button" className="link" onClick={() => setConfig(null)}>cancelar</button>
          </div>
        </form>
      )}

      {ativo && (
        <form onSubmit={desativar} className="linha-desativar">
          <input type="password" required placeholder="Sua senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <button className="botao-secundario perigo" disabled={enviando}>Desativar</button>
        </form>
      )}
      {erro && <div className="alerta-erro">{erro}</div>}
      {ok && <div className="alerta-ok">{ok}</div>}
      <p className="dica">Perdeu o celular? Um administrador pode gerar uma senha nova em Usuários — isso também desliga a verificação em duas etapas.</p>
    </section>
  )
}
