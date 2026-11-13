# Histórico de versões

## 2.29.1 — VPN por SSL-VPN

- O assistente de linha de comando do FortiClient VPN gratuito só cria perfis **SSL-VPN** (IPsec nele só pela interface gráfica, e o motor IPsec do Linux só aceita IKEv2). A VPN do servidor passa a ser SSL-VPN: instruções do script, do painel e da documentação atualizadas (FortiGate: SSL-VPN em modo túnel, split tunnel, política de `ssl.root`; saída TCP na porta do SSL-VPN).

## 2.29.0 — FortiClient VPN gratuito (sem EMS)

- O pacote do repositório `repo.fortinet.com` é o FortiClient **completo** (7.4.8), que se registra num EMS e, sem EMS, recusa o IPsec: `IPsec VPN is disabled while registered to EMS`. O `vpn-fortinet.sh configurar` agora instala o **FortiClient VPN gratuito** (só VPN, 7.4.3.5411) baixado da Fortinet, conferindo o **SHA-256 fixado** no script; se a edição completa estiver instalada, ela é removida, o repositório dela é apagado e a versão fica travada (`apt-mark hold`).
- Os argumentos de usuário seguem a edição instalada: a gratuita usa `--user` + `--password` (pede a senha), a completa usa `--username`.
- O painel avisa se a edição instalada for a completa (EMS).

## 2.28.1 — FortiClient: pasta de execução do usuário

- Correção de `Error: failed to find runtime user dir`: o FortiClient exige `XDG_RUNTIME_DIR` (`/run/user/<uid>`), que só existe quando alguém faz login. O script cria essa pasta para o usuário `prefichas-vpn` (dono só ele, 700) e a informa a cada comando do FortiClient.

## 2.28.0 — Senha da VPN pelo painel

- **Correção:** o FortiClient 7.4 usa `--username` (não `--user`/`--password`, que não existem nessa versão); a senha é pedida no prompt. O `configurar` agora conecta com `--username … --save-password --always-up --auto-connect`, e a reconexão automática também informa o usuário.
- **Configurações → VPN → Senha da VPN:** grava a senha do usuário no chaveiro do FortiClient e reconecta, mostrando se o túnel subiu. A senha vai do pedido direto para o prompt do FortiClient por um pseudo-terminal: nunca aparece em argumento de comando, variável de ambiente, log, tarefa ou auditoria, e não volta para a tela.

## 2.27.0 — FortiClient sem root

- O FortiClient 7.4 recusa rodar como root (`please run this command under non-root user`) e precisa de sessão D-Bus e chaveiro para guardar a senha (`dbus-launch: executable file not found`). Agora o `vpn-fortinet.sh` cria o usuário de sistema `prefichas-vpn` (sem login), instala `dbus-x11` e `gnome-keyring` e roda todo comando do FortiClient (criar perfil, conectar, vigia, reconectar, situação) como esse usuário, numa sessão D-Bus com o chaveiro destravado.
- A senha do chaveiro é aleatória, fica em `/etc/prefichas/vpn-chaveiro` (só root, 600) e é entregue por descritor de arquivo, nunca na linha de comando.
## 2.26.0 — Túnel da Cloudflare como parte do sistema

- O túnel único não é mais tratado como acampamento: a pasta saiu de `/opt/prefichas-tunel` para `/var/lib/prefichas-tunel` (a antiga é movida sozinha) e o nome `prefichas-tunel` é reservado. Ele não aparece em Instâncias, não entra no backup (acabou o erro de backup dele) e não pode ser atualizado nem apagado como instância.
- **Religar o túnel:** quando o túnel está parado ou o container foi apagado, o cartão "Túnel único da Cloudflare" mostra o botão **Religar o túnel**, que sobe o cloudflared de novo no mesmo túnel, com os mesmos endereços. Também pelo terminal: `tunel-compartilhado.sh religar`.

## 2.25.0 — VPN só com FortiClient

