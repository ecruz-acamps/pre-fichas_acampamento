# Histórico de versões

## 2.8.0 — importar pela tela (CSV ou Excel) e reconhecer quem é quem

- **Configurações → "Importar pré-fichas de uma planilha"** (só administrador): envia o arquivo **CSV ou Excel (.xlsx)**, mostra a **simulação** (nada é gravado), permite baixar as listas de
  quarentena, de conferência e das ignoradas, e só importa depois da confirmação. Abaixo, a lista das importações feitas, com **Desfazer** (se a equipe já mexeu nas fichas, pede uma confirmação extra).
- **Leitor de Excel próprio**, sem biblioteca de terceiros, com limites contra arquivo malformado ou "bomba de zip"; lê textos, números que perderam o zero à esquerda e datas guardadas como número.
  Na planilha real, o resultado com Excel é idêntico ao do CSV.
- **Reconhece quem é quem pelo conteúdo:** com "Data da Pré-Ficha" + "Aguardando Acampamento" → **na fila**; sem elas, mas com "Onde Fui Campista" → **campista que já participou** (ficha "Já participou",
  fora da fila, com a participação registrada; a modalidade é a do acampamento que fez; a data de inscrição é a da importação, porque a planilha não tem data); sem nenhum dos dois → **quarentena**, sem adivinhar.
  Lista de "todos" com as duas coisas misturadas funciona, e cada CPF vira uma pessoa só.
- Correção: o "desfazer" passou a considerar "mexida pela equipe" a atualização, os vínculos e o histórico (antes olhava o status, o que travaria o desfazer de campistas importados).
- Migração `015` (quem fez a importação).

## 2.7.0 — importar pré-fichas de uma planilha (CSV)

- **Comando de importação** (`./scripts/importar-fichas.sh planilha.csv`): primeiro uma **simulação** com relatório (não grava nada); com `--aplicar`, grava tudo numa
  **única transação** (ou entra tudo, ou nada). Cada importação é um **lote** e pode ser **desfeita** (`desfazer LOTE`; se a equipe já mexeu nas fichas, exige `--forcar`).
- **A "Data da Pré-Ficha" da planilha é mantida** como data de inscrição e de entrada na fila (a ordem da fila não muda; no mesmo dia vale a ordem da planilha). O gatilho
  do banco que fixa a data em "agora" só abre exceção dentro de uma importação autorizada e com o lote preenchido; a data de uma ficha continua imutável depois.
- **Nada é inventado:** e-mail, CEP, "por que participar" e "como conheceu" podem ficar vazios só nas fichas importadas (o banco continua exigindo tudo de quem se
  inscreve agora). A modalidade esperada é mantida e, se não bate com a regra do sistema, a ficha recebe "REVISAR MODALIDADE" nas observações. "FAC II" vira FAC, "Separado"
  vira Divorciado(a) e "Padre" vira Solteiro (com nota). CPF inválido: a ficha entra sem CPF, com aviso.
- **Quarentena** (não importadas, com o motivo em `quarentena.csv`): data de nascimento impossível/improvável (provável erro de digitação), modalidade/sexo/estado civil
  desconhecidos, telefone inválido, CPF repetido na planilha. Quem já tem ficha ativa com o mesmo CPF no sistema é ignorado (sem duplicar).
- **Histórico vira participação:** "16º Sênior - São Padre Pio (Vermelha)" cria a edição (se faltar) e registra a participação com a tribo (tribos que a marca não tem são
  acrescentadas); por isso a regra do **Casais** passa a reconhecer esses campistas. "Foi servo", campistas conhecidos e dados de casamento vão para as observações internas.
- Lê CSV em UTF-8 ou "ANSI" do Excel, com `;` ou `,`, e recupera CPF que perdeu o zero à esquerda.
- O painel passa a abrir fichas sem e-mail/CEP (e não as marca como "repetidas" entre si na fila). Migração `014`.

## 2.6.0 — coordenadores e equipe se cadastram sozinhos; o administrador só libera

- **Cadastro pela própria pessoa:** na tela de login do painel há **"Quero me cadastrar"** (nome, e-mail e senha). O usuário nasce **sem nenhum acesso**
  (pendente) e recebe um link para **confirmar o e-mail**.
- **O administrador só libera:** em Usuários, a seção **"Cadastros aguardando liberação"** mostra quem pediu (com o selo "e-mail confirmado" ou
  "não confirmado") e permite escolher o **papel** (padrão: Coordenador de núcleo) e os **núcleos** e **Liberar acesso**, ou **Recusar**. A permissão continua vindo do
  cadastro do usuário; só quem pode criar e liberar é o administrador. A pessoa é avisada por e-mail quando é liberada, e os administradores são avisados quando um
  cadastro confirma o e-mail (se o servidor de e-mail estiver configurado).
