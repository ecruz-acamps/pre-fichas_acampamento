import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { formatarDataHora } from '../../shared/util.js'

const curto = (sha) => (sha ? sha.slice(0, 7) : '—')

/** O único ponto de entrada (administradores): sempre visível; destaca quando há versão nova. */
export function BotaoAtualizacao({ info, onAbrir }) {
  if (info?.desatualizado) {
    return (
      <button className="botao-atualizacao" onClick={onAbrir} title="Há uma versão nova do sistema">
        <span aria-hidden="true">⬆</span> Atualização disponível
      </button>
    )
  }
  return (
    <button className="botao-atualizacao discreto" onClick={onAbrir} title="Verificar e instalar atualizações">
      <span aria-hidden="true">⟳</span> Atualizações
    </button>
  )
}

/** Etapas mostradas durante a atualização, a partir do log do atualizador. */
function etapasDoLog(log) {
  return log.filter((l) => /^[→✓✗]/.test(l)).map((l) => l.replace(/…$/, ''))
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

export function DialogoAtualizacao({ info, onFechar, onInfo }) {
  const [fase, setFase] = useState('confirmar') // confirmar | executando | reiniciando | concluido | erro
  const [progresso, setProgresso] = useState(null)
  const [erro, setErro] = useState('')
  const [verificando, setVerificando] = useState(false)
  const ativo = useRef(true)
  useEffect(() => () => { ativo.current = false }, [])

  const instalado = info?.atualizador?.instalado
  const emAndamento = ['solicitado', 'executando'].includes(info?.atualizador?.estado?.etapa)

  // Se abrir no meio de uma atualização (ex.: outra aba), já acompanha
  useEffect(() => { if (emAndamento) acompanhar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function acompanhar() {
    setFase('executando')
    const inicio = Date.now()
    let caiu = false
    while (ativo.current) {
      await pausa(2000)
      let p
      try {
        p = await api.get('/api/admin/atualizacao/progresso')
      } catch {
        caiu = true
        setFase('reiniciando') // o sistema está sendo reiniciado com a versão nova
        continue
      }
      if (!ativo.current) return
      setProgresso(p)
      const etapa = p.estado?.etapa
      if (etapa === 'concluido') {
        if (p.estado.sucesso) {
          setFase('concluido')
          try { onInfo(await api.post('/api/admin/atualizacao/verificar')) } catch { /* segue */ }
          await pausa(2500)
          window.location.reload()
        } else {
          setFase('erro')
        }
        return
      }
      if (caiu) setFase('executando')
      if (etapa === 'solicitado' && Date.now() - inicio > 60_000) {
        setErro('O servidor ainda não começou a atualização. Verifique se o atualizador está ativo (sudo ./scripts/instalar-atualizador.sh).')
      }
    }
  }

  async function atualizar() {
    setErro('')
    try {
      await api.post('/api/admin/atualizacao/executar')
      acompanhar()
    } catch (e) {
      if (e.dados?.emAndamento) return acompanhar()
      setErro(e.dados?.mensagem || 'Não foi possível iniciar a atualização.')
    }
  }

  async function verificar() {
    setVerificando(true)
    try { onInfo(await api.post('/api/admin/atualizacao/verificar')) } catch { /* mantém */ } finally { setVerificando(false) }
  }

  const etapas = etapasDoLog(progresso?.log ?? [])
  const fechavel = !['executando', 'reiniciando', 'concluido'].includes(fase)

  return (
    <div className="modal-fundo centro-tela" onClick={() => fechavel && onFechar()}>
      <div className="dialogo-atualizacao cartao" role="dialog" aria-modal="true" aria-label="Atualização do sistema" onClick={(e) => e.stopPropagation()}>
        {fase === 'confirmar' && (
          <>
            <h2>{info?.desatualizado ? 'Atualização disponível' : 'Atualizações do sistema'}</h2>
            <p className="dica">
              Instalada: versão {info?.instalada?.versao ?? '—'} <code>{curto(info?.instalada?.commit)}</code>
              {info?.disponivel?.commit && <> · Mais recente: <code>{curto(info.disponivel.commit)}</code></>}
              {info?.verificado_em && <> · verificado em {formatarDataHora(info.verificado_em)}</>}
            </p>
            {info?.erro && <div className="alerta-aviso">{info.erro}</div>}

            {info?.desatualizado ? (
              <>
                {info.novidades?.length > 0 && (
                  <>
                    <h3>O que há de novo ({info.commits_atras})</h3>
                    <ul className="lista-novidades">
                      {info.novidades.map((n) => <li key={n.commit}>{n.mensagem}</li>)}
                    </ul>
                  </>
                )}
                {instalado ? (
                  <p className="dica">
                    Leva alguns minutos. Antes de começar é feito um <strong>backup automático</strong> e todos os dados
                    são mantidos. O sistema fica fora do ar por alguns instantes no final.
                  </p>
                ) : (
                  <div className="alerta-aviso">
                    A atualização pelo painel ainda não foi ativada neste servidor. Peça a quem administra a máquina para
                    rodar uma única vez, na pasta da instalação: <code>sudo ./scripts/instalar-atualizador.sh</code>
                    {' '}— ou atualizar pelo terminal com <code>sudo ./scripts/atualizar.sh</code>.
                  </div>
                )}
                {erro && <div className="alerta-erro">{erro}</div>}
                <div className="linha-acoes">
                  <button className="botao-secundario" onClick={onFechar}>Agora não</button>
                  <button className="botao-principal pequeno" onClick={atualizar} disabled={!instalado}>Atualizar agora</button>
                </div>
              </>
            ) : (
              <>
                {info?.desatualizado === false && <div className="alerta-ok">O sistema está na versão mais recente.</div>}
                <div className="linha-acoes">
                  <button className="botao-secundario" onClick={verificar} disabled={verificando}>{verificando ? 'Verificando…' : 'Verificar agora'}</button>
                  <button className="botao-principal pequeno" onClick={onFechar}>Fechar</button>
                </div>
              </>
            )}
          </>
        )}

        {['executando', 'reiniciando'].includes(fase) && (
          <>
            <h2>Atualizando o sistema…</h2>
            <p className="dica">Não feche esta janela. Isso leva alguns minutos.</p>
            <ol className="etapas-atualizacao">
              {(etapas.length ? etapas : ['→ Aguardando o servidor iniciar a atualização']).map((e, i, todas) => (
                <li key={i} className={i === todas.length - 1 && fase === 'executando' ? 'atual' : 'feita'}>{e.replace(/^[→✓✗]\s*/, '')}</li>
              ))}
              {fase === 'reiniciando' && <li className="atual">Reiniciando o sistema com a versão nova</li>}
            </ol>
            <div className="barra-progresso"><span /></div>
            {erro && <div className="alerta-aviso">{erro}</div>}
          </>
        )}

        {fase === 'concluido' && (
          <>
            <h2>✓ Sistema atualizado</h2>
            <p>{progresso?.estado?.mensagem}</p>
            <p className="dica">Recarregando o painel…</p>
          </>
        )}

        {fase === 'erro' && (
          <>
            <h2>A atualização não foi concluída</h2>
            <div className="alerta-erro">{progresso?.estado?.mensagem || 'Ocorreu um erro.'}</div>
            <p className="dica">O sistema continua funcionando na versão anterior. Detalhes técnicos:</p>
            <pre className="log-atualizacao">{(progresso?.log ?? []).join('\n')}</pre>
            <div className="linha-acoes">
              <button className="botao-principal pequeno" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