- **strongSwan removido:** o script `vpn-ipsec-strongswan.sh`, a detecção dele no painel e a troca de chave/senha que só funcionava com ele saíram do sistema. A VPN do servidor passa a ser só o **FortiClient**.
- **Configurações → VPN do servidor (FortiClient)** mostra a configuração: perfil, usuário, redes internas pela VPN, **IP do servidor na VPN**, **versão do FortiClient** (com aviso se não for da linha 7.4, a do FortiOS 7.4.x do FortiGate), reconexão automática e a situação do túnel. Senha e PSK nunca aparecem (linhas com senha/chave são filtradas do que o FortiClient informa).
- **Editar/registrar a configuração pelo painel:** perfil, redes e usuário (o perfil é criado no FortiClient pelo terminal); grava `/etc/prefichas/vpn-forticlient.env` e liga a reconexão automática. Serve também para perfis criados à mão.
- Novo comando `vpn-fortinet.sh registrar` (usado pelo painel).

## 2.24.0 — backup diário no OneDrive e mensagens de aniversário (painel da VM)

Tudo gerido **só pelo painel da VM** (os administradores dos acampamentos não veem nada disso).

### Backup na nuvem (aba **Backups**)
- Todo dia, no horário escolhido, um backup **por acampamento** vai para o **OneDrive** (pasta `PreFichas-Backups`, uma subpasta por acampamento).
- **Cifrado antes de sair do servidor** (age). No servidor fica só a chave **pública**; a **chave de recuperação** aparece **uma vez** no painel para ser guardada fora do servidor. Sem ela nenhum backup abre — nem quem tiver acesso ao OneDrive consegue ler os dados.
- Nenhum dump em claro é gravado em disco (o banco vai direto para a cifragem e para o envio).
- Conexão ao OneDrive por **código de login Microsoft** (sem colar senha); guarda só o token de atualização (arquivo 600).
- **Retenção**: N backups diários + 1 por mês por M meses (padrão 14 + 6); o resto é apagado do OneDrive.
- **Restaurar** pela lista de backups de cada acampamento: cola-se a chave de recuperação (usada só naquele momento, não fica gravada), confirma-se o nome; o sistema confere se a chave abre o arquivo **antes** de mexer no banco, faz um backup de segurança local, restaura numa transação única (se falhar, nada muda) e religa o sistema. Para a VM nova: crie a instância com o mesmo nome e restaure nela.

### Mensagens de aniversário (aba **Mensagens**, SMS pelo textbee.dev)
- Todo dia, no horário escolhido, o painel lê os bancos de **todos os acampamentos** e envia parabéns aos **campistas**: aniversário de vida e aniversário de acampamento ("hoje faz X anos que você viveu o 16º Sênior").
- Mensagens editáveis com `{nome}`, `{anos}`, `{acampamento}`, `{comunidade}`; mensagens padrão de teor católico.
- A mesma pessoa em mais de um acampamento recebe **uma** vez; ninguém recebe duas vezes no mesmo dia; **limite diário**; para se o textbee recusar por limite do plano.
- **"Para não receber, responda SAIR."** (ligado por padrão): respostas SAIR entram na lista de bloqueio automaticamente; também dá para bloquear/desbloquear um número no painel.
- **Prévia** de hoje (sem enviar), **mensagem de teste** e histórico do dia; telefones sempre mascarados no painel e na auditoria. A chave da API do textbee fica só no servidor.

## 2.23.1 — correção urgente: atualização de instâncias existentes não iniciava

- Na 2.23.0 o servidor lia a coluna `sexo` das modalidades **antes** de rodar a migração `022` que a cria. Instâncias que já tinham a tabela de modalidades (2.20 em diante) caíam ao iniciar (`column "sexo" does not exist`) e ficavam reiniciando em loop (o atualizador ficava em "Aguardando a aplicação voltar…").
- Agora o servidor só lê a lista de modalidades depois das migrações, e tolera tabela/coluna ainda inexistentes na partida (erros 42xxx).
- Novos testes de partida: sobem o servidor contra um banco **vazio** e contra bancos **parados em cada um dos últimos 6 estados do esquema** (atualização). Confirmado que falham sem a correção.
- Quem ficou com o app reiniciando: atualize de novo (`./scripts/atualizar.sh`, ou "Atualizar" no painel central).

## 2.23.0 — modalidade só para homens ou só para mulheres

