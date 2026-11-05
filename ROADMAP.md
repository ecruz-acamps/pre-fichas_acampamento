# Roadmap

## Versão 1.0 — entregue (branch `v1`)

Sistema de pré-fichas e fila de espera, instalado no servidor de cada acampamento:

- Formulário público de pré-ficha (computador e celular), com a marca de cada acampamento.
- Fila de espera por modalidade, núcleos e coordenadores, resumo por cidade e bairro, lista de nomes (A–Z).
- Regras da fila: recusas → fim da fila, preferência do cônjuge, registro dos acampamentos e tribos.
- Auditoria, usuários e papéis, configurações da marca, ativação por chave.
- Atualização pelo painel com um botão ("Atualização disponível").

Detalhes no [README](README.md) e no [manual de instalação](docs/INSTALACAO.md).

---

## Versão 2.0 — atual (branch `main`)

Vários acampamentos na mesma VM, administrados por um **painel central**:

- Painel central: criar instâncias pelo navegador, situação do servidor e das instâncias, atualizar uma ou todas, backup e auditoria.
- Instalação híbrida: publicação pela Cloudflare (túnel), direta (proxy HTTPS compartilhado com Let's Encrypt) ou rede local.
- Ordem de implantação: 1) painel central, que prepara a VM; 2) acampamentos.
- Contas dos participantes (CPF/e-mail), ficha impressa personalizável, VPN FortiClient para servidor remoto, melhorias de performance.

Lista completa no [CHANGELOG](CHANGELOG.md).

---

## Versão 3.0 — planejada: app Android e iOS para os neocampistas

> Melhoria registrada na issue [#3](https://github.com/ecruz-acamps/pre-fichas_acampamento/issues/3) — acompanhe por lá.

### Objetivo

Um aplicativo para **quem ainda vai fazer o acampamento** se cadastrar e **acompanhar a sua inscrição**
enquanto espera na fila — que costuma durar meses.

### Por que um app (e não só o formulário)

Só o formulário não justifica a instalação (o link resolve) e tende a ser recusado pela Apple. O app ganha
sentido ao acompanhar a pessoa durante a espera:

- **Situação da inscrição**: "Na lista de espera", "Em contato", "Confirmado".
- **Notificação quando chegar a vez** ("a equipe vai te ligar nos próximos dias").
- **Atualizar telefone e endereço** — evita perder quem troca de número.
- **Confirmar interesse** de tempos em tempos, limpando a fila de quem desistiu.
- **Desistir pelo app**, com registro na auditoria.
- Informações do acampamento: o que levar, contatos, Instagram.

### Como vai funcionar

- **Um único app para todos os acampamentos.** A pessoa escolhe o acampamento numa lista (arquivo no GitHub com
  nome, cidade e endereço de cada instalação) ou chega por link/QR code divulgado no Instagram. O app assume o nome,
  as cores e as declarações daquele acampamento.
- **Mesma conta do site.** A versão 2.0 já tem contas dos participantes (CPF ou e-mail + senha), com situação da
  inscrição, edição dos dados, desistência e nova inscrição. O app usa essa conta, e não um código de acompanhamento separado.
- Mesmo formulário e mesmas regras do site; pode preencher sem internet e enviar depois.

### Etapas

| Fase | O quê | Onde | Prazo estimado |
|---|---|---|---|
| 1 | Código de acompanhamento, página pública de acompanhamento, atualizar dados, desistir, confirmar interesse | este repositório (servidor e site) | 1–2 semanas |
| 2 | App Android e iOS (React Native/Expo): escolher acampamento, formulário, acompanhamento, notificações | repositório novo `pre-fichas-app` | 6–8 semanas |
| 3 | Publicação na App Store e no Google Play, ajustes da revisão | `pre-fichas-app` | 2–4 semanas |

Boa parte da fase 1 já existe pelo site desde a 2.0: situação, atualizar dados, desistir e posição na fila opcional. Falta a API pública versionada e as notificações.

### Mudanças necessárias no servidor (fase 1)

- Geração do código de acompanhamento ao enviar a pré-ficha.
- API pública **com versão fixa** (`/api/v1/...`), porque cada acampamento pode estar numa versão diferente do servidor:
  consultar situação, atualizar dados, desistir, confirmar interesse — com limite de tentativas e registro na auditoria.
- Cadastro do aparelho para notificações e envio automático quando a equipe muda o status.

### Organização do código

O app fica num **repositório separado** (`pre-fichas-app`). Se ficasse na `main` deste repositório, cada ajuste no
app dispararia o aviso "Atualização disponível" em todos os servidores e o código do app seria baixado neles sem uso.
As mudanças de servidor que o app precisa continuam aqui, em branches e PRs normais.

### Pontos de atenção

- **Menores de idade (Mirim e FAC):** a LGPD exige consentimento do responsável para menores de 12 anos; no app, o
  cadastro de menores deve ser feito pelo responsável, com declaração específica.
- **Lojas:** Apple Developer (US$ 99/ano, conta de organização com CNPJ e número D-U-N-S); Google Play (US$ 25, uma vez).
  Ambas exigem política de privacidade, exclusão de dados pelo app e um acampamento de demonstração para a revisão.
- **Notificações** passam pelos serviços do Google e da Apple (via Expo, sem chaves guardadas nos servidores).

### Decisões pendentes

1. ~~A pessoa vê a posição na fila?~~ Decidido na 2.0: é uma opção em Configurações.
2. Quem será o **dono das contas nas lojas** (uma organização para todos os acampamentos ou cada acampamento)?
3. Nome do app e identidade nas lojas.