- **Segurança:** quem se cadastra não vê nem altera nada até ser liberado; o login explica o motivo só a quem acertou a senha; **cadastrar um e-mail que já existe não
  muda nada** (não dá para tomar a conta de um administrador) e a resposta é igual; limite de 5 cadastros por hora por origem; no máximo 50 pedidos pendentes (e pedidos
  com mais de 30 dias são descartados); pendente não recebe "Esqueci minha senha" nem "Nova senha".
- **Interruptor em Configurações → "Cadastro da equipe":** Sim/Não. Em "Não", só o administrador cria usuários (como antes).
- Migração `013`.

## 2.5.0 — foto (opcional) na conta do participante

- **Foto na criação da conta**, opcional: o participante tira ou escolhe uma foto ao se cadastrar (no celular abre a câmera ou a galeria) e pode
  **trocar ou remover** quando quiser, na área dele. A foto vale para todas as inscrições da conta.
- **Aparece para a equipe** no detalhe da ficha (seção "Conta do participante") e na **ficha impressa** (canto superior direito, formato 3x4).
  Quem pode ver a ficha pode ver a foto: o escopo por núcleo vale também para a foto.
- **Preparada no aparelho:** recorte retrato (3:4), redução (máx. 640 px) e conversão para JPG, saindo com poucas dezenas de KB.
- **Segurança e privacidade:** o servidor não confia no navegador. Só aceita JPEG de até 300 KB (32–2000 px), confere a estrutura do arquivo
  (recusa truncado, formatos disfarçados e bytes escondidos depois do fim da imagem) e **remove EXIF/GPS, miniaturas e comentários**. A foto fica numa
  tabela própria (não pesa nas listas e não vai nas exportações), é servida sem cache compartilhado e com `nosniff`, e some junto com a conta.
- Migração `012` (tabela `participantes_fotos`).

## 2.4.0 — um túnel único da Cloudflare para a VM inteira

- **Um só túnel e um só `cloudflared` para todos os acampamentos.** Antes, cada acampamento publicado pela Cloudflare criava o próprio túnel e
  o próprio container. Agora o primeiro cria o túnel único da VM (container `prefichas-tunel`) e cada acampamento novo é apenas um endereço a mais
  dentro dele (`endereço → 127.0.0.1:porta`) mais o registro DNS. Novo `scripts/tunel-compartilhado.sh`
  (`verificar`, `adicionar`, `remover`, `listar`, `unificar`).
- **Falha cedo:** antes de instalar um acampamento pela Cloudflare, o sistema confere token, zona e permissões e diz exatamente o que falta
  (Conta › Cloudflare Tunnel › Editar, Zona › DNS › Editar, Zona › Zona › Ler).
- **Unificar túneis** (painel central → Configurações → "Túnel único da Cloudflare", ou `sudo ./scripts/tunel-compartilhado.sh unificar`):
  move os acampamentos que ainda têm túnel próprio. Para cada um, publica no túnel único, **confere que o site responde** e só então desliga e apaga
  o túnel antigo; se não responder, o DNS volta ao túnel antigo e nada muda para o público.
- Ligar/desligar a publicação pela Cloudflare no painel do acampamento passa a usar o túnel único (desligar tira só aquele endereço).
- O painel central mostra o estado do túnel único (no ar, endereços) e quantos acampamentos ainda têm túnel próprio.
- `scripts/cloudflare-tunel.sh` foi substituído por `scripts/tunel-compartilhado.sh`.

## 2.3.0 — "Esqueci minha senha" e servidor de e-mail pelo painel central

- **Esqueci minha senha no painel do acampamento** (administradores e equipe): o login tem o link; o e-mail leva um link que vale
  1 hora e uma única vez. Com a verificação em duas etapas ativa, o link sozinho não basta: é preciso também o código do
  aplicativo (a recuperação não desliga as duas etapas). Ao trocar a senha, a pessoa sai de todos os aparelhos.
- **Esqueci minha senha no painel central da VM, na própria tela:** e-mail + **código atual do autenticador** + senha nova (12+ caracteres),
  sem precisar de e-mail nem de VPN. Como o código passa a ser a única barreira desse caminho, ele é endurecido: vale só o código atual ou o
  anterior, uso único (mesmo com pedidos simultâneos), 3 erros travam a redefinição daquele usuário por 1 hora (o login normal não é afetado),
  resposta igual para usuário inexistente e código errado, e a troca derruba todas as sessões. Pode ser desligado com `REDEFINIR_POR_MFA=false`.
- **Alternativa por e-mail** no painel central ("Prefiro receber um link por e-mail"): link + código do autenticador; o executor só envia para
  usuário ativo do painel e só com link no formato esperado.
