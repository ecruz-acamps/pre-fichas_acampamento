# Pré-fichas do Acampamento · Fila de espera

**Versão 2.0** · Sistema para receber as pré-fichas de novos campistas e organizar a **fila de espera**
por ordem de chegada (data e hora do envio). Quem se inscreveu primeiro tem preferência.

Roda **no seu servidor Linux** (on-premises), com os dados sob o seu controle. Uma única VM pode hospedar
**vários acampamentos**, cada um com banco, usuários, backups e marca próprios. Eles são administrados por
um **painel central** e publicados pela **Cloudflare**, **direto** (domínio próprio com HTTPS) ou **só na
rede local**.

| Endereço | Para quem |
|---|---|
| **`/`** | Participante: criar conta, fazer a pré-ficha, acompanhar e atualizar os dados (funciona no celular) |
| **`/admin/`** | Equipe do acampamento: fila, fichas, acampamentos, núcleos, usuários e configurações |
| **Painel central** (`:9090`, só pela VPN) | Responsável pela VM: cria e atualiza os acampamentos do servidor |

> 📘 **Como usar:** [`docs/MANUAL-DE-USO.md`](docs/MANUAL-DE-USO.md) ·
> 🛠️ **Instalação detalhada:** [`docs/INSTALACAO.md`](docs/INSTALACAO.md) ·
> 📝 **O que mudou:** [`CHANGELOG.md`](CHANGELOG.md) ·
> 🗺️ **Próximos passos:** [`ROADMAP.md`](ROADMAP.md)

| Camada | Tecnologia |
|---|---|
| Site | React + Vite (arquivos estáticos) |
| Servidor / API | Node.js 22 + Fastify |
| Banco de dados | PostgreSQL 16 (um por acampamento) |
| HTTPS | Caddy compartilhado com **Let's Encrypt** automático, ou **Cloudflare Tunnel** (cloudflared) |
| Implantação | Docker Compose (imagem pronta no GitHub) ou systemd, sem Docker |
| Painel central | Node.js sem dependências + executor do sistema (systemd) |

## Novidades da versão 2.0

- **Painel central da VM:** cria acampamentos pelo navegador, mostra a situação de cada um e do servidor, atualiza um ou todos, faz backup e mantém uma auditoria.
- **Vários acampamentos na mesma VM**, de forma **híbrida**: cada um pode ser publicado pela Cloudflare, direto ou só na rede local.
- **Instalador com ordem de implantação:** 1) painel central, que prepara a VM; 2) acampamentos.
- **VPN FortiClient (IPsec)** para administrar um servidor remoto e fechar a porta 22.
- **Ficha impressa** no formato de pré-inscrição, com cabeçalho personalizável.
- **Performance:** a fila com 20 mil fichas abre em 1 s, antes levava 22 s.

A versão 1.0 continua disponível na branch [`v1`](../../tree/v1). Veja a [seção Versões](#versões).

---

## Instalação

### Requisitos
- VM **Linux** (Ubuntu 22.04/24.04 ou Debian 12) com acesso de administrador (`sudo`).
- Uma VM de **4 vCPU, 16 GB de RAM e 120 GB de disco** comporta com folga de **8 a 12 acampamentos**. Cada um
  usa cerca de 300 a 500 MB de memória.
- Para publicar **direto**: IP público (por exemplo, NAT 1:1) e as portas **80/443** livres. Para a **Cloudflare**: nenhuma porta aberta.

### Passo 1 — Painel central (primeiro)

```bash
curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
```

Escolha **1) Painel central**. O instalador prepara a VM:

1. instala o Docker e as ferramentas;
2. **VPN FortiClient**, para acessar o painel e o servidor remotamente (opcional);
3. **Cloudflare**: domínio base e token da API, para os acampamentos publicados pelo túnel;
4. **Let's Encrypt**: e-mail para os certificados dos acampamentos diretos;
5. **E-mail de envio** (Gmail com senha de app), usado no "Esqueci minha senha" de cada acampamento;
6. **Painel central**: cria o seu usuário e mostra **a senha e a chave do autenticador uma única vez**.

As etapas 2 a 5 podem ser puladas com ENTER e configuradas depois. O **token da Cloudflare**, por exemplo, pode ser colado a qualquer momento na aba **Configurações** do painel central, sem reinstalar.

### Passo 2 — Acampamentos