- Na tela **Modalidades**, cada modalidade tem **"Quem pode se inscrever"**: Homens e mulheres (padrão), **Só homens** ou **Só mulheres**. O formulário só oferece a modalidade a quem informou o sexo correspondente e o servidor recusa a inscrição fora da regra ("Esta modalidade é só para homens."). Vale também na troca de modalidade pela revisão e na importação (avisa em "revisar").
- Vale para **novas** inscrições; fichas existentes não mudam. Sênior e Casais não restringem por sexo. Migração `022`.

## 2.22.0 — menu na lateral esquerda

- O menu do painel passa a ficar **na lateral esquerda, um item embaixo do outro** (fixo ao rolar a página), em vez de uma faixa comprida no topo. O item atual fica destacado. Em telas estreitas (celular) o menu volta a ser uma faixa rolável no topo.

## 2.21.2 — Acampamentos: a modalidade ativa não era usada

- Ao cadastrar um acampamento (edição), a tela vinha com a modalidade **Juvenil** fixa por baixo: se Juvenil estivesse desativada (por exemplo, só "Homens" ativa), a lista mostrava "Homens" mas o pedido saía como Juvenil e dava "Esta modalidade está desativada". Agora a modalidade inicial é a **primeira ativa** e a lista sempre reflete o valor enviado (uma edição antiga de modalidade desativada aparece como "(desativada)").
- Mesmo cuidado na tela de preferência do cônjuge.

## 2.21.1 — correção urgente: o sistema não iniciava (instalações novas e atualizações)

- Na 2.20.0 o servidor lia a tabela de modalidades **antes** de rodar as migrações que a criam, e caía ao iniciar (`relation "modalidades" does not exist`), ficando reiniciando em loop. Afetava **instância nova** (o instalador ficava "Aguardando o sistema iniciar…") e **atualização** de instâncias existentes.
- Agora a lista é carregada **depois** das migrações (e os comandos de terminal também). Novo teste de partida a frio: sobe um servidor de verdade contra um banco vazio.
- Quem já atualizou para a 2.20/2.21 e ficou com o app caindo: atualize para a 2.21.1 (`./scripts/atualizar.sh` na pasta da instância, ou "Atualizar" no painel central).

## 2.21.0 — painel central: trocar o link e apagar instância

- **Trocar o link de acesso** (Instâncias → "Trocar link"): muda o endereço de um acampamento (outro subdomínio da Cloudflare ou domínio próprio, ou de um para o outro) **sem apagar e criar de novo**. O endereço novo é publicado e **conferido antes** de o antigo sair; se não responder, tudo volta como estava. O sistema, o banco e os usuários não mudam. Lembra de trocar o URI de redirecionamento no Entra se o login Microsoft estiver ligado.
- **Apagar instância** (Instâncias → "Apagar"), para o acampamento que deixou de existir: exige **digitar o nome da pasta**; faz **backup do banco** (guardado em `/var/backups/prefichas-apagados/`), tira o endereço do túnel/proxy, remove containers e dados e **move a pasta para uma lixeira por 30 dias** (nada é apagado com `rm -rf`). Se o backup falhar, **nada é apagado** (a menos que se marque "apagar mesmo sem backup"). O gerenciador e o proxy não podem ser apagados.

## 2.20.0 — modalidades cadastráveis

- Novo menu **Modalidades** (administrador): **criar** modalidades novas (nome, idade mínima e máxima, só casado(a) opcional), **editar** as existentes, **reordenar**, **desativar/ativar** e **excluir** as que ninguém usa. As cinco de sempre (Mirim, FAC, Juvenil, Sênior, Casais) continuam como padrão.
- A lista cadastrada vale em todo o sistema: formulário (só as ativas e compatíveis com a idade e o estado civil), edições dos acampamentos, preferências, filas por modalidade, filtros, resumos, importação e revisão de modalidade.
- **Sênior e Casais** têm regras próprias (casado(a) 18+ / cônjuge já campista): neles se edita nome, idade mínima e ordem; não se excluem (só se desativam).
- **Desativada:** some das novas inscrições e edições; fichas e edições antigas continuam e podem ser editadas. **Excluir** só sem nenhuma ficha, edição ou preferência.
- Mudar a faixa de idade não altera fichas já existentes. O banco só aceita modalidades cadastradas (chave estrangeira no lugar da lista fixa). Migração `021`.

