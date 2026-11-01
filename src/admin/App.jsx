import { useEffect, useState } from 'react'
import { supabase, supabaseConfigurado } from '../lib/supabase.js'
import Login from './Login.jsx'
import Fila from './Fila.jsx'
import NovaSenha from './NovaSenha.jsx'

// Link de convite ou de recuperação de senha: pede para definir a senha.
const veioDeLinkDeSenha = /type=(invite|recovery)/.test(window.location.hash)

export default function App() {
  const [sessao, setSessao] = useState(undefined) // undefined = carregando
  const [autorizado, setAutorizado] = useState(null)
  const [definirSenha, setDefinirSenha] = useState(veioDeLinkDeSenha)

  useEffect(() => {
    if (!supabaseConfigurado) return
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s)
      if (evento === 'PASSWORD_RECOVERY') setDefinirSenha(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = sessao?.user?.id
  useEffect(() => {
    if (!userId) { setAutorizado(null); return }
    supabase.rpc('is_admin').then(({ data, error }) => setAutorizado(!error && data === true))
  }, [userId])

  if (!supabaseConfigurado) {
    return (
      <main className="pagina estreita">
        <div className="cartao">
          <h2>Configuração pendente</h2>
          <p>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja o README).</p>
        </div>
      </main>
    )
  }

  if (sessao === undefined || (sessao && autorizado === null)) {
    return <main className="pagina estreita"><p className="carregando">Carregando…</p></main>
  }

  if (!sessao) return <Login />

  if (definirSenha) return <NovaSenha onConcluir={() => setDefinirSenha(false)} />

  if (!autorizado) {
    return (
      <main className="pagina estreita">
        <div className="cartao">
          <h2>Acesso não autorizado</h2>
          <p>
            A conta <strong>{sessao.user.email}</strong> não tem permissão para ver a fila de espera.
            Peça a um administrador para liberar seu acesso.
          </p>
          <button className="botao-secundario" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </main>
    )
  }

  return <Fila usuario={sessao.user} />
}