Abra o painel (no endereço HTTPS informado na instalação, por exemplo `https://painel.seudominio.com.br`, **sem VPN**; ou
`http://IP-DA-VM:9090` na rede interna), entre com a senha e o código do autenticador e use a aba
**Nova instância**: nome, publicação, administrador e chave de ativação (opcional). A criação leva alguns
minutos. Ao final aparece o endereço e a **senha temporária** do administrador do acampamento.

Também dá para criar pelo terminal, com o mesmo comando do passo 1, escolhendo **2) Um acampamento**.
Esse caminho também serve para um servidor com **um acampamento só**, sem painel central.

### Como publicar cada acampamento

| Publicação | Endereço | O que precisa |
|---|---|---|
| **Cloudflare** | `NOME.movimentocampista.com.br` | Token da API da Cloudflare (*Conta › Cloudflare Tunnel › Editar*, *Zona › DNS › Editar* e *Zona › Zona › Ler*). O DNS e o HTTPS são criados sozinhos, **sem abrir portas**, e **todos os acampamentos usam um único túnel** da VM. |
| **Direta** | Domínio próprio | Um **registro A** do domínio apontando para o IP público da VM. Todos os diretos usam **um proxy HTTPS compartilhado** (Caddy) e o certificado do **Let's Encrypt** é emitido e renovado sozinho. |
| **Só rede local** | `http://IP:8180` (porta livre) | Nada. Fica sem HTTPS, por isso não é indicado para a internet. |

A publicação pela Cloudflare pode ser **ligada e desligada depois** no painel do acampamento:
**Configurações → Publicação na internet**.

**DNS para publicação direta:**
- Crie no provedor do domínio um registro `A` com nome `prefichas` e valor `IP.PÚBLICO.DA.VM`. Vários
  acampamentos podem usar o **mesmo IP**.
- Se o DNS estiver na Cloudflare, deixe a nuvem **cinza ("Somente DNS")**.
- Não crie registro `AAAA` se a VM não recebe conexões por IPv6.
- Confira com `dig +short prefichas.seudominio.com.br` antes de instalar. Detalhes no
  [manual de instalação](docs/INSTALACAO.md), seção 11e.

### Portas e firewall

| Sentido | Porta | Para quê |
|---|---|---|
| Entrada | **TCP 80 e 443** (UDP 443 opcional) | Acampamentos **diretos**: site com HTTPS e emissão do certificado. Não é necessário se todos forem pela Cloudflare. |
| Entrada | TCP 22 | SSH, **somente do IP do administrador ou pela VPN**. Pode ser fechada depois da instalação (veja abaixo). |
| Entrada | TCP 9090 | Painel central, **somente a partir das redes da VPN**. Nunca libere para a internet. |
| Saída | TCP 443 | GitHub e imagem pronta (atualizações), Let's Encrypt, Cloudflare, ViaCEP |
| Saída | TCP 465/587 | E-mail de recuperação de senha |
| Saída | UDP 500 e 4500 | VPN IPsec com o FortiGate |

**Nunca libere** 5432 (banco de dados) nem 3000+ (aplicações). Eles atendem só dentro da VM.

### Servidor remoto: VPN e porta 22 fechada

```bash
sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh configurar   # FortiClient + perfil IPsec + reconexão
sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh status
sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh fechar-ssh   # 22 só pela VPN (recusa se a VPN estiver fora)
```

- A instalação do FortiClient confere a assinatura do repositório oficial da Fortinet.
- Só as redes internas passam pelo túnel; o site continua saindo pela internet normal.
- Emergência (VPN fora e SSH fechado): pelo console da VM, rode `vpn-fortinet.sh abrir-ssh`.
- Plano B, se o FortiClient não mantiver o túnel IPsec sem tela: `scripts/vpn-ipsec-strongswan.sh`.

Detalhes e o que pedir ao analista de segurança: [manual de instalação](docs/INSTALACAO.md), seção 11d.

### Versões

| Branch | Versão |
|---|---|
| **`main`** (padrão) | **2.x**. É a que o instalador instala e o botão **Atualizações** acompanha. |
| **`v1`** | **1.0 preservada** (um acampamento por instalação), só para correções pontuais |

Para instalar a versão 1:
```bash
curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/v1/instalar.sh | sudo PREFICHAS_BRANCH=v1 bash
```
Para manter um servidor existente na 1.0, veja a seção 11g do [manual de instalação](docs/INSTALACAO.md).