## 2.19.1 — núcleo pelo grupo do Entra: mais casos e mais pistas

- **Coordenador que já existia** (cadastrado à mão ou que estava aguardando liberação) e que agora está em algum grupo de núcleo passa a **acompanhar o Entra**: o núcleo vem do grupo. Sem nenhum grupo de núcleo ele continua como estava (núcleos definidos à mão). Administradores e equipe nunca são alterados.
- **Buscar grupo por nome** (Núcleos): para grupos criados à mão **sem** o prefixo "Pré-fichas" (por exemplo "Santo Amaro da Imperatriz"). O grupo com o nome do núcleo, com ou sem o prefixo, é ligado sozinho.
- O log de cada entrada pela Microsoft agora diz quantos grupos vieram no token e quantos casaram com núcleos (e por que os grupos não foram aplicados, quando é o caso).

## 2.19.0 — ler os grupos do Entra e apagar o grupo junto com o núcleo

- **Ler grupos do Entra** (Núcleos): encontra os grupos cujo nome começa com "Pré-fichas" (inclusive os criados à mão). O grupo com o mesmo nome do núcleo ("Pré-fichas – NÚCLEO", sem diferenciar maiúsculas/acentos) é **ligado sozinho**; os demais aparecem em **"Grupos do Entra sem núcleo"** para você escolher o núcleo. Também acusa quando um grupo **não existe mais** no Entra.
- **Leitura automática** a cada 1, 3, 7, 15 ou 30 dias (ou só pelo botão), escolhida na própria página de Núcleos.
- **Excluir núcleo pode apagar também o grupo no Entra** (pergunta na hora). Travas: só apaga grupo **criado pelo sistema**, cujo nome ainda **comece com "Pré-fichas"**; se não houver permissão ou o nome mudou, o núcleo **não é excluído** e o motivo é mostrado. Grupo ligado à mão nunca é apagado por aqui.
- Cada núcleo mostra o grupo ligado (nome, "criado pelo sistema"/"ligado" ou "não existe mais no Entra").
- **Permissões do aplicativo:** ler exige `Group.Read.All`; apagar exige `Group.ReadWrite.All` (maior poder que o `Group.Create` das versões anteriores; veja o manual). Sem elas, cada ação avisa o que falta e o resto continua funcionando.
- Migração `020`.

## 2.18.0 — menus renomeados

- **Fila** passa a se chamar **Pré Ficha - Espera**.
- **Nomes (A–Z)** vira dois menus: **Campistas** (só quem já fez o acampamento, de todos os núcleos) e **Todos** (campistas e também quem está esperando), ambos em ordem alfabética, com busca e exportação.

## 2.17.0 — coordenadores podem ver todas as fichas (opção)

- Configurações → **Coordenadores de núcleo**: "podem ver todas as fichas?" **Não** (padrão) = como sempre, só as do núcleo dele. **Sim** = consulta as fichas de **todos** os núcleos, mas **só altera** (status, recusa, fim da fila, modalidade…) as do seu próprio núcleo; as de fora abrem em modo somente leitura.
- Só o administrador liga/desliga. A consulta vale para a Fila, o detalhe, o histórico, a impressão, a foto e a Auditoria.

## 2.16.0 — o sistema cria os grupos de núcleo no Entra

- Núcleos → **Criar grupos no Entra** (só administrador): cria um grupo de segurança "Pré-fichas – NÚCLEO" para cada núcleo que ainda não tem e guarda o ID. Não recria o que já existe.
- Usa o Microsoft Graph com **uma única permissão de aplicação, `Group.Create`** (só cria grupos novos; não lê, altera nem apaga grupos existentes, e não mexe em membros). Quem põe os coordenadores nos grupos é o Entra.
- Sem a permissão, o sistema avisa o que falta e não grava nada. O segredo nunca aparece em respostas.
- O token de ID passa a trazer os grupos pela afirmação "Grupos de segurança" (não é mais preciso atribuir cada grupo à aplicação).

## 2.15.0 — coordenadores entram pelo Microsoft com o núcleo definido pelos grupos do Entra

