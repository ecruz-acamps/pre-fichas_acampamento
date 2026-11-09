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
8. [Nomes (A–Z) e Resumo por cidade](#8-nomes-az-e-resumo-por-cidade)
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

A aba **Fila** mostra quem está aguardando, na ordem da fila.

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

## 8. Nomes (A–Z) e Resumo por cidade

- **Nomes (A–Z)**: lista alfabética de pré-fichas e campistas (quem já fez acampamento), com busca e
  exportação. O coordenador vê os campistas de **todos** os núcleos em modo consulta e as
  pré-fichas só do seu núcleo.
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
Na aba **Configurações → VPN do servidor** você vê se a VPN está **conectada**, usa **Reconectar** quando ela cair e, no
strongSwan, **troca a chave ou a senha** com retorno automático se o túnel não subir. A configuração inicial e o
fechamento da porta 22 são feitos só pelo terminal.

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