---

## Telas

> Capturas da versão 2.0 funcionando, com a marca genérica **Acampamento Exemplo** e **dados fictícios** de demonstração.

<table>
<tr>
<td width="32%" valign="top"><strong>Formulário no celular</strong><br /><img src="docs/imagens/07-formulario-celular-preenchido.webp" alt="Formulário de pré-ficha no celular" /></td>
<td valign="top"><strong>Fila de espera (administrador)</strong><br /><img src="docs/imagens/09-painel-fila-de-espera.webp" alt="Fila de espera com selos de preferência, recusa e fim da fila" />
<br /><br /><strong>Ficha com preferência do cônjuge</strong> · <strong>Atualização pelo painel</strong><br />
<img src="docs/imagens/11-painel-ficha-completa-conjuge-preferencia.webp" alt="Ficha completa com cônjuge e preferência" width="260" /> <img src="docs/imagens/30-painel-janela-atualizacao.webp" alt="Janela de atualização" width="440" /></td>
</tr>
</table>

<details>
<summary><strong>Modalidade Casais</strong></summary>

<p><em>Ao escolher Casais, o formulário pede o CPF do cônjuge</em><br />
<img src="docs/imagens/45-casais-campo-cpf-do-conjuge.webp" alt="Campo do CPF do cônjuge na modalidade Casais" width="300" /></p>

<p><em>Cônjuge que não é campista cadastrado: a inscrição é recusada (mensagem neutra)</em><br />
<img src="docs/imagens/46-casais-recusa-conjuge-nao-campista.webp" alt="Recusa quando o cônjuge não é campista" width="300" /></p>

<p><em>Quando o acampamento exige o Sênior, a opção só abre para quem já fez</em><br />
<img src="docs/imagens/47-casais-bloqueado-sem-senior.webp" alt="Casais bloqueado para quem não fez o Sênior" width="300" /></p>

<p><em>Configurações: "Para a modalidade Casais é necessário ter feito o Sênior?" Sim ou Não</em><br />
<img src="docs/imagens/48-configuracoes-casais.webp" alt="Menu Sim/Não nas Configurações" /></p>

</details>

<details>
<summary><strong>Participante: entrada, conta e área</strong></summary>

<p><em>Tela de entrada (página inicial)</em><br />
<img src="docs/imagens/32-participante-entrar.webp" alt="Tela de entrada: CPF ou e-mail e senha" width="300" /></p>

<p><em>Criar conta</em><br />
<img src="docs/imagens/33-participante-criar-conta.webp" alt="Criar conta com CPF, e-mail e senha" width="300" /></p>

<p><em>Minha área: situação, posição na fila, editar dados e desistir</em><br />
<img src="docs/imagens/34-participante-minha-area.webp" alt="Área do participante" width="300" /></p>

</details>

<details>
<summary><strong>Impressão da pré-ficha</strong></summary>

<p><em>Ficha impressa (A4), com cabeçalho personalizável</em><br />
<img src="docs/imagens/35-ficha-impressa.webp" alt="Ficha de pré-inscrição impressa" width="520" /></p>

<p><em>Configurações → Impressão da ficha</em><br />
<img src="docs/imagens/36-configuracoes-impressao-da-ficha.webp" alt="Configuração do cabeçalho da impressão" /></p>

</details>

<details>
<summary><strong>Painel central da VM (versão 2.0)</strong></summary>

<p><em>Instâncias e situação do servidor</em><br />
<img src="docs/imagens/37-painel-central-instancias.webp" alt="Painel central: instâncias e servidor" /></p>

<p><em>Nova instância (acampamento)</em><br />
<img src="docs/imagens/38-painel-central-nova-instancia.webp" alt="Painel central: nova instância" /></p>

<p><em>Entrada com senha e código do autenticador</em><br />
<img src="docs/imagens/40-painel-central-entrar.webp" alt="Painel central: login com autenticador" width="500" /></p>

<p><em>Configurações: colar o token da Cloudflare (conferido antes de ser guardado)</em><br />
<img src="docs/imagens/41-painel-central-configuracoes.webp" alt="Painel central: aba Configurações com o token da Cloudflare" /></p>

<p><em>Configurações: VPN do servidor (situação, reconectar e troca de credenciais com retorno automático)</em><br />
<img src="docs/imagens/42-painel-central-vpn-strongswan.webp" alt="Painel central: VPN do servidor" /></p>