- Novo modo em Configurações → Login com a Microsoft: **"Entrar direto como coordenador, com o núcleo definido pelos grupos do Entra"** (sem liberação manual). Cada núcleo guarda o **ID do grupo do Entra** (Núcleos → editar).
- Na 1ª entrada, quem está em algum grupo de núcleo vira **coordenador** (nunca administrador) dos núcleos dos seus grupos. Quem não está em nenhum grupo **não entra** e nada é criado.
- A cada entrada os núcleos acompanham os grupos; quem sai de todos perde os núcleos e as sessões abertas, e não entra mais. Usuários cadastrados à mão (inclusive administradores) **não são alterados** pelos grupos. Cadastros que estavam aguardando liberação são promovidos quando o grupo chega.
- Pessoas em muitos grupos (o token da Microsoft não traz a lista) são recusadas com aviso. O modo antigo ("aguardar liberação") continua disponível e é o padrão.
- Migração `019`.

## 2.14.1 — diagnóstico do login Microsoft

- Quando o login Microsoft é recusado, o log do servidor agora traz o motivo detalhado (o código `AADSTS…` da Microsoft, por exemplo segredo errado ou URI diferente). Isso só vai para o log, nunca para a tela.

## 2.14.0 — login com a conta Microsoft corporativa

- Botão **"Entrar com a Microsoft"** no login do painel (Microsoft Entra ID / Microsoft 365) por **OpenID Connect** (authorization code + PKCE), restrito a **um diretório (tenant)**. A senha continua funcionando.
- O token é conferido no próprio sistema, sem biblioteca de terceiros: assinatura (chaves públicas da Microsoft), emissor, diretório, destinatário, validade e nonce; `state` e PKCE de uso único.
- A conta é ligada ao **identificador da pessoa na Microsoft (oid)**, não só ao e-mail: outro usuário Microsoft com o mesmo e-mail é negado.
- Quem entra pela 1ª vez sem acesso vira **cadastro aguardando liberação** (opção em Configurações); o administrador libera em Usuários.
- **Cada acampamento é um tenant: quem liga é o painel central da VM.** Em Instâncias → coluna "Login Microsoft" → configurar, o administrador da VM liga ou desliga o login Microsoft **por acampamento** (por exemplo, só o São Padre Pio) e informa o ID do diretório, o ID do aplicativo e o segredo. O painel grava no `.env` daquele acampamento e reinicia só ele; os demais continuam só com senha.
- O **segredo** fica só no `.env` do acampamento (nunca no banco, na tela, nos logs nem na auditoria); em branco = mantém o guardado. Desligar mantém os dados para religar sem digitar tudo.
- No painel do acampamento, Configurações → Login com a Microsoft só mostra a situação e a opção "criar cadastro pendente" para quem entra pela primeira vez.
- Migração `018`. Quem entra pela Microsoft usa o autenticador/MFA da própria Microsoft (não pede o código de duas etapas do sistema).

## 2.13.0 — revisar modalidade e filtro de sexo

- **Alterar a modalidade da ficha** (administrador e coordenador de núcleo, dentro do seu núcleo), no detalhe da ficha. Só aceita modalidades compatíveis com a idade e o estado civil; Casais continua só pela conta (exige conferir o cônjuge). A data de inscrição e a posição na fila **não mudam**. Fica registrado no histórico (quem, de qual para qual).
- **Menu "Revisar modalidade"**: lista as fichas com a palavra "revisar" nas observações internas (as importadas com modalidade fora da regra). Para cada uma: alterar ou manter a atual; a marca "revisar" sai da observação e fica registrado quem revisou.
- **Coluna e filtro "Sexo"** (Masculino/Feminino) na Fila.
- Migração `017` (tipo "modalidade" no histórico).

## 2.12.0 — importação cria a conta de cada pessoa com CPF

