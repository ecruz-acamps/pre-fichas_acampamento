import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FormularioPreFicha from './FormularioPreFicha.jsx'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '../styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="pagina">
      <header className="cabecalho">
        <h1>Pré-ficha de inscrição</h1>
        <p>
          Preencha seus dados para entrar na <strong>lista de espera</strong> do acampamento.
          A ordem da fila segue a data e hora de envio da pré-ficha.
        </p>
      </header>
      <FormularioPreFicha />
    </main>
  </StrictMode>,
)