<p><em>Publicação na internet pela Cloudflare (painel do acampamento)</em><br />
<img src="docs/imagens/39-configuracoes-publicacao-cloudflare.webp" alt="Ligar ou desligar a publicação pela Cloudflare" /></p>

</details>

<details>
<summary><strong>Formulário da pré-ficha</strong></summary>

<p><em>Formulário no computador</em><br />
<img src="docs/imagens/05-formulario-computador.webp" alt="Formulário no computador" width="700" /></p>

<p><em>Avisos de campos obrigatórios</em><br />
<img src="docs/imagens/06-formulario-validacao-campos.webp" alt="Avisos de campos obrigatórios" width="700" /></p>

<p><em>Mensagem após o envio</em><br />
<img src="docs/imagens/08-formulario-celular-enviado.webp" alt="Mensagem após o envio" width="300" /></p>

<p><em>"Inscrições em breve" — antes da ativação do sistema</em><br />
<img src="docs/imagens/01-formulario-inscricoes-em-breve.webp" alt=""Inscrições em breve" — antes da ativação do sistema" width="300" /></p>

</details>

<details>
<summary><strong>Primeiro acesso e ativação</strong></summary>

<p><em>Login da equipe</em><br />
<img src="docs/imagens/02-painel-login.webp" alt="Login da equipe" width="700" /></p>

<p><em>Troca obrigatória da senha temporária</em><br />
<img src="docs/imagens/03-painel-primeiro-acesso-troca-senha.webp" alt="Troca obrigatória da senha temporária" width="700" /></p>

<p><em>Ativação do sistema com a chave XXX-0000</em><br />
<img src="docs/imagens/04-painel-ativacao-chave.webp" alt="Ativação do sistema com a chave XXX-0000" width="700" /></p>

</details>

<details>
<summary><strong>Fila de espera e ficha</strong></summary>

<p><em>Fila com selos: ★ preferência, recusa, fim da fila, possível duplicado</em><br />
<img src="docs/imagens/09-painel-fila-de-espera.webp" alt="Fila com selos: ★ preferência, recusa, fim da fila, possível duplicado" /></p>

<p><em>Filtro "Preferência"</em><br />
<img src="docs/imagens/10-painel-fila-filtro-preferencia.webp" alt="Filtro "Preferência"" /></p>

<p><em>Ficha: cônjuge vinculado e preferência para o 25º e 26º</em><br />
<img src="docs/imagens/11-painel-ficha-completa-conjuge-preferencia.webp" alt="Ficha: cônjuge vinculado e preferência para o 25º e 26º" width="400" /></p>

<p><em>Ficha: 2 recusas → fim da fila, com a trilha de auditoria</em><br />
<img src="docs/imagens/12-painel-ficha-recusas-fim-da-fila-historico.webp" alt="Ficha: 2 recusas → fim da fila, com a trilha de auditoria" width="400" /></p>

<p><em>Registrar recusa (comentário obrigatório)</em><br />
<img src="docs/imagens/13-painel-registrar-recusa.webp" alt="Registrar recusa (comentário obrigatório)" /></p>

</details>

<details>
<summary><strong>Nomes, resumo, acampamentos e auditoria</strong></summary>

<p><em>Nomes (A–Z): pré-fichas e campistas</em><br />
<img src="docs/imagens/14-painel-nomes-a-z.webp" alt="Nomes (A–Z): pré-fichas e campistas" /></p>

<p><em>Resumo por cidade e bairro, por modalidade</em><br />
<img src="docs/imagens/15-painel-resumo-por-cidade-e-bairro.webp" alt="Resumo por cidade e bairro, por modalidade" /></p>

<p><em>Acampamentos realizados</em><br />
<img src="docs/imagens/16-painel-acampamentos.webp" alt="Acampamentos realizados" /></p>

<p><em>Edição do acampamento: quem fez e a cor da tribo</em><br />
<img src="docs/imagens/17-painel-acampamento-participantes-tribos.webp" alt="Edição do acampamento: quem fez e a cor da tribo" /></p>

<p><em>Auditoria</em><br />
<img src="docs/imagens/18-painel-auditoria.webp" alt="Auditoria" /></p>

</details>

<details>
<summary><strong>Núcleos, usuários e configurações</strong></summary>