- Cada ficha importada **com CPF** ganha uma conta: **usuário = CPF e senha inicial = CPF** (a pessoa pode trocar depois; a área da conta mostra um aviso recomendando a troca). CPF que já tem conta só é vinculado à ficha.
- A ficha aparece na área da conta da pessoa. E-mail passa a ser opcional na conta (repetido ou ausente na planilha: a conta fica sem e-mail e "Esqueci minha senha" não se aplica).
- O hash da senha é gravado no primeiro acesso (a importação continua rápida).
- **Desfazer** apaga também as contas do lote que ninguém usou; se alguma já foi usada, pede confirmação extra.
- Migração `016`. Atenção: senha = CPF só protege contra quem não sabe o CPF; o bloqueio por tentativas errada continua valendo.

## 2.11.0 — PWA (instalável no celular)

- O formulário e o painel podem ser instalados na tela inicial (Android/Chrome: "Instalar app"; iPhone/Safari: Compartilhar → "Adicionar à Tela de Início").
- Manifesto por acampamento (`/manifest.webmanifest` e `/admin/manifest.webmanifest`) com nome e cor da marca; ícones 192/512/maskable e ícone da Apple.
- Service worker seguro: só guarda arquivos públicos (`/assets/*`). **Nada de `/api` nem de páginas é guardado**: nenhum dado pessoal fica no aparelho. Sem internet, abre uma página "Sem conexão".
- Exige HTTPS (já é o caso em produção).

## [2.10.1]

- Fila: o filtro da coluna "Nome" travava ao abrir com o banco cheio. Ordenação passou a usar um único comparador (60× mais rápido) e a busca no filtro não recalcula mais a cada tecla.

## 2.10.0 — cadastro e inscrição em uma etapa só

- **Novo campista: um formulário só.** Ao clicar em **"Cadastre-se e faça a inscrição"**, abre direto o formulário completo: **Seu acesso** (CPF, senha e foto opcional), dados pessoais, religiosos, contato,
  endereço, **escolha da modalidade** (já mostrando só as que a idade e o estado civil permitem) e informações adicionais. Antes eram duas etapas (criar a conta e depois se inscrever).
- **Tudo ou nada:** a conta e a pré-ficha são criadas juntas, numa transação. Se a ficha for recusada (duplicada, limite por contato...), a conta também não é criada. A pessoa sai logada e a ficha já nasce ligada à conta.
  O **e-mail** informado em "Contato" é o login.
- **Não duplica:** quem já tem pré-ficha ativa com o **mesmo CPF** (por exemplo, importada de outra planilha) ou com o mesmo nome e data de nascimento não cria outra: a resposta pede para falar com a
  coordenação, a conta não é criada e fica uma nota na ficha existente. Quem já fez a modalidade (pelo CPF) é avisado.
- **Casais** continua pela área da conta (depois do cadastro), porque exige conferir o cônjuge.
- Robô (campo invisível) e a verificação "não sou um robô" (se configurada) valem também no cadastro; o limite geral de envios por hora é compartilhado com o formulário público.
- **Correção:** o limite de envios **por telefone** (mesmo telefone em 24 horas) nunca funcionou por um erro de escape no SQL (`'\D'` virava `D`); só o limite por e-mail valia. Corrigido.

## 2.9.0 — filtros por coluna na fila (estilo Excel)

- **Cada coluna da fila tem um botão de filtro** (funil) no cabeçalho, como o filtro automático do Excel: **classificar** (A→Z / Z→A, menor→maior, mais antigo→mais novo), **pesquisar** e **marcar/desmarcar valores**
  (com a contagem de cada um), **OK**, **Cancelar** e **Limpar**.
  - **Nome, Idade, Modalidade, Cidade, Status:** lista de valores. Cidade agrupa as grafias ("Florianopolis" e "Florianópolis").
  - **Na fila desde:** árvore por **ano e mês** (marcar o ano marca os meses).
  - **Pos.:** faixa **de/até**. **Telefone:** **contém** (ignora a máscara).
- **Como no Excel**, a lista de uma coluna mostra só o que sobrou dos filtros das **outras** colunas, e pesquisar marca só os resultados.
- A coluna filtrada fica destacada, há um aviso "N de M fichas" com **limpar filtros das colunas**, e **Exportar CSV** leva só as linhas filtradas e na ordem escolhida.
- Funciona junto com os filtros do topo (modalidade, status, busca, núcleo, cidade, bairro). Acessível: teclado, `Esc` fecha, `aria-sort` nos cabeçalhos.

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
