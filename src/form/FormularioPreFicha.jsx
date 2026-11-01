import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, supabaseConfigurado } from '../lib/supabase.js'
import { buscarCep } from '../lib/viacep.js'
import {
  COMO_CONHECEU, ESTADOS_CIVIS, MODALIDADES, RELIGIOES, SEXOS, UFS,
} from '../lib/opcoes.js'
import {
  calcularIdade, mascaraCep, mascaraTelefone, modalidadesCompativeis, somenteDigitos,
} from '../lib/util.js'

const WHATSAPP = import.meta.env.VITE_WHATSAPP_CONTATO || '5548996954410'

const INICIAL = {
  nome_completo: '', data_nascimento: '', estado_civil: '', sexo: '', profissao: '',
  telefone: '', responsavel_nome: '', responsavel_telefone: '',
  religiao: '', religiao_outra: '',
  batizado: null, primeira_eucaristia: null, crismado: null,
  paroquia: '', participa_pastoral: null, pastoral_qual: '',
  email: '', instagram: '', facebook: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  como_conheceu: '', como_conheceu_outro: '', motivo: '', modalidade: '',
  possui_vicio: null, vicio_qual: '', restricoes_medicas: '', retiros_anteriores: '',
  aceite_lgpd: false, aceite_atividades: false, aceite_lista_espera: false,
  website: '', // honeypot anti-robô (fica escondido)
}

function validar(f, idade) {
  const e = {}
  const obrig = (campo, msg = 'Campo obrigatório.') => {
    const v = f[campo]
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) e[campo] = msg
  }

  obrig('nome_completo')
  if (!e.nome_completo && f.nome_completo.trim().split(/\s+/).length < 2)
    e.nome_completo = 'Informe nome e sobrenome.'
  obrig('data_nascimento')
  if (!e.data_nascimento && (idade == null || idade < 5 || idade > 110))
    e.data_nascimento = 'Data de nascimento inválida.'
  obrig('estado_civil')
  obrig('sexo')
  obrig('telefone')
  if (!e.telefone && somenteDigitos(f.telefone).length < 10)
    e.telefone = 'Informe o telefone com DDD.'

  if (idade != null && idade < 18) {
    obrig('responsavel_nome', 'Obrigatório para menores de 18 anos.')
    obrig('responsavel_telefone', 'Obrigatório para menores de 18 anos.')
    if (!e.responsavel_telefone && somenteDigitos(f.responsavel_telefone).length < 10)
      e.responsavel_telefone = 'Informe o telefone com DDD.'
  }

  obrig('religiao')
  if (f.religiao === 'Outra') obrig('religiao_outra', 'Qual religião?')
  obrig('batizado', 'Selecione uma opção.')
  obrig('primeira_eucaristia', 'Selecione uma opção.')
  obrig('crismado', 'Selecione uma opção.')
  obrig('participa_pastoral', 'Selecione uma opção.')
  if (f.participa_pastoral) obrig('pastoral_qual', 'Qual pastoral?')

  obrig('email')
  if (!e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'E-mail inválido.'

  obrig('cep')
  if (!e.cep && somenteDigitos(f.cep).length !== 8) e.cep = 'CEP inválido.'
  obrig('cidade')
  obrig('uf')

  obrig('como_conheceu')
  if (f.como_conheceu === 'Outro') obrig('como_conheceu_outro', 'Conte como conheceu.')
  obrig('motivo')
  obrig('modalidade', 'Escolha a modalidade.')
  if (!e.modalidade && idade != null && !modalidadesCompativeis(idade, f.estado_civil).includes(f.modalidade))
    e.modalidade = 'Esta modalidade não corresponde à sua idade / estado civil.'

  obrig('possui_vicio', 'Selecione uma opção.')
  if (f.possui_vicio) obrig('vicio_qual', 'Qual vício?')

  if (!f.aceite_lgpd) e.aceite_lgpd = 'É necessário aceitar.'
  if (!f.aceite_atividades) e.aceite_atividades = 'É necessário aceitar.'
  if (!f.aceite_lista_espera) e.aceite_lista_espera = 'É necessário aceitar.'
  return e
}