<p><em>Núcleos e suas áreas</em><br />
<img src="docs/imagens/19-painel-nucleos.webp" alt="Núcleos e suas áreas" /></p>

<p><em>Dividir cidade por bairros (ex.: Palhoça em 4 núcleos)</em><br />
<img src="docs/imagens/20-painel-dividir-palhoca-por-bairros.webp" alt="Dividir cidade por bairros (ex.: Palhoça em 4 núcleos)" /></p>

<p><em>Usuários e papéis (senha temporária gerada)</em><br />
<img src="docs/imagens/21-painel-usuarios.webp" alt="Usuários e papéis (senha temporária gerada)" /></p>

<p><em>Configurações: marca, textos, declarações, regras da fila e tribos</em><br />
<img src="docs/imagens/22-painel-configuracoes-marca.webp" alt="Configurações: marca, textos, declarações, regras da fila e tribos" /></p>

</details>

<details>
<summary><strong>Coordenador de núcleo</strong></summary>

<p><em>Fila apenas do núcleo</em><br />
<img src="docs/imagens/23-coordenador-fila-do-nucleo.webp" alt="Fila apenas do núcleo" /></p>

<p><em>Nomes: pré-fichas do núcleo e todos os campistas</em><br />
<img src="docs/imagens/24-coordenador-nomes-prefichas-e-campistas.webp" alt="Nomes: pré-fichas do núcleo e todos os campistas" /></p>

<p><em>Campista de outro núcleo em modo consulta</em><br />
<img src="docs/imagens/25-coordenador-campista-outro-nucleo-consulta.webp" alt="Campista de outro núcleo em modo consulta" width="400" /></p>

</details>

<details>
<summary><strong>Atualização pelo painel</strong></summary>

<p><em>Botão "Atualização disponível" (aparece só quando há versão nova)</em><br />
<img src="docs/imagens/29-painel-botao-atualizacao-disponivel.webp" alt="Botão "Atualização disponível" (aparece só quando há versão nova)" /></p>

<p><em>O que há de novo e "Atualizar agora"</em><br />
<img src="docs/imagens/30-painel-janela-atualizacao.webp" alt="O que há de novo e "Atualizar agora"" /></p>

<p><em>Andamento da atualização</em><br />
<img src="docs/imagens/31-painel-atualizando.webp" alt="Andamento da atualização" /></p>

</details>

<details>
<summary><strong>Celular</strong></summary>

<p><em>Painel no celular</em><br />
<img src="docs/imagens/26-celular-painel-fila.webp" alt="Painel no celular" width="300" /></p>


</details>

## Funcionalidades

**Participante (página inicial)**
- **Tela de entrada:** CPF ou e-mail + senha, "Esqueci minha senha" (link por e-mail, válido por 1 hora e de uso único) e "Crie uma aqui".
- Com a conta, a pessoa:
  - faz a inscrição;
  - vê a situação e, se o acampamento quiser, a **posição na fila**;
  - **edita os próprios dados** sem perder a posição (cada alteração fica na auditoria);
  - **desiste da vaga**;
  - **se inscreve de novo** com os dados preenchidos.
- **Outra modalidade:** quem fez o Juvenil entra na fila do Sênior quando tem os requisitos; repetir a modalidade já feita é bloqueado.
- **Contas antigas:** importação por planilha CSV. A pessoa cria a senha pelo "Esqueci minha senha".

**Formulário da pré-ficha**
- Dados pessoais, religiosos, contato, endereço (o CEP preenche sozinho), acampamento, saúde e declarações configuráveis. O texto aceito fica gravado na ficha.
- Modalidade validada pela idade e pelo estado civil; responsável para menores de 18 anos.
- **Modalidade Casais:** pede o **CPF do cônjuge**, que precisa já ser campista cadastrado no sistema (senão a inscrição é recusada). Em Configurações, o administrador escolhe se **os dois precisam ter feito o Sênior** (Sim ou Não, conforme a regra de cada acampamento).
- Proteção contra robôs, limites de envio e CAPTCHA opcional.

