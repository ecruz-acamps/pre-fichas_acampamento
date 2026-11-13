# Manual de uso — Pré-fichas e fila de espera

Este manual explica **como usar o sistema no dia a dia**. Para instalar e manter o servidor, veja
[`INSTALACAO.md`](INSTALACAO.md).

**Sumário**
1. [Visão geral: quem usa e para quê](#1-visão-geral)
2. [Participante: criar conta, inscrever-se e acompanhar](#2-participante)
3. [Primeiro acesso ao painel](#3-primeiro-acesso-ao-painel)
4. [Fila de espera](#4-fila-de-espera)
5. [A ficha da pessoa (detalhe)](#5-a-ficha-da-pessoa)
6. [Chamar, recusas e fim da fila](#6-chamar-recusas-e-fim-da-fila)
7. [Imprimir a pré-ficha](#7-imprimir-a-pré-ficha)
8. [Campistas, Todos e Resumo por cidade](#8-campistas-todos-e-resumo-por-cidade)
9. [Acampamentos: registrar quem fez e as tribos](#9-acampamentos)
10. [Cônjuge e preferência](#10-cônjuge-e-preferência)
11. [Auditoria](#11-auditoria)
12. [Núcleos (cidades e bairros)](#12-núcleos)
13. [Usuários](#13-usuários)
14. [Configurações](#14-configurações)
15. [Atualizações do sistema](#15-atualizações-do-sistema)
16. [Minha conta: senha e verificação em duas etapas](#16-minha-conta)
17. [Boas práticas com os dados (LGPD)](#17-boas-práticas-com-os-dados-lgpd)
18. [Perguntas frequentes](#18-perguntas-frequentes)

---

## 1. Visão geral

| Quem | Onde entra | O que faz |
|---|---|---|
| **Participante** (pré-campista) | Endereço do site (ex.: `https://nome.movimentocampista.com.br/`) | Cria a conta, faz a pré-ficha, acompanha a situação, atualiza os dados, desiste ou se inscreve de novo |
| **Administrador** | `…/admin/` | Tudo: fila, acampamentos, núcleos, usuários, configurações e atualizações |
| **Equipe** | `…/admin/` | Fila completa, chamadas, recusas, acampamentos, cônjuges e preferências |
| **Coordenador de núcleo** | `…/admin/` | Fila e pré-fichas **só das cidades/bairros do seu núcleo**; consulta campistas de todos os núcleos |

**A regra da fila:** a ordem é a **data e hora de envio da pré-ficha**, separada por **modalidade**
(Mirim, FAC, Juvenil, Sênior e Casais). Ninguém fura a fila: a posição só muda quando a pessoa vai para o
**fim da fila**, por recusas seguidas ou decisão registrada, e tudo fica na auditoria.

---

## 2. Participante

### 2.1 Criar a conta
1. Abra o endereço do site. Aparece a tela **"Seja bem-vindo!"**.
2. Clique em **"Crie uma aqui"**.
3. Informe **CPF**, **e-mail** e uma **senha** com pelo menos 8 caracteres. Repita a senha.
4. Clique em **Criar conta**. Você já entra na sua área.

> Um CPF ou e-mail só pode ter uma conta. Se aparecer "Já existe uma conta…", use
> **Esqueci minha senha**.

### 2.2 Entrar
Na tela inicial, informe **CPF ou e-mail** e a **senha**. O olho 👁 mostra a senha digitada.

### 2.3 Esqueci minha senha / conta antiga
1. Clique em **Esqueci minha senha** e informe o CPF ou o e-mail.
2. Chega um e-mail com um link que **vale por 1 hora** e **funciona uma vez só**.
3. Abra o link, crie a nova senha e você entra direto.

Quem tinha **conta antiga** (importada pelo acampamento) usa este mesmo caminho para criar a
primeira senha. Se o e-mail não chegar, olhe a caixa de **spam**.

### 2.4 Fazer a inscrição (pré-ficha)
1. Na sua área, clique em **Fazer minha inscrição**.
2. Preencha o formulário. O CEP completa o endereço sozinho.
3. Escolha a **modalidade**. Só ficam liberadas as que combinam com sua idade e estado civil.
4. Marque as **declarações** e clique em **Enviar ficha de inscrição**.

A data e a hora do envio definem sua posição na fila.

**Modalidade Casais:** ao escolher Casais, o formulário pede o **CPF do cônjuge**. A inscrição só é aceita se:
- o cônjuge **já for campista cadastrado no sistema** (já participou de algum acampamento). Se não for encontrado(a), a inscrição é recusada;
- você for **casado(a) ou em união estável**;
- **quando o acampamento exigir** (Configurações → Modalidade Casais), **os dois já tiverem feito o Sênior**. Nesse caso a opção Casais só abre para quem já fez o Sênior.

A inscrição de casal é feita **uma vez só**, por um dos dois, e só pela **conta do participante**. Depois de enviada, a modalidade e o CPF do cônjuge não podem ser alterados pela área do participante; para mudar, fale com o acampamento.

### 2.5 Acompanhar, editar, desistir e se inscrever de novo
- **Situação**: aguardando, em contato, confirmado… Se o acampamento permitir, aparece também a
  **posição na fila**.
- **Editar meus dados**: mude endereço, telefone etc. **Sua posição na fila não muda.**
- **Desistir da vaga**: pede confirmação. Para voltar depois, a nova inscrição entra no fim da fila.
- **Inscrever-me de novo**: depois de desistir ou de ter participado, os dados anteriores já vêm
  preenchidos. Quem já fez uma modalidade (ex.: Juvenil) não pode repeti-la, mas pode entrar na
  fila de outra quando tiver os requisitos (ex.: **Sênior**: casado(a) ou 30 anos ou mais).

---

## 3. Primeiro acesso ao painel

1. Abra `…/admin/` e entre com o e-mail e a **senha temporária** recebida.
2. O sistema pede uma **nova senha**.
3. **Somente na primeira instalação:** o administrador informa a **chave de ativação** (`XXX-0000`)
   recebida de quem fornece o sistema. Até ativar, o formulário público fica fechado.

No topo ficam as abas permitidas ao seu perfil, **Minha conta** e **Sair**. O administrador também vê
o botão **Atualizações**.

---

## 4. Fila de espera

A aba **Pré Ficha - Espera** (antes chamada "Fila") mostra quem está aguardando, na ordem da fila.

| Coluna | Significado |
|---|---|
| **Pos.** | Posição na fila **da modalidade** |
| **Na fila desde** | Data que define a posição (muda só se a pessoa foi para o fim da fila) |
| **Nome** | Com selos: 🔑 tem conta · **possível duplicado** (mesmo e-mail/telefone) · ★ preferência · nº de recusas |
| **Status** | Pode ser trocado direto na lista |

**Filtros e ferramentas**
- **Abas de modalidade** (Todas, Mirim, FAC, Juvenil, Sênior, Casais), com o total na fila.
- **Busca** por nome, e-mail, telefone, CPF (4 dígitos ou mais), bairro ou paróquia.
- **Status**: "Na fila" (aguardando + em contato), todos ou um status específico.
- **Núcleo, cidade e bairro**.
- **Preferência** (se a função estiver ligada): com preferência ativa, a validar, sem preferência.
- **Ordem**: posição na fila ou nome.
- **Atualizar**: busca os dados novos do servidor.
- **Exportar CSV**: planilha com as fichas filtradas e todas as colunas.
- A lista mostra **200 por vez**. Use **Mostrar mais** no fim da tabela.

**Status possíveis:** Aguardando · Em contato · Confirmado · Desistiu · Já participou.

---

## 5. A ficha da pessoa

Clique em uma linha para abrir o **detalhe**:
- **Posição**: inscrição original, "na fila desde" e recusas seguidas.
- **Ações**: registrar recusa, mover para o fim da fila, alterar status e observações internas
  (as observações **não** aparecem para o participante nem na impressão).
- **Cônjuge e preferência** (ver seção 10).
- **Conta do participante**: se tem conta, e-mail da conta e último acesso. Admin e equipe podem
  **vincular** uma ficha antiga à conta da pessoa pelo CPF, depois de confirmar a identidade por
  telefone.
- **Dados completos**: pessoais, CPF, religiosos, contato, endereço, núcleo, motivo, saúde e
  declarações aceitas.
- **Histórico**: tudo o que aconteceu com a ficha, com data e quem fez.

Feche com o **×** ou com a tecla **Esc**.

---

## 6. Chamar, recusas e fim da fila

1. Ligue para a pessoa e mude o status para **Em contato**.
2. Se ela **aceitar**, coloque **Confirmado**.
3. Se ela **recusar**, clique em **Registrar recusa** e escreva o motivo (obrigatório).
   - Ao atingir o número de **recusas seguidas** definido em Configurações (padrão: 2), a pessoa vai
     **automaticamente para o fim da fila**. O sistema avisa antes de confirmar.
4. **Mover para o fim da fila…**: decisão manual, com motivo obrigatório (ex.: "pediu para adiar").

A **inscrição original nunca muda**; a data "na fila desde" passa a ser a do momento da mudança.
Tudo fica no histórico e na auditoria.

---

## 7. Imprimir a pré-ficha

1. Abra a ficha e clique em **🖨 Imprimir** (no topo, ao lado do ×).
2. Na janela do navegador, escolha a impressora ou **Salvar como PDF**.

A ficha sai em uma folha A4, no formato "Ficha de pré-inscrição", com o cabeçalho configurado pelo
administrador (seção 14). **Não saem** as observações internas nem o histórico. **Cada impressão fica
registrada** no histórico da ficha.

---

## 8. Campistas, Todos e Resumo por cidade

- **Campistas**: lista alfabética só de quem **já fez** o acampamento, de todos os núcleos, com busca e
  exportação. O coordenador vê os campistas de **todos** os núcleos em modo consulta.
- **Todos**: lista alfabética de campistas **e também de quem está esperando** (pré-fichas), com busca e
  exportação. O coordenador vê as pré-fichas só do seu núcleo (ou de todos, se o administrador ligou
  a opção em Configurações).
- **Resumo por cidade**: quantas pessoas há por cidade e bairro, por modalidade. Útil para planejar
  vagas e núcleos. Tem exportação CSV.

---

## 9. Acampamentos

Aba **Acampamentos** (admin e equipe):
1. **+ Novo acampamento**: número (ex.: 25), modalidade e período.
2. Abra o acampamento e use **Registrar quem fez**: escolha a pessoa (confirmados aparecem primeiro;
   com a preferência ligada, quem tem ★ também) e a **tribo**.
3. A pessoa sai da fila de espera e fica como **Já participou**.
4. A tela mostra os participantes **por tribo**, com exportação CSV.

As **tribos** (nomes e cores) são definidas em Configurações.

---

## 10. Cônjuge e preferência

*(Disponível quando a **Preferência do cônjuge** está ligada em Configurações.)*

- **Vincular cônjuges**: no detalhe, em "Cônjuge e preferência", o sistema sugere a ficha do
  cônjuge (pelo nome ou telefone informado), ou você busca pelo nome.
- **Regra**: quando um dos cônjuges faz o acampamento, o outro ganha **preferência** nas próximas
  edições da mesma modalidade. O número de edições é definido em Configurações (padrão: 2).
- **Registrar preferência manual**: para casos anteriores ao sistema (ex.: "o cônjuge fez o 24º").
- **Revogar**: com motivo, fica no histórico.
- Na Fila, o filtro **"Declarou que o cônjuge fez — a validar"** mostra quem disse no formulário que o
  cônjuge já fez, mas ainda não foi conferido.

---

## 11. Auditoria

A aba **Auditoria** é a trilha de tudo o que foi feito: inscrições, mudanças de status, recusas, fim
da fila, acampamentos, preferências, edições feitas pelo próprio participante, impressões e
vínculos de conta.
- Filtre por **tipo**, **período** e **texto** (pessoa, usuário ou comentário).
- **Exportar CSV**.
- O coordenador vê apenas os eventos das fichas do seu núcleo.
- A trilha **não pode ser alterada**, nem direto no banco de dados.

---

## 12. Núcleos

*(Somente administrador.)* Os núcleos definem **quais fichas cada coordenador vê**.
1. **+ Novo núcleo** (ex.: "Núcleo Grande Florianópolis").
2. Em **Cidades e bairros atendidos**: **+ cidade inteira** ou **+ só o bairro**.
3. **Dividir cidade por bairros**: para cidades grandes atendidas por vários núcleos (ex.: Palhoça em
   4 núcleos). Mostra os bairros com a quantidade de pessoas para distribuir.

A comparação ignora acentos e maiúsculas ("São José" = "sao jose"). Fichas de cidades sem núcleo
aparecem como **sem núcleo** e só admin e equipe veem.

---

## 13. Usuários

*(Somente administrador.)*
- **Novo usuário**: nome, e-mail e papel (administrador, equipe ou coordenador de núcleo). O sistema
  mostra uma **senha temporária**: passe para a pessoa por um canal seguro. Ela troca no primeiro acesso.
- **Coordenador**: marque os **núcleos** que ele acompanha.
- **Nova senha**: gera outra senha temporária, e a atual deixa de funcionar.
- **Desativar**: a pessoa perde o acesso na hora, e o histórico do que ela fez continua.
- A coluna **2 etapas** mostra quem ativou a verificação em duas etapas.

---

## 14. Configurações

*(Somente administrador.)* Depois de alterar, clique em **Salvar configurações**. As mudanças valem na
hora, sem reiniciar.

| Seção | O que configura |
|---|---|
| **Identidade** | Nome, nome curto, cor, **logo** (também vira o ícone do site e a imagem da prévia no WhatsApp), contatos (WhatsApp, e-mail, Instagram, site) |
| **Formulário** | Título, texto de apresentação, mensagem de sucesso e **declarações** obrigatórias |
| **Modalidade Casais** | Menu **"Para a modalidade Casais é necessário ter feito o Sênior?"**: **Sim** (os dois precisam ter feito o Sênior) ou **Não** (basta o cônjuge já ser campista). A regra varia de acampamento para acampamento |
| **Regras da fila** | Recusas seguidas que levam ao fim da fila · **Preferência do cônjuge** (liga/desliga) e quantas edições vale |
| **Impressão da ficha** | Título, linha acima do título, texto ao lado do logo e **logo da esquerda** (ex.: brasão da paróquia), com prévia |
| **Área do participante** | Mostrar ou não a **posição na fila** para a pessoa · **Contas dos participantes**: importar contas antigas por planilha CSV (colunas `cpf`, `email`, `nome`, `data_nascimento`) |
| **Tribos** | Nomes e cores das tribos |
| **Publicação na internet (Cloudflare)** | Ligar ou desligar o endereço `NOME.movimentocampista.com.br` com HTTPS, trocar o endereço, ver o andamento |
| **Exportar/Importar** | Salvar ou carregar toda a identidade num arquivo `.json` |

> Se aparecer o aviso de **e-mail não configurado**, ninguém consegue recuperar a senha nem criar a
> senha de conta importada. Peça ao responsável técnico para configurar (manual de instalação, 11b).

---

### Cadastro do campista (uma etapa só)
Na tela inicial, o novo campista clica em **"Cadastre-se e faça a inscrição"** e preenche **tudo de uma vez**: **Seu acesso** (CPF, senha e foto opcional), dados pessoais, contato, endereço, a **modalidade** e as demais informações.
Ao enviar, a conta e a pré-ficha são criadas juntas e a pessoa já entra na sua área. O **e-mail de Contato é o login**. Quem já tem conta usa **Entrar**. A modalidade **Casais** é escolhida depois, pela área da conta.
Se a pessoa já estiver na fila (mesmo CPF, ou mesmo nome e data de nascimento, inclusive fichas importadas de outra planilha), o sistema não cria outra ficha nem a conta e orienta a falar com a coordenação,
que pode vincular a ficha existente a uma conta pelo painel (ficha → "Vincular a uma conta").

### Filtros por coluna (como no Excel)
Na **Fila**, cada cabeçalho tem um botão de funil. Clique para **classificar** a coluna e **filtrar por valores**: pesquise, marque ou desmarque o que quer ver e clique em **OK**. A coluna filtrada fica destacada e uma linha
acima da tabela mostra "N de M fichas" com **limpar filtros das colunas**. As listas mostram só o que sobrou dos filtros das outras colunas. **Na fila desde** filtra por ano e mês; **Pos.** por faixa (de/até); **Telefone** por "contém".
Os filtros valem junto com os do topo, e **Exportar CSV** leva apenas o que está filtrado.

### Fichas importadas de outra planilha
Fichas vindas de uma importação mantêm a **data original da pré-ficha** e trazem, nas **observações internas**, o que veio da planilha (campistas conhecidos, casamento, se foi servo) e os avisos de conferência. As marcadas com
**"REVISAR MODALIDADE"** esperam uma modalidade diferente da que a idade/estado civil indica neste sistema; a posição na fila é a original. Podem faltar e-mail, CEP e motivo (o sistema antigo não exigia): peça ao participante para atualizar
pela conta dele. A importação é feita pelo administrador em **Configurações → Importar pré-fichas de uma planilha** (CSV ou Excel): o sistema simula primeiro, mostra quantas entram na fila, quantos campistas que
já participaram e o que ficou em quarentena (com a lista para baixar), e só grava depois da confirmação. Pode ser desfeita.

### Cadastro de coordenadores e equipe
- **A pessoa** abre o painel (`/admin/`), clica em **"Quero me cadastrar"** e informa nome, e-mail e senha. Depois abre o link de confirmação que chega por e-mail. Ela **não tem acesso a nada**
  até o administrador liberar.
- **O administrador** vai em **Usuários → "Cadastros aguardando liberação"**, escolhe o **papel** (Coordenador de núcleo, Equipe ou Administrador) e, para coordenador, os **núcleos**, e clica em
  **Liberar acesso**. O selo "e-mail não confirmado" avisa que a pessoa ainda não abriu o link (pode não ser a dona do e-mail). **Recusar** apaga o pedido.
- Em **Configurações → Cadastro da equipe** dá para **fechar** o cadastro (Não): aí só o administrador cria usuários. Quem já tem acesso e esqueceu a senha usa "Esqueci minha senha".

### Foto do participante
- **Participante:** ao criar a conta (e depois, na área dele) há o campo **Sua foto (opcional)**. No celular abre a câmera ou a galeria. A foto é reduzida no aparelho
  e vale para todas as inscrições. Dá para **trocar** ou **remover** a qualquer momento.
- **Equipe:** a foto aparece no detalhe da ficha (seção "Conta do participante") e na **ficha impressa**, no canto superior direito. Só quem pode ver a ficha vê a foto.
  Fichas sem conta, ou de contas sem foto, aparecem normalmente, sem a foto.
- **Privacidade (LGPD):** a foto é dado pessoal. Use só para identificar a pessoa no acampamento e guarde as fichas impressas com cuidado. Para menores de idade, confirme
  com o responsável. Ao apagar a conta, a foto é apagada junto.

### Esqueci minha senha
- **Participante:** na tela de entrada, "Esqueci minha senha" (CPF ou e-mail).
- **Administrador ou equipe do acampamento:** na tela de login do painel (`/admin/`), "Esqueci minha senha", informe o e-mail do usuário e abra o link
  que chega por e-mail (vale 1 hora, uma vez). Se você usa o aplicativo autenticador, digite o código dele também. Perdeu o celular do autenticador? Peça a um administrador para
  redefinir o seu acesso (isso desliga as duas etapas para você ativar de novo).
- **Painel central:** na tela de entrada, "Esqueci minha senha": informe o e-mail, o **código atual do aplicativo autenticador** e a senha nova (12+ caracteres).
  Não precisa de e-mail configurado. Errou o código 3 vezes? A redefinição daquele usuário fica travada por 1 hora (o login normal continua livre). Se preferir, use
  "Prefiro receber um link por e-mail" (precisa do servidor de e-mail configurado e também do código do autenticador).
- Se aparecer que a recuperação "ainda não foi configurada", falta cadastrar o servidor de e-mail: painel central → Configurações → "Servidor de e-mail".

### Servidor de e-mail pela interface
No painel central, aba **Configurações → Servidor de e-mail**, informe servidor, porta, usuário, senha de app e remetente. Ao salvar, o sistema manda um e-mail
de teste para o seu usuário e só guarda se funcionar. Marque **Aplicar também aos acampamentos já criados** para que o "Esqueci minha senha" funcione neles.

### Abrir o painel central sem VPN
Na instalação do painel você pode informar um **domínio** (por exemplo `painel.seudominio.com.br`). O painel passa a abrir em
`https://painel.seudominio.com.br`, pela porta web normal, de qualquer lugar. O acesso continua exigindo **senha e código do
autenticador**; depois de 5 erros no mesmo usuário (ou 20 da mesma origem), o acesso fica bloqueado por 15 minutos. Para um
painel que já está instalado, rode de novo `sudo PAINEL_DOMINIO=painel.seudominio.com.br ./scripts/instalar-gerenciador.sh`:
os usuários continuam os mesmos. O DNS do nome precisa apontar para o IP público da VM, e as portas 80/443 precisam chegar nela.

### Token da Cloudflare no painel central
No painel central (o do servidor, não o do acampamento), aba **Configurações**: cole o **token da API da Cloudflare** e o
domínio e clique em **Salvar token**. O servidor confere o token antes de guardar. Depois de salvo, a tela mostra só
"token configurado". Para trocar, cole um novo; **Remover token** apaga do servidor.

### VPN no painel central
Na aba **Configurações → VPN do servidor (FortiClient)** você vê a configuração (perfil, usuário, redes, IP do servidor na
VPN, versão do FortiClient), se a VPN está **conectada**, usa **Reconectar** quando ela cair e pode editar perfil, redes e
usuário. A instalação, a criação do perfil (gateway, chave, IKE) e o fechamento da porta 22 são feitos só pelo terminal.

## 15. Atualizações do sistema

*(Somente administrador.)*
- O botão **⟳ Atualizações** no topo fica **laranja** quando há versão nova.
- Clique para ver as novidades e em **Atualizar agora**. O sistema faz **backup** antes, atualiza e
  volta sozinho em poucos minutos, com o andamento na tela.
- Evite atualizar durante a **abertura das inscrições**.

---

## 16. Minha conta

No topo, **Minha conta**:
- **Trocar a senha**: mínimo 8 caracteres. As outras sessões abertas são encerradas.
- **Verificação em duas etapas** (recomendada para administradores): ative, leia o QR Code no
  aplicativo autenticador (Google Authenticator, Microsoft Authenticator…) e confirme com o código.
  A partir daí, o login pede também o código de 6 dígitos.

Errar a senha várias vezes bloqueia a conta por alguns minutos.

---

## 17. Boas práticas com os dados (LGPD)

- Use os dados **só para o acampamento**. Não compartilhe listas em grupos abertos.
- **Fichas impressas e planilhas exportadas** contêm dados pessoais: guarde ou destrua com cuidado.
- Cada pessoa deve ter **seu próprio usuário**: não empreste senha. A auditoria registra quem fez o quê.
- Ao sair de um computador compartilhado, clique em **Sair**.
- Coordenadores veem só o seu núcleo. Se precisar de mais acesso, peça ao administrador.

---

## 18. Perguntas frequentes

**A pessoa diz que se inscreveu, mas não está na fila.** Procure pelo nome, telefone ou CPF com o
status "Todos os status". Pode ter sido marcada como duplicada (mesmo nome e data de nascimento de
outra ficha ativa) ou ter desistido. O histórico mostra o que aconteceu.

**A pessoa se inscreveu antes de existirem as contas e agora não consegue se inscrever pela conta.**
Ela recebe a mensagem para falar com o acampamento. Confirme a identidade por telefone e, na ficha
antiga, use **Vincular a uma conta** com o CPF da conta dela (seção 5).

**Mudei o endereço de uma pessoa e ela sumiu da lista do coordenador.** O núcleo é definido pela
cidade e pelo bairro. Se o endereço passou a ser de outro núcleo, a ficha vai para esse núcleo.

**O e-mail de "Esqueci minha senha" não chega.** Peça para olhar o spam. Se ninguém recebe, o envio de
e-mail não está configurado (aviso em Configurações).

**Posso mudar a ordem da fila manualmente?** Não para frente. Só é possível mandar alguém para o
**fim da fila**, com motivo registrado. Isso garante que ninguém fure a fila.

**Imprimi uma ficha por engano.** Tudo bem: a impressão só fica registrada no histórico. Descarte o
papel com cuidado.

## Instalar como aplicativo (PWA)

O formulário público e o painel podem ser instalados na tela inicial do celular ou do computador:
- **Android / Chrome:** menu ⋮ → "Instalar app".
- **iPhone / Safari:** Compartilhar → "Adicionar à Tela de Início".

O aplicativo usa o nome e a cor do acampamento. Por segurança, **nenhum dado pessoal é guardado no aparelho**: o app precisa de internet para funcionar (sem conexão, aparece uma tela "Sem conexão"). Para atualizar, basta recarregar; a versão nova é baixada sozinha.

## Contas das pessoas importadas

Cada pessoa importada que tem CPF ganha uma conta: **usuário = CPF e senha = CPF** (só números ou com pontos, tanto faz). Ela entra em "Já tenho conta", vê a pré-ficha e pode trocar a senha em "Alterar senha". Quem não tinha e-mail na planilha não consegue usar "Esqueci minha senha": a coordenação precisa ajudar. Lembre que o CPF não é segredo; avise as pessoas para trocarem a senha.

## Revisar e alterar a modalidade

- **Detalhe da ficha → Modalidade:** administradores e coordenadores de núcleo podem trocar a modalidade (só as que cabem pela idade e estado civil). A data de inscrição e a posição na fila não mudam; a troca fica no histórico.
- **Menu "Revisar modalidade":** mostra as fichas com "revisar" nas observações internas. Escolha "Alterar" ou "Manter"; a marca "revisar" é retirada e o registro da revisão fica na observação.
- **Filtro por sexo:** a Fila tem a coluna "Sexo" com filtro (Masculino/Feminino).

## Login com a Microsoft (conta corporativa)

Cada acampamento é um "tenant": o login Microsoft é ligado **por acampamento**, pelo administrador da VM, no **painel central** (Instâncias → coluna "Login Microsoft" → configurar). Os acampamentos não ligados continuam só com senha.

Passo a passo, no portal do Microsoft Entra (portal.azure.com → Microsoft Entra ID), para o acampamento:
1. **Registros de aplicativo → Novo registro**, tipo "Contas somente neste diretório organizacional".
2. **URI de redirecionamento** (plataforma Web): `https://ENDERECO-DO-ACAMPAMENTO/api/auth/microsoft/callback` (o painel central mostra o endereço certo).
3. **Certificados e segredos → Novo segredo de cliente**: copie o **Valor** (aparece uma vez).
4. No painel central, abra o acampamento em "configurar", marque **Usar login Microsoft**, cole o **ID do diretório (locatário)**, o **ID do aplicativo (cliente)** e o **valor do segredo**, e salve. O sistema do acampamento reinicia por alguns segundos. Em branco, o segredo guardado é mantido.

Como funciona: a pessoa clica em "Entrar com a Microsoft", faz o login (e o MFA) na Microsoft e volta ao painel. Se já tem acesso, entra; se não, aparece em **Usuários → Cadastros aguardando liberação** (a opção "criar cadastro pendente" fica em Configurações do acampamento). Depois da primeira entrada, a conta fica ligada à pessoa na Microsoft: outra conta Microsoft com o mesmo e-mail não entra. A senha local continua valendo.

SAML: este sistema usa OpenID Connect (o padrão atual da Microsoft), que dispensa certificados XML e é mais simples de manter. O resultado para o usuário é o mesmo.

### Coordenadores entrando direto, com o núcleo definido pelo Entra

Para que os coordenadores entrem pela Microsoft **sem esperar liberação**, com o núcleo definido pelo grupo do Entra:

**Uma vez só, no registro do aplicativo (Entra):**
1. **Permissões de API → Adicionar uma permissão → Microsoft Graph → Permissões de aplicação → `Group.Create`**, e clique em **Conceder consentimento de administrador**. É a **única** permissão pedida: o aplicativo só consegue **criar** grupos de segurança novos. Ele não lê, não altera nem apaga grupos existentes e não mexe em membros.
2. **Configuração do token → Adicionar afirmação de grupos →** marque **Grupos de segurança** e salve (para o token de ID). O token traz só os IDs dos grupos da pessoa.

**No painel do acampamento:**
3. Em **Núcleos**, clique em **Criar grupos no Entra**. O sistema cria um grupo de segurança "Pré-fichas – NOME DO NÚCLEO" para cada núcleo que ainda não tem e já guarda o ID de cada um. (Se preferir criar o grupo à mão, cole o ID em Núcleos → editar → "Grupo do Microsoft Entra".)
4. Em **Configurações → Login com a Microsoft**, escolha **"Entrar direto como coordenador, com o núcleo definido pelos grupos do Entra"**.

**No Entra, de rotina:**
5. Coloque os coordenadores de cada núcleo como **membros do grupo dele**. Esse é o único passo manual: quem decide quem entra e em qual núcleo é o Entra.

Quem está em um grupo de núcleo entra como **coordenador daquele núcleo** (e de todos os núcleos dos seus grupos). Quem não está em nenhum, não entra. Para tirar o acesso, remova a pessoa do grupo: na próxima entrada ela perde os núcleos (as sessões abertas dela são derrubadas); para valer na hora, desative o usuário em **Usuários**. Administradores continuam sendo definidos no painel e entram com senha e autenticador; os grupos nunca criam nem alteram administradores.

Limitação: pessoas que estão em muitos grupos (mais de 200) não recebem a lista no token da Microsoft e são recusadas com aviso.

## Coordenadores veem todas as fichas? (opção)

Em **Configurações → Coordenadores de núcleo** o administrador escolhe:
- **Não** (padrão): cada coordenador vê só as fichas do seu núcleo.
- **Sim**: o coordenador **consulta** as fichas de todos os núcleos, mas **só altera** as do seu próprio núcleo. As de fora abrem em modo somente leitura (sem botões de ação).

### Ler os grupos do Entra e apagar o grupo junto com o núcleo

Em **Núcleos**:
- **Ler grupos do Entra:** lê os grupos cujo nome começa com "Pré-fichas". Grupos criados à mão com o nome **"Pré-fichas – NOME DO NÚCLEO"** são ligados sozinhos ao núcleo de mesmo nome; os outros aparecem em "Grupos do Entra sem núcleo", onde você escolhe o núcleo. Núcleos cujo grupo foi apagado no Entra ficam marcados "não existe mais no Entra". A página também permite escolher a **leitura automática** (a cada 1, 3, 7, 15 ou 30 dias).
- **Excluir um núcleo:** o sistema pergunta se deve apagar **também** o grupo no Entra. Isso só vale para grupos **criados pelo sistema** e cujo nome ainda comece com "Pré-fichas"; grupos que você criou à mão e ligou nunca são apagados pelo sistema (apague-os no Entra). Sem permissão, o núcleo não é excluído e a mensagem diz o que falta.

**Permissões do aplicativo no Entra** (Permissões de API → Microsoft Graph → Permissões de aplicação, com consentimento do administrador):
- só criar grupos: `Group.Create`;
- ler os grupos: `Group.Read.All`;
- apagar grupos (e ler): `Group.ReadWrite.All`.

Atenção: `Group.ReadWrite.All` permite alterar e apagar **qualquer grupo** do diretório. O sistema só apaga os que criou e que começam com "Pré-fichas", mas o segredo do aplicativo (no `.env` do servidor) passa a ter esse poder. Guarde-o bem e troque-o se houver suspeita de vazamento. Se não quiser dar esse poder, mantenha só `Group.Create` e apague os grupos à mão no Entra.

## Modalidades (criar e editar)

No menu **Modalidades** (só administrador):
- **+ Nova modalidade:** nome, idade mínima e máxima e, se quiser, "só casado(a)/união estável". A modalidade passa a aparecer no formulário (para quem tem a idade e o estado civil compatíveis), ao criar edições e nas filas.
- **Editar:** muda o nome e a faixa de idade. Isso vale para novas inscrições; as fichas já existentes não são alteradas.
- **↑ ↓:** muda a ordem em que as modalidades aparecem.
- **Desativar:** a modalidade deixa de aceitar novas inscrições e novas edições, mas o que já existe continua. Dá para ativar de novo.
- **Excluir:** só se a modalidade não tem nenhuma ficha, edição ou preferência.
- **Sênior e Casais** têm regras próprias do sistema (Sênior: casado(a) com 18+ ou a idade mínima; Casais: o cônjuge precisa já ser campista): você edita o nome e a idade mínima, mas elas não podem ser excluídas.

## Painel da VM: trocar o link e apagar uma instância

Em **Instâncias** (painel central):
- **Trocar link:** escolha Cloudflare (novo subdomínio) ou domínio próprio e confirme. O sistema publica e **confere** o endereço novo antes de tirar o antigo; se ele não responder (por exemplo, o registro DNS ainda não aponta para a VM), nada muda. O banco, as fichas e os usuários continuam os mesmos. Os links antigos deixam de funcionar. Se usa o login Microsoft, troque o URI de redirecionamento no Entra (a tarefa lembra disso).
- **Apagar:** para acampamentos que deixaram de existir. Digite o nome da pasta para confirmar. Antes de apagar, é feito um backup do banco em `/var/backups/prefichas-apagados/NOME-DATA/` (com instruções de restauração). O endereço sai do ar, os containers e dados são removidos e a pasta vai para `/var/lib/prefichas-gerenciador/lixeira/` por 30 dias. Se o backup falhar, nada é apagado; só marque "apagar mesmo sem backup" se o sistema estiver quebrado.

### Modalidade só para homens (ou só para mulheres)

Ao criar ou editar uma modalidade (menu **Modalidades**), o campo **"Quem pode se inscrever"** permite escolher **Só homens** ou **Só mulheres**. O formulário passa a oferecer essa modalidade apenas a quem informou o sexo correspondente, e o servidor recusa inscrições fora da regra. Vale para novas inscrições; as fichas que já existem não mudam.

## Painel da VM: backup diário no OneDrive

Aba **Backups** do painel central. Os administradores dos acampamentos não veem esta parte.

**Preparar (uma vez):**
1. No Microsoft Entra: **Registos de aplicações → Novo registo** "Pré-fichas Backup" (contas só desta organização). Em **Autenticação → Definições avançadas**, ative **"Permitir fluxos de cliente público"**. Em **Permissões de API → Microsoft Graph → Permissões delegadas**, adicione **Files.ReadWrite** e **offline_access**.
2. No painel, cole o **ID do diretório** e o **ID do aplicativo** e salve.
3. Clique em **Conectar o OneDrive**: aparece um código; abra o endereço indicado, entre com a conta que vai guardar os backups e digite o código.
4. Clique em **Gerar chave de recuperação** e **guarde a chave fora do servidor** (cofre de senhas ou impressa). Ela aparece uma vez só. **Sem ela, nenhum backup pode ser aberto.**
5. Marque **Fazer o backup automaticamente todo dia**, escolha o horário e salve.

**Como funciona:** todo dia, um arquivo por acampamento vai para `PreFichas-Backups/<acampamento>/` no OneDrive, cifrado. Ficam os últimos N dias e um backup por mês dos últimos M meses.

**Restaurar:** em **Backups no OneDrive**, escolha o acampamento e o backup → **Restaurar…** → cole a chave de recuperação, digite o nome da pasta e confirme. Antes de restaurar, o sistema confere a chave, faz um backup de segurança local do banco atual e, se algo falhar, nada é alterado. **Servidor novo:** instale o painel, conecte o mesmo OneDrive, crie a instância com o **mesmo nome** (Nova instância) e restaure nela.

## Painel da VM: mensagens de aniversário (SMS)

Aba **Mensagens** do painel central, pelo **textbee.dev** (um celular Android com o app do textbee envia os SMS).

**Preparar:** crie a conta no textbee, instale o app no celular e conecte-o; em **app.textbee.dev → API Keys**, crie uma chave. No painel, cole a chave (e o ID do aparelho, se tiver mais de um), confira as mensagens e use **Enviar mensagem de teste**. Depois marque **Enviar automaticamente todo dia** e escolha o horário.

**Quem recebe:** só **campistas** (quem já participou) de todos os acampamentos: no aniversário e no aniversário de acampamento (pela data de início da edição). A mesma pessoa em dois acampamentos recebe uma vez. Quem responder **SAIR** (ou PARAR) deixa de receber; também dá para bloquear um número pelo painel.

**Atenção ao plano do textbee:** o gratuito permite 50 mensagens por dia e 300 por mês. Com ~40 mil pessoas, os aniversários dos campistas passam disso: use o plano Pro (5.000/mês) ou maior e ajuste o **máximo por dia**. Use **Ver prévia de hoje** para saber quantas mensagens sairiam.
