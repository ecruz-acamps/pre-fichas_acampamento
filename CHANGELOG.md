# Histórico de versões

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
