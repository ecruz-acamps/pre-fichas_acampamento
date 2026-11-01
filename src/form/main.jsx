import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FormularioPreFicha from './FormularioPreFicha.jsx'
import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { TextoMarca, useMarca } from '../lib/marca.jsx'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '../styles.css'

function Pagina() {
  const { marca, erro } = useMarca()
  const [ativado, setAtivado] = useState(null)
  useEffect(() => { api.get('/api/licenca').then((r) => setAtivado(r.ativada)).catch(() => setAtivado(true)) }, [])
  if (erro) {
    return <main className="pagina"><div className="alerta-erro">Não foi possível carregar o formulário. Tente novamente em instantes.</div></main>
  }
  if (!marca || ativado === null) return <main className="pagina"><p className="carregando">Carregando…</p></main>
  return (
    <main className="pagina">
      <header className="cabecalho">
        {marca.logoUrl && <img className="logo" src={marca.logoUrl} alt={marca.nome} />}
        <p className="nome-acampamento">{marca.nome}</p>
        <h1>{marca.tituloFormulario}</h1>
        <p><TextoMarca texto={marca.textoFormulario} /></p>
      </header>
      {ativado ? <FormularioPreFicha marca={marca} /> : (
        <div className="cartao sucesso">
          <h2>Inscrições em breve</h2>
          <p>O formulário de pré-ficha ainda não está disponível. Volte em breve.</p>
        </div>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><Pagina /></StrictMode>)
