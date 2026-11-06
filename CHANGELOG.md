# Histórico de versões

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