**Fila de espera (painel)**
- Fila por modalidade com a **posição**, filtros (núcleo, cidade, bairro, status, preferência), busca (inclusive por CPF), selos (🔑 tem conta, possível duplicado, ★ preferência, recusas), WhatsApp direto e exportação CSV.
- **Ficha completa:** histórico, conta do participante (vincular ficha antiga pelo CPF), observações internas.
- **Recusas e fim da fila:** automático após N recusas seguidas, ou manual com motivo.
- **🖨 Imprimir a pré-ficha** no formato de ficha de pré-inscrição, com **cabeçalho personalizável** (logos e textos). Cada impressão fica registrada.
- **Nomes (A–Z)** e **Resumo por cidade e bairro**.

**Acampamentos, cônjuges e núcleos**
- Cadastro de cada edição, registro de **quem fez** e da **tribo** (cores configuráveis).
- **Preferência do cônjuge** (pode ser ligada ou desligada): quem faz a edição N dá preferência ao cônjuge nas próximas.
- **Núcleos** por cidade ou bairro (com divisão de cidades grandes por bairros). O **coordenador de núcleo** só vê a própria área, e isso é garantido pelo servidor.

**Administração do acampamento**
- **Configurações** sem mexer no código: marca (nome, logo, cor, contatos), textos e declarações, regras da fila, impressão, área do participante, tribos e publicação na Cloudflare.
- **Atualização pelo painel** (botão ⟳ **Atualizações**, laranja quando há versão nova), com backup automático antes.
- **Ativação por chave** (`XXX-0000`) e **auditoria** de tudo o que é feito.

**Painel central da VM** (versão 2.0)
- **Aba Configurações, VPN:** situação do túnel, **Reconectar** e troca de chave/senha com **retorno automático** se o túnel não subir (strongSwan). A configuração inicial e o fechamento da porta 22 ficam só no terminal.
- **Aba Configurações, Cloudflare:** cola o **token da Cloudflare** e o domínio, sem reinstalar; o servidor confere o token e ele nunca mais aparece em tela, auditoria ou log.
- Mostra todas as instâncias (endereço, publicação, no ar ou fora, versão, memória, porta) e o servidor (CPU, memória, disco, proxy).
- **Nova instância** pelo navegador; **Atualizar**, **Backup** e **Atualizar todas**; atualizar o próprio painel; tarefas com andamento ao vivo; auditoria.

**Papéis**

| Papel | Pode |
|---|---|
| Administrador | tudo no acampamento: usuários, núcleos, configurações, acampamentos, fila, atualizações |
| Equipe | toda a fila, chamadas, recusas, acampamentos, cônjuges e preferências |
| Coordenador de núcleo | pré-fichas do seu núcleo; consulta todos os campistas |
| Usuário do painel central | criar e atualizar instâncias da VM (não vê fichas de nenhum acampamento) |

**Segurança**
- As regras valem no servidor, inclusive o que cada papel enxerga. A data da inscrição é protegida pelo banco e a auditoria não pode ser alterada.
- Senhas com scrypt, verificação em duas etapas (obrigatória no painel central), bloqueio por tentativas, cookies `HttpOnly`/`SameSite=Strict`, proteção CSRF e CSP.
- "Esqueci minha senha" também para administradores/equipe do acampamento e para o painel central (link por e-mail com validade de 1 hora, uso único e, com as duas etapas ativas, o código do aplicativo continua obrigatório). No painel central a senha também pode ser trocada direto na tela com o código do autenticador (sem e-mail e sem VPN). O servidor de e-mail é configurado pela interface do painel central.
- O painel central pode abrir pela internet em HTTPS (porta 443, **sem VPN**), protegido por senha + autenticador obrigatório, bloqueio por usuário e por IP, cookie `Secure` e HSTS; ele **não executa nada sozinho**: um executor do sistema valida cada pedido antes de agir.
- Banco e aplicações não ficam expostos; imagens enviadas são conferidas (SVG com script é recusado); dados pessoais na impressão e na exportação seguem as boas práticas da LGPD descritas no manual.

**Performance** (medido com 20 mil fichas)
- Fila do painel em **1 s** (antes 22 s), **0,44 MB** transferidos (antes 25,8 MB), busca instantânea, formulário em **1,5 s** num celular com 4G fraco.
- Logs com tamanho limitado, limites de memória por serviço, índices no banco e atualização com imagem pronta do GitHub.
- Para analisar de novo: `/analise-performance` no Claude Code (squad de 4 revisores). Relatórios em [`docs/analise-performance/`](docs/analise-performance/).

---

## Operação do dia a dia