- **Servidor de e-mail pela interface** (painel central → Configurações → "Servidor de e-mail"): servidor, porta, usuário, senha de app
  e remetente. O servidor **envia um e-mail de teste antes de guardar**; a senha fica só num arquivo do administrador do sistema e nunca volta
  para a tela, a auditoria ou o log. Há "Enviar e-mail de teste", "Aplicar aos acampamentos" (grava nos já criados) e "Remover".
- Participantes já tinham "Esqueci minha senha" (sem mudança).
- Correção: se a criação de um acampamento falha, o painel agora remove a pasta incompleta (só a que ele criou), em vez de bloquear a
  próxima tentativa com "já existe".
- Migração `011` (tokens de redefinição dos usuários do painel).

## 2.2.0 — painel central sem depender de VPN

- **O painel central abre pela porta web normal (HTTPS, 443)**, com domínio próprio e certificado do Let's Encrypt emitido
  sozinho pelo proxy compartilhado da VM: `PAINEL_DOMINIO=painel.seudominio.com.br ./scripts/instalar-gerenciador.sh`
  (o `instalar.sh` também pergunta). Os usuários existentes continuam valendo. A VPN passa a ser opcional.
- Segurança do painel publicado: ele escuta só em `127.0.0.1` (a porta 9090 não fica exposta), responde só no domínio
  configurado, cookie `Secure`, HSTS, sem indexação, IP real do visitante na auditoria (só aceito vindo do proxy local) e
  **bloqueio por origem (20 erros em 15 min)** além do bloqueio por usuário. Senha + autenticador continuam obrigatórios.

## 2.1.0 — modalidade Casais

- **Nova modalidade Casais.** Ao escolhê-la, o formulário pede o **CPF do cônjuge**. A inscrição é **recusada** se o cônjuge
  não estiver cadastrado como campista no sistema (participação em algum acampamento). Só vale para casado(a) ou união estável
  e só pela conta do participante (o servidor confere o CPF do inscrito e do cônjuge).
- **Configurações → "Modalidade Casais":** menu **"Para a modalidade Casais é necessário ter feito o Sênior?" Sim ou Não**.
  Com **Sim**, os dois precisam ter feito o Sênior e a opção só abre para quem já fez; com **Não**, basta o cônjuge já ser campista.
- Segurança: a recusa do cônjuge usa a mesma mensagem para "CPF não encontrado" e "não atende" (não revela quem é campista),
  com limite de 5 tentativas erradas por hora por conta; o casal não é inscrito duas vezes; **a modalidade e o CPF do cônjuge não
  podem mais ser trocados pela área do participante** (antes, a modalidade podia ser editada depois da inscrição).
- Painel: aba **Casais** na fila, CPF do cônjuge na ficha e na impressão; acampamentos da modalidade Casais podem ser cadastrados.

## 2.0.0 — vários acampamentos na mesma VM

**Ordem de implantação:** 1) painel central → 2) acampamentos (criados pelo painel).

- **Painel central da VM** (`gerenciador/`): lista as instâncias e a situação do servidor, cria
  **novas instâncias** pelo navegador, atualiza uma ou todas, faz backup, atualiza o próprio painel,
  mostra o andamento das tarefas e mantém uma auditoria. O login exige senha e autenticador; o painel só
  abre pela VPN ou pelo próprio servidor; um executor do sistema valida tudo de novo antes de agir.
- **Instalação híbrida:** cada acampamento pode ser publicado pela **Cloudflare** (túnel), **direto**
  (domínio próprio, pelo proxy HTTPS compartilhado da VM, com certificados do Let's Encrypt) ou **só na
  rede local**. A porta interna de cada um é escolhida sozinha.
- **Instalador:** pergunta o que instalar. A opção "Painel central" prepara a VM: Docker, VPN
  FortiClient, Cloudflare, e-mail do Let's Encrypt e e-mail de envio.
- **VPN FortiClient** (IPsec) para servidor remoto, com `fechar-ssh`; strongSwan como plano B.
- **Ficha impressa** no formato de pré-inscrição, com cabeçalho personalizável.
- **Performance:** a fila com 20 mil fichas abre em 1 s em vez de 22 s; compressão; índices; atualização com
  imagem pronta do GitHub.
- **Manual de uso** (`docs/MANUAL-DE-USO.md`) e método de análise de performance (squad).

> Quem quiser continuar na versão 1 usa a branch `v1` (veja "Ficar na versão 1" em `docs/INSTALACAO.md`).

## 1.0.0 — um acampamento por instalação

Formulário e fila de espera por modalidade, painel (fila, nomes A–Z, resumo, acampamentos e tribos,
auditoria, núcleos e coordenadores, usuários, configurações da marca), recusas e fim da fila,
preferência do cônjuge, contas dos participantes (CPF/e-mail, esqueci minha senha, editar, desistir,
reinscrever), importação de contas antigas, ativação por chave, atualização pelo painel, instalação
em um comando, publicação pela Cloudflare, verificação em duas etapas e melhorias de segurança.
Preservada na branch `v1`.