function montarRegistro(f) {
  const t = (v) => (v ?? '').trim() || null
  const menor = calcularIdade(f.data_nascimento) < 18
  return {
    nome_completo: f.nome_completo.trim().replace(/\s+/g, ' '),
    data_nascimento: f.data_nascimento,
    estado_civil: f.estado_civil,
    sexo: f.sexo,
    profissao: t(f.profissao),
    telefone: f.telefone.trim(),
    responsavel_nome: menor ? t(f.responsavel_nome) : null,
    responsavel_telefone: menor ? t(f.responsavel_telefone) : null,
    religiao: f.religiao === 'Outra' ? `Outra: ${f.religiao_outra.trim()}` : f.religiao,
    batizado: f.batizado,
    primeira_eucaristia: f.primeira_eucaristia,
    crismado: f.crismado,
    paroquia: t(f.paroquia),
    participa_pastoral: f.participa_pastoral,
    pastoral_qual: f.participa_pastoral ? t(f.pastoral_qual) : null,
    email: f.email.trim().toLowerCase(),
    instagram: t(f.instagram),
    facebook: t(f.facebook),
    cep: somenteDigitos(f.cep),
    logradouro: t(f.logradouro),
    numero: t(f.numero),
    complemento: t(f.complemento),
    bairro: t(f.bairro),
    cidade: f.cidade.trim(),
    uf: f.uf,
    como_conheceu: f.como_conheceu === 'Outro' ? `Outro: ${f.como_conheceu_outro.trim()}` : f.como_conheceu,
    motivo: f.motivo.trim(),
    modalidade: f.modalidade,
    possui_vicio: f.possui_vicio,
    vicio_qual: f.possui_vicio ? t(f.vicio_qual) : null,
    restricoes_medicas: t(f.restricoes_medicas),
    retiros_anteriores: t(f.retiros_anteriores),
    aceite_lgpd: f.aceite_lgpd,
    aceite_atividades: f.aceite_atividades,
    aceite_lista_espera: f.aceite_lista_espera,
  }
}

/* ---------- componentes de campo ---------- */