**Atualizar**
- **Acampamento:** botão **⟳ Atualizações** no painel do acampamento. O backup é feito antes.
- **Vários de uma vez:** no painel central, **Atualizar todas**.
- **O próprio painel:** "atualizar" no quadro do servidor.
- **Pelo terminal:** `cd /opt/prefichas-NOME && sudo ./scripts/atualizar.sh`.

**Backup**
```bash
cd /opt/prefichas-NOME
sudo ./scripts/backup.sh                                     # salva em ./backups (guarda 30 dias)
sudo ./scripts/restaurar.sh backups/prefichas-AAAA-MM-DD_HHMMSS.dump
```
Também dá para fazer backup pelo painel central, no botão **Backup** de cada instância. Agende um diário no cron
(`0 2 * * * cd /opt/prefichas-NOME && ./scripts/backup.sh`) e **copie a pasta `backups/` para outro lugar**.

**Comandos úteis**
```bash
# Acampamento (dentro da pasta /opt/prefichas-NOME)
docker compose ps                                        # situação
docker compose logs -f app                               # logs
docker compose exec app node server/cli.js listar        # usuários
docker compose exec app node server/cli.js redefinir-senha pessoa@email.com
docker compose exec app node server/cli.js participantes importar contas.csv

# Servidor
sudo /opt/prefichas-gerenciador/scripts/proxy-compartilhado.sh listar   # domínios diretos
sudo docker logs prefichas-proxy --tail 50                              # certificados / HTTPS
sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh status          # VPN

# Usuários do painel central
G=/var/lib/prefichas-gerenciador; C=/opt/prefichas-gerenciador/gerenciador
sudo docker run --rm -u 1000:1000 -e DADOS=/dados -v $C:/app:ro -v $G/dados:/dados -w /app node:22-alpine node cli.mjs listar
#   criar-usuario EMAIL | nova-senha EMAIL | novo-autenticador EMAIL | desativar EMAIL
```

**Marca por arquivo** (opcional; o normal é pelo painel → Configurações):
`cp marcas/modelo.json marcas/meu-acampamento.json` e
`docker compose exec app node server/cli.js marca aplicar marcas/meu-acampamento.json`.

---

## Instalação sem Docker (systemd)

Requisitos: Node.js 22+, PostgreSQL 14+ e um proxy HTTPS (Nginx + certbot, por exemplo).

```bash
# Banco de dados
sudo -u postgres createuser prefichas --pwprompt
sudo -u postgres createdb prefichas -O prefichas

# Aplicação
sudo useradd --system --home /opt/pre-fichas prefichas
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/pre-fichas
cd /opt/pre-fichas
sudo npm ci && sudo npm run build && sudo npm prune --omit=dev
sudo chown -R root:root /opt/pre-fichas

# Configuração
echo 'DATABASE_URL=postgres://prefichas:SENHA@localhost:5432/prefichas' | sudo tee /etc/pre-fichas.env
echo 'HOST=127.0.0.1' | sudo tee -a /etc/pre-fichas.env
sudo chmod 600 /etc/pre-fichas.env

# Serviço
sudo cp deploy/pre-fichas.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pre-fichas

echo 'NOME_ACAMPAMENTO=Nome do Acampamento' | sudo tee -a /etc/pre-fichas.env

# Primeiro administrador
sudo bash -c 'set -a; . /etc/pre-fichas.env; node server/cli.js criar-admin voce@email.com "Seu Nome"'
```

Depois configure o Nginx com `deploy/nginx.conf` e gere o certificado com `certbot --nginx`.

---

## Desenvolvimento

```bash
npm install
cp .env.example .env     # defina DATABASE_URL apontando para um PostgreSQL local
npm run dev:api          # API em http://localhost:3000
npm run dev              # site em http://localhost:5173 (repassa /api para a API)
npm run usuarios -- criar-admin voce@email.com "Seu Nome"

# Testes de integração (APAGAM o banco indicado; use um banco só para testes)
DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
npm run test:gerenciador   # testes do painel central
```

## Estrutura

```
index.html, admin/index.html   páginas (participante e painel; o servidor aplica a marca)
src/form/                      tela de entrada, conta do participante e formulário
src/admin/                     painel do acampamento (fila, ficha, impressão, configurações…)
shared/                        regras de validação, opções e marca (site E servidor)
server/                        API (Fastify), contas, sessões, senhas, marca, e-mail, CLI
server/migrations/             estrutura do banco (aplicada automaticamente)
server/teste/                  testes de integração
gerenciador/                   painel central da VM (servidor, interface, CLI de usuários, testes)
marcas/                        modelo de identidade (.json + logo)
deploy/                        Caddyfile, Caddyfile.multi, nginx.conf, serviço systemd
scripts/                       instalação, atualização, backup, proxy compartilhado, Cloudflare,
                               VPN (FortiClient / strongSwan), executor e instalador do painel central
instalar.sh                    instalador de um comando (painel central ou acampamento)
docs/                          manual de uso, manual de instalação, análises de performance
.github/workflows/imagem.yml   gera a imagem pronta a cada mudança na main
Dockerfile, docker-compose.yml implantação com Docker
```

## Regra da fila

A posição é calculada **por modalidade**, pela data/hora de **entrada na fila** e, em empate,
pelo número da ficha. Entram na contagem as fichas **Aguardando** ou **Em contato**; ao registrar
que a pessoa fez um acampamento, ela passa a **Já participou** e sai da fila.

Cada ficha guarda duas datas:

| Data | O que é |
|---|---|
| **Inscrição original** | quando a pré-ficha foi enviada. **Nunca muda.** |
| **Na fila desde** | define a posição. Começa igual à inscrição e só muda quando a pessoa vai para o fim da fila. O banco **só permite adiar** essa data, nunca adiantar. |

### Recusas e "fim da fila"

- Quando a pessoa é chamada e diz não, use **Registrar recusa** na ficha (comentário obrigatório).
- Na **2ª recusa seguida** ela vai **automaticamente para o fim da fila**: a data "na fila desde"
  passa a ser o momento atual. O número de recusas é configurável em **Configurações → Regras da
  fila** (0 = nunca mover automaticamente).
- A contagem de recusas seguidas zera quando a pessoa aceita (status **Confirmado** ou registro
  em um acampamento) e depois de ir para o fim da fila.
- **Mover para o fim da fila…** faz o mesmo manualmente, com motivo obrigatório.

### Preferência do cônjuge

Quem faz o acampamento **N** dá ao cônjuge **preferência** para ser chamado nas próximas edições
da mesma modalidade — por padrão **2** (fez o 24º Sênior → preferência no 25º e 26º). Depois disso
ela expira sozinha. O número de edições fica em **Configurações → Regras da fila** (0 = desligado).

1. **No formulário**, quem é casado(a)/união estável informa (opcional) nome e telefone do cônjuge,
   se ele já fez o acampamento e qual.
2. **Na ficha**, a equipe **vincula os cônjuges** — o sistema sugere a ficha pelo telefone/nome declarado.
3. Com o vínculo, ao registrar que um deles **fez o acampamento**, o outro ganha a preferência
   **automaticamente**. Se o vínculo for feito depois, a preferência também é criada (se ainda estiver no prazo).
4. Se o cônjuge fez o acampamento antes do sistema (sem ficha), use **Registrar preferência de cônjuge**
   informando o nome e o número da edição.

A situação de cada preferência é calculada a partir das edições cadastradas em **Acampamentos**:
**ativa**, **usada** (a pessoa fez uma das edições cobertas), **expirada** (as edições cobertas já
foram cadastradas) ou **revogada** (cancelada pela equipe, com motivo). Por isso, cadastre cada edição
realizada.

Na fila, o filtro **Preferência** mostra quem tem preferência ativa (selo ★) e quem declarou que o
cônjuge fez o acampamento mas ainda não foi validado. Na lista de chamada de cada edição, quem tem
preferência para aquela edição aparece primeiro. Vincular/desvincular e criar/revogar preferências
é feito por administradores e equipe, e tudo fica na auditoria.

### Trilha de auditoria

Tudo fica registrado no histórico de cada ficha e na tela **Auditoria** (filtros por tipo de evento,
período e texto; exportação CSV): inscrição, mudanças de status, observações, recusas,
idas para o fim da fila (com data anterior → nova, quem fez e o motivo), registros de acampamento,
vínculos de cônjuge e preferências criadas/revogadas.

- O próprio **banco de dados** registra toda mudança da data na fila — mesmo que alguém altere
  direto no banco, aparece como "alteração direta no banco".
- Os registros **não podem ser editados** (o banco recusa).
- O coordenador de núcleo vê a auditoria apenas da sua área.