function Campo({ id, rotulo, erro, obrigatorio, dica, children }) {
  return (
    <div className={`campo ${erro ? 'com-erro' : ''}`}>
      {rotulo && (
        <label htmlFor={id}>
          {rotulo}
          {obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {dica && !erro && <small className="dica">{dica}</small>}
      {erro && <small className="erro" id={`${id}-erro`}>{erro}</small>}
    </div>
  )
}

function SimNao({ id, rotulo, valor, onChange, erro }) {
  return (
    <fieldset className={`campo sim-nao ${erro ? 'com-erro' : ''}`} id={id}>
      <legend>{rotulo}<span className="obrigatorio" aria-hidden="true"> *</span></legend>
      <div className="opcoes-inline">
        <label className={`pilula ${valor === true ? 'ativa' : ''}`}>
          <input type="radio" name={id} checked={valor === true} onChange={() => onChange(true)} /> Sim
        </label>
        <label className={`pilula ${valor === false ? 'ativa' : ''}`}>
          <input type="radio" name={id} checked={valor === false} onChange={() => onChange(false)} /> Não
        </label>
      </div>
      {erro && <small className="erro">{erro}</small>}
    </fieldset>
  )
}

/* ---------- formulário ---------- */

export default function FormularioPreFicha() {
  const [f, setF] = useState(INICIAL)
  const [erros, setErros] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [cepStatus, setCepStatus] = useState({ carregando: false, msg: '' })
  const formRef = useRef(null)

  const idade = useMemo(() => calcularIdade(f.data_nascimento), [f.data_nascimento])
  const compativeis = useMemo(() => modalidadesCompativeis(idade, f.estado_civil), [idade, f.estado_civil])
  const menor = idade != null && idade < 18

  const set = (campo) => (valorOuEvento) => {
    const v = valorOuEvento?.target
      ? (valorOuEvento.target.type === 'checkbox' ? valorOuEvento.target.checked : valorOuEvento.target.value)
      : valorOuEvento
    setF((anterior) => ({ ...anterior, [campo]: v }))
    if (erros[campo]) setErros((anterior) => ({ ...anterior, [campo]: undefined }))
  }

  // Se só existe uma modalidade compatível, já sugere ela.
  useEffect(() => {
    if (compativeis.length === 1 && !f.modalidade) setF((a) => ({ ...a, modalidade: compativeis[0] }))
  }, [compativeis, f.modalidade])

  // Consulta ViaCEP quando o CEP fica completo.
  const cepDigitos = somenteDigitos(f.cep)
  useEffect(() => {
    if (cepDigitos.length !== 8) { setCepStatus({ carregando: false, msg: '' }); return }
    const ctrl = new AbortController()
    setCepStatus({ carregando: true, msg: '' })
    buscarCep(cepDigitos, { signal: ctrl.signal })
      .then((end) => {
        setF((a) => ({
          ...a,
          logradouro: end.logradouro || a.logradouro,
          bairro: end.bairro || a.bairro,
          cidade: end.cidade || a.cidade,
          uf: end.uf || a.uf,
        }))
        setErros((a) => ({ ...a, cep: undefined, cidade: undefined, uf: undefined }))
        setCepStatus({ carregando: false, msg: '' })
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setCepStatus({ carregando: false, msg: err.message })
      })
    return () => ctrl.abort()
  }, [cepDigitos])

  async function enviar(ev) {
    ev.preventDefault()
    setErroEnvio('')
    const e = validar(f, idade)
    setErros(e)
    const primeiro = Object.keys(e).find((k) => e[k])
    if (primeiro) {
      const el = formRef.current?.querySelector(`#${primeiro}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus?.({ preventScroll: true })
      return
    }

    // Robôs costumam preencher campos escondidos: finge sucesso e não envia.
    if (f.website) { setEnviado(true); return }

    if (!supabaseConfigurado) {
      setErroEnvio('Sistema ainda não configurado (variáveis do Supabase ausentes).')
      return
    }

    setEnviando(true)
    const { error } = await supabase.from('pre_fichas').insert(montarRegistro(f))
    setEnviando(false)
    if (error) {
      console.error(error)
      setErroEnvio('Não foi possível enviar sua pré-ficha. Verifique sua conexão e tente novamente.')
      return
    }
    setEnviado(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (enviado) {
    return (
      <div className="cartao sucesso">
        <div className="icone-sucesso" aria-hidden="true">✓</div>
        <h2>Pré-ficha enviada!</h2>
        <p>
          Obrigado, <strong>{f.nome_completo.split(' ')[0]}</strong>. Você entrou na
          <strong> lista de espera</strong>. A ordem é definida pela data e hora do envio.
        </p>
        <p>Quando chegar a sua vez, alguém da equipe entrará em contato pelo telefone informado.</p>
        <p className="rodape-texto">
          Dúvidas? WhatsApp:{' '}
          <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer">{mascaraTelefone(WHATSAPP.replace(/^55/, ''))}</a>
        </p>
      </div>
    )
  }

  return (
    <form ref={formRef} className="cartao" onSubmit={enviar} noValidate>
      {/* honeypot */}
      <div className="honeypot" aria-hidden="true">
        <label>Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>

      <section>
        <h2>Dados pessoais</h2>
        <Campo id="nome_completo" rotulo="Nome e sobrenome" obrigatorio erro={erros.nome_completo}>
          <input id="nome_completo" autoComplete="name" value={f.nome_completo} onChange={set('nome_completo')} maxLength={150} />
        </Campo>
        <div className="linha">
          <Campo id="data_nascimento" rotulo="Data de nascimento" obrigatorio erro={erros.data_nascimento}
            dica={idade != null && idade >= 0 ? `${idade} anos` : undefined}>
            <input id="data_nascimento" type="date" autoComplete="bday" value={f.data_nascimento}
              max={new Date().toISOString().slice(0, 10)} onChange={set('data_nascimento')} />
          </Campo>
          <Campo id="sexo" rotulo="Sexo" obrigatorio erro={erros.sexo}>
            <select id="sexo" value={f.sexo} onChange={set('sexo')}>
              <option value="">Selecione</option>
              {SEXOS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        <div className="linha">
          <Campo id="estado_civil" rotulo="Estado civil" obrigatorio erro={erros.estado_civil}>
            <select id="estado_civil" value={f.estado_civil} onChange={set('estado_civil')}>
              <option value="">Selecione</option>
              {ESTADOS_CIVIS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </Campo>
          <Campo id="profissao" rotulo="Profissão" erro={erros.profissao}>
            <input id="profissao" value={f.profissao} onChange={set('profissao')} maxLength={120} />
          </Campo>
        </div>
        <Campo id="telefone" rotulo="Telefone / WhatsApp" obrigatorio erro={erros.telefone}
          dica="É por este número que entraremos em contato quando chegar a sua vez.">
          <input id="telefone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="(48) 99999-9999"
            value={f.telefone} onChange={(e) => set('telefone')(mascaraTelefone(e.target.value))} />
        </Campo>
        {menor && (
          <div className="destaque">
            <p>Como o(a) campista é menor de 18 anos, informe um responsável:</p>
            <div className="linha">
              <Campo id="responsavel_nome" rotulo="Nome do responsável" obrigatorio erro={erros.responsavel_nome}>
                <input id="responsavel_nome" value={f.responsavel_nome} onChange={set('responsavel_nome')} maxLength={150} />
              </Campo>
              <Campo id="responsavel_telefone" rotulo="Telefone do responsável" obrigatorio erro={erros.responsavel_telefone}>
                <input id="responsavel_telefone" type="tel" inputMode="numeric" placeholder="(48) 99999-9999"
                  value={f.responsavel_telefone}
                  onChange={(e) => set('responsavel_telefone')(mascaraTelefone(e.target.value))} />
              </Campo>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Informações religiosas</h2>
        <div className="linha">
          <Campo id="religiao" rotulo="Religião" obrigatorio erro={erros.religiao}>
            <select id="religiao" value={f.religiao} onChange={set('religiao')}>
              <option value="">Selecione</option>
              {RELIGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Campo>
          {f.religiao === 'Outra' && (
            <Campo id="religiao_outra" rotulo="Qual?" obrigatorio erro={erros.religiao_outra}>
              <input id="religiao_outra" value={f.religiao_outra} onChange={set('religiao_outra')} maxLength={70} />
            </Campo>
          )}
        </div>
        <div className="linha tres">
          <SimNao id="batizado" rotulo="Batizado(a)?" valor={f.batizado} onChange={set('batizado')} erro={erros.batizado} />
          <SimNao id="primeira_eucaristia" rotulo="Primeira eucaristia?" valor={f.primeira_eucaristia}
            onChange={set('primeira_eucaristia')} erro={erros.primeira_eucaristia} />
          <SimNao id="crismado" rotulo="Crismado(a)?" valor={f.crismado} onChange={set('crismado')} erro={erros.crismado} />
        </div>
        <Campo id="paroquia" rotulo="Qual paróquia frequenta?" erro={erros.paroquia}>
          <input id="paroquia" value={f.paroquia} onChange={set('paroquia')} maxLength={150} />
        </Campo>
        <SimNao id="participa_pastoral" rotulo="Participa de alguma pastoral?" valor={f.participa_pastoral}
          onChange={set('participa_pastoral')} erro={erros.participa_pastoral} />
        {f.participa_pastoral && (
          <Campo id="pastoral_qual" rotulo="Qual pastoral?" obrigatorio erro={erros.pastoral_qual}>
            <input id="pastoral_qual" value={f.pastoral_qual} onChange={set('pastoral_qual')} maxLength={150} />
          </Campo>
        )}
      </section>

      <section>
        <h2>Contato</h2>
        <Campo id="email" rotulo="E-mail" obrigatorio erro={erros.email}>
          <input id="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} maxLength={200} />
        </Campo>
        <div className="linha">
          <Campo id="instagram" rotulo="Instagram" erro={erros.instagram}>
            <input id="instagram" placeholder="@seuperfil" value={f.instagram} onChange={set('instagram')} maxLength={100} />
          </Campo>
          <Campo id="facebook" rotulo="Facebook" erro={erros.facebook}>
            <input id="facebook" placeholder="Nome ou link do perfil" value={f.facebook} onChange={set('facebook')} maxLength={150} />
          </Campo>
        </div>
      </section>

      <section>
        <h2>Endereço</h2>
        <div className="linha">
          <Campo id="cep" rotulo="CEP" obrigatorio erro={erros.cep || cepStatus.msg}
            dica={cepStatus.carregando ? 'Buscando endereço…' : 'O endereço é preenchido automaticamente.'}>
            <input id="cep" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000"
              value={f.cep} onChange={(e) => set('cep')(mascaraCep(e.target.value))} />
          </Campo>
          <Campo id="numero" rotulo="Número" erro={erros.numero}>
            <input id="numero" value={f.numero} onChange={set('numero')} maxLength={20} />
          </Campo>
        </div>
        <Campo id="logradouro" rotulo="Rua / logradouro" erro={erros.logradouro}>
          <input id="logradouro" autoComplete="address-line1" value={f.logradouro} onChange={set('logradouro')} maxLength={200} />
        </Campo>
        <div className="linha">
          <Campo id="complemento" rotulo="Complemento" erro={erros.complemento}>
            <input id="complemento" value={f.complemento} onChange={set('complemento')} maxLength={100} />
          </Campo>
          <Campo id="bairro" rotulo="Bairro" erro={erros.bairro}>
            <input id="bairro" value={f.bairro} onChange={set('bairro')} maxLength={100} />
          </Campo>
        </div>
        <div className="linha cidade-uf">
          <Campo id="cidade" rotulo="Cidade" obrigatorio erro={erros.cidade}>
            <input id="cidade" autoComplete="address-level2" value={f.cidade} onChange={set('cidade')} maxLength={100} />
          </Campo>
          <Campo id="uf" rotulo="UF" obrigatorio erro={erros.uf}>
            <select id="uf" value={f.uf} onChange={set('uf')}>
              <option value="">--</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Campo>
        </div>
      </section>

      <section>
        <h2>Acampamento</h2>
        <Campo id="como_conheceu" rotulo="Como conheceu o acampamento?" obrigatorio erro={erros.como_conheceu}>
          <select id="como_conheceu" value={f.como_conheceu} onChange={set('como_conheceu')}>
            <option value="">Selecione</option>
            {COMO_CONHECEU.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        {f.como_conheceu === 'Outro' && (
          <Campo id="como_conheceu_outro" rotulo="Conte como conheceu" obrigatorio erro={erros.como_conheceu_outro}>
            <input id="como_conheceu_outro" value={f.como_conheceu_outro} onChange={set('como_conheceu_outro')} maxLength={180} />
          </Campo>
        )}
        <Campo id="motivo" rotulo="Por que deseja participar do acampamento?" obrigatorio erro={erros.motivo}>
          <textarea id="motivo" rows={4} value={f.motivo} onChange={set('motivo')} maxLength={2000} />
        </Campo>
        <fieldset className={`campo ${erros.modalidade ? 'com-erro' : ''}`} id="modalidade" tabIndex={-1}>
          <legend>Qual modalidade deseja fazer?<span className="obrigatorio" aria-hidden="true"> *</span></legend>
          <div className="modalidades">
            {MODALIDADES.map((m) => {
              const desabilitada = idade != null && !compativeis.includes(m.valor)
              return (
                <label key={m.valor}
                  className={`modalidade ${f.modalidade === m.valor ? 'ativa' : ''} ${desabilitada ? 'desabilitada' : ''}`}>
                  <input type="radio" name="modalidade" value={m.valor} disabled={desabilitada}
                    checked={f.modalidade === m.valor} onChange={() => set('modalidade')(m.valor)} />
                  <strong>{m.rotulo}</strong>
                  <span>{m.faixa}</span>
                </label>
              )
            })}
          </div>
          {idade == null && <small className="dica">Informe a data de nascimento para ver as modalidades disponíveis.</small>}
          {erros.modalidade && <small className="erro">{erros.modalidade}</small>}
        </fieldset>
      </section>

      <section>
        <h2>Informações adicionais</h2>
        <SimNao id="possui_vicio" rotulo="Possui algum vício?" valor={f.possui_vicio}
          onChange={set('possui_vicio')} erro={erros.possui_vicio} />
        {f.possui_vicio && (
          <Campo id="vicio_qual" rotulo="Qual?" obrigatorio erro={erros.vicio_qual}>
            <input id="vicio_qual" value={f.vicio_qual} onChange={set('vicio_qual')} maxLength={200} />
          </Campo>
        )}
        <Campo id="restricoes_medicas" rotulo="Restrições médicas" erro={erros.restricoes_medicas}
          dica="Alergias, medicamentos de uso contínuo, condições de saúde etc. Deixe em branco se não houver.">
          <textarea id="restricoes_medicas" rows={3} value={f.restricoes_medicas} onChange={set('restricoes_medicas')} maxLength={1000} />
        </Campo>
        <Campo id="retiros_anteriores" rotulo="Retiros que já participou" erro={erros.retiros_anteriores}>
          <textarea id="retiros_anteriores" rows={3} value={f.retiros_anteriores} onChange={set('retiros_anteriores')} maxLength={1000} />
        </Campo>
      </section>

      <section className="termos">
        <label className={`check ${erros.aceite_lgpd ? 'com-erro' : ''}`} id="aceite_lgpd">
          <input type="checkbox" checked={f.aceite_lgpd} onChange={set('aceite_lgpd')} />
          <span>Autorizo o uso dos meus dados pessoais exclusivamente para fins do acampamento, sem exposição pública.</span>
        </label>
        <label className={`check ${erros.aceite_atividades ? 'com-erro' : ''}`} id="aceite_atividades">
          <input type="checkbox" checked={f.aceite_atividades} onChange={set('aceite_atividades')} />
          <span>
            Entendo que durante o acampamento são realizadas atividades físicas moderadas. Por questões de
            segurança, não é permitida a participação de gestantes ou pessoas com restrições médicas graves.
          </span>
        </label>
        <label className={`check ${erros.aceite_lista_espera ? 'com-erro' : ''}`} id="aceite_lista_espera">
          <input type="checkbox" checked={f.aceite_lista_espera} onChange={set('aceite_lista_espera')} />
          <span>
            Entendo que estou entrando em uma <strong>lista de espera</strong> e que o preenchimento dessa
            pré-ficha não significa que estarei automaticamente participando do próximo acampamento.
            Compreendo que quando chegar a minha vez de participar, alguém irá entrar em contato comigo por telefone.
          </span>
        </label>
        {(erros.aceite_lgpd || erros.aceite_atividades || erros.aceite_lista_espera) && (
          <small className="erro">Marque todas as declarações para continuar.</small>
        )}
      </section>

      {erroEnvio && <div className="alerta-erro" role="alert">{erroEnvio}</div>}

      <div className="acoes">
        <button type="submit" className="botao-principal" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar ficha de inscrição'}
        </button>
      </div>

      <p className="rodape-texto">
        Ao enviar a ficha de inscrição, você concorda com os termos e condições do acampamento.<br />
        Em caso de dúvidas, entre em contato através do WhatsApp:{' '}
        <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noreferrer">{mascaraTelefone(WHATSAPP.replace(/^55/, ''))}</a>.
      </p>
    </form>
  )
}
