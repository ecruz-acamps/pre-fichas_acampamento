# Manual de instalação no Linux

Guia passo a passo para colocar o sistema de pré-fichas no ar em um servidor Linux próprio
(on-premises). Escrito para **Ubuntu Server 22.04/24.04** ou **Debian 12**; em outras
distribuições os comandos de instalação de pacotes mudam, o resto é igual.

**Sumário**

1. [Antes de começar](#1-antes-de-começar)
2. [Preparar o servidor](#2-preparar-o-servidor)
3. [Apontar o domínio](#3-apontar-o-domínio)
4. [Instalar um acampamento](#4-instalar-um-acampamento)
5. [Primeiro acesso, ativação e configuração](#5-primeiro-acesso-ativação-e-configuração)
6. [Vários acampamentos no mesmo servidor](#6-vários-acampamentos-no-mesmo-servidor)
7. [Rede interna, sem domínio público](#7-rede-interna-sem-domínio-público)
8. [Backup e restauração](#8-backup-e-restauração)
9. [Atualizar para uma nova versão](#9-atualizar-para-uma-nova-versão)
10. [Comandos do dia a dia](#10-comandos-do-dia-a-dia)
11. [Instalação sem Docker (avançado)](#11-instalação-sem-docker-avançado)
12. [Solução de problemas](#12-solução-de-problemas)
13. [Checklist de segurança](#13-checklist-de-segurança)
14. [Desinstalar](#14-desinstalar)

---

## 1. Antes de começar

### O que vai ser instalado

| Peça | Função |
|---|---|
| **PostgreSQL 16** | banco de dados (fica fechado dentro do servidor) |
| **Aplicação** (Node.js) | formulário público, painel da equipe e regras da fila |
| **Caddy** | HTTPS automático (certificado gratuito Let's Encrypt, renovado sozinho) |

Tudo roda em containers **Docker**, criados por um assistente (`scripts/novo-acampamento.sh`).

### O que você precisa

- **Um servidor Linux** (físico, máquina virtual ou VPS) com acesso `sudo`:

  | | Mínimo | Recomendado |
  |---|---|---|
  | CPU | 1 núcleo | 2 núcleos |
  | Memória | 1 GB | 2 GB (+0,5 GB por acampamento extra) |
  | Disco | 10 GB | 20 GB (backups crescem com o tempo) |

- **Um domínio** (ou subdomínio) para o formulário, ex.: `prefichas.acampamento-a.com.br`.
  Sem domínio também funciona dentro de uma rede interna (seção 7), mas sem HTTPS.
- **Portas 80 e 443** liberadas para a internet (no firewall do servidor e no roteador/provedor).
- **A chave de ativação** do sistema (formato `XXX-0000`), fornecida pelo responsável pela
  implantação. Ela é pedida depois da instalação; sem ela o painel e o formulário não funcionam.
- **Saída para a internet** a partir do servidor, para:
  - baixar o Docker e o código (instalação/atualização);
  - `viacep.com.br` (busca de endereço pelo CEP — se não houver, a pessoa digita o endereço);
  - Let's Encrypt (emissão do certificado HTTPS).

> Os comandos abaixo começam com `sudo` quando precisam de administrador. Copie e cole linha a linha.

---

## 2. Preparar o servidor

### 2.1 Atualizar o sistema e instalar utilitários

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates openssl
```

### 2.2 Fuso horário

```bash
sudo timedatectl set-timezone America/Sao_Paulo
timedatectl            # confira: "Time zone: America/Sao_Paulo"
```

### 2.3 Firewall

Libere apenas SSH (acesso remoto), HTTP e HTTPS:

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

> ⚠️ Rode `sudo ufw allow OpenSSH` **antes** de `ufw enable`, senão você perde o acesso remoto.

### 2.4 Instalar o Docker

Instalador oficial do Docker (Engine + plugin Compose):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

Confira:

```bash
sudo docker --version
sudo docker compose version
```

Os dois comandos devem mostrar uma versão. (Documentação oficial:
<https://docs.docker.com/engine/install/>.)

*Opcional:* para usar `docker` sem `sudo`, adicione seu usuário ao grupo e entre de novo na sessão:
`sudo usermod -aG docker $USER`. Neste manual mantemos `sudo` em todos os comandos.

---

## 3. Apontar o domínio

No painel onde o domínio está registrado (Registro.br, Cloudflare, provedor de hospedagem…),
crie um registro **A** apontando para o **IP público** do servidor:

| Tipo | Nome | Valor |
|---|---|---|
| A | `app` (para `app.seudominio.com.br`) | `IP.PÚBLICO.DO.SERVIDOR` |

Descubra o IP público do servidor com `curl -4 ifconfig.me`. Depois confira (pode levar de
alguns minutos a algumas horas para propagar):

```bash
getent hosts app.seudominio.com.br     # deve mostrar o IP do servidor
```

> Usa Cloudflare? Deixe o registro como **"DNS only"** (nuvem cinza) até o certificado ser emitido.

---

## 4. Instalar um acampamento

### 4.1 Jeito fácil: um único comando

```bash
curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
```

Ele instala o que faltar (git, curl, Docker), baixa o sistema em `/opt/prefichas-NOME` e pergunta:

1. **Nome do acampamento** (ex.: "Acampamento Exemplo") — aparece no formulário e no painel;
2. **Domínio** com HTTPS (ex.: `prefichas.seuacampamento.com.br`) — deixe vazio para usar pelo IP;
3. **E-mail e nome do administrador**;
4. **Chave de ativação** (ENTER = ativar depois pelo painel).

**Publicação na Cloudflare (opcional):** o instalador pergunta se você quer publicar agora; se sim, sugere `NOME.movimentocampista.com.br`
(pode trocar o NOME) e publica sozinho pelo **Cloudflare Tunnel**: cria o DNS e o HTTPS, sem
usar as portas 80/443 e sem abrir portas no roteador. Na 1ª instalação ele pede um token da API
da Cloudflare (crie em *dash.cloudflare.com → Perfil → Tokens de API* com as permissões
**Conta › Cloudflare Tunnel › Editar** e **Zona › DNS › Editar** para `movimentocampista.com.br`);
o token fica guardado em `/etc/prefichas/cloudflare.env` (só o root lê) e não é pedido de novo.
Outro domínio: `DOMINIO_BASE=outro.com.br`; sem Cloudflare (acesso pelo IP): `DOMINIO_BASE=`.

**Ligar ou desligar depois, pelo painel:** Configurações → *Publicação na internet (Cloudflare)*. Escolha o endereço (`NOME.movimentocampista.com.br`) e clique em **Ligar publicação**; para tirar do ar, **Desligar publicação** (o sistema continua acessível pela rede local, pelo IP). O token da Cloudflare é pedido ali na primeira vez e fica guardado só no servidor.

Sem perguntas (automação): `curl -fsSL …/instalar.sh | sudo NOME="Acampamento Exemplo" DOMINIO= ADMIN_EMAIL=voce@email.com ADMIN_NOME="Seu Nome" bash`

Se as portas 80/443 já estiverem em uso por outro programa, o instalador mostra qual é e usa uma
porta livre (padrão 8180) sem HTTPS — veja a seção de problemas comuns.

### 4.2 Jeito manual (assistente)

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-meu-acampamento
cd /opt/prefichas-meu-acampamento
sudo ./scripts/novo-acampamento.sh \
    --nome "Acampamento Exemplo" \
    --dominio prefichas.seudominio.com.br \
    --admin seu-email@exemplo.com \
    --nome-admin "Seu Nome"
```

(Se omitir alguma opção, o assistente pergunta no terminal. A chave de ativação também pode ser
informada já no comando, com `--chave XXX-0000`. Logo, cores e tribos: painel → **Configurações**
ou um arquivo baseado em [`marcas/modelo.json`](../marcas/modelo.json) com `--marca`.)

O assistente:

1. cria o arquivo `.env` com uma **senha aleatória para o banco** (só o root consegue ler);
2. baixa as imagens, gera a aplicação e sobe banco + aplicação + Caddy — **a primeira vez leva
   alguns minutos**;
3. espera a aplicação responder e cria as tabelas do banco automaticamente;
4. grava o nome do acampamento;
5. cria o **primeiro administrador** e mostra uma **senha temporária**;
6. ativa a **atualização pelo painel** (serviço do systemd que executa o botão "Atualizar agora");
7. pede a **chave de ativação** (`XXX-0000`). Se você ainda não tiver a chave, aperte ENTER:
   o painel vai pedi-la no primeiro acesso.

```
Usuário criado: seu-email@exemplo.com
Senha temporária: abcd-2345-efgh
(será pedida uma nova senha no primeiro acesso)

Chave de ativação (formato XXX-0000) — ENTER para ativar depois pelo painel: ●●●-●●●●
✓ Sistema ativado.

✓ Acampamento Exemplo instalado.
  Formulário: https://app.seudominio.com.br/    Painel: https://app.seudominio.com.br/admin/
```

**Anote a senha temporária.**

### 4.4 Conferir

```bash
sudo docker compose ps
```

Os três serviços devem estar `Up` (`db` e `app` como `healthy` após alguns segundos):

```
app:   Up (healthy)
caddy: Up
db:    Up (healthy)
```

Teste no navegador: `https://app.seudominio.com.br/` (formulário) e
`https://app.seudominio.com.br/admin/` (painel). Pelo terminal:

```bash
curl -s https://app.seudominio.com.br/api/saude      # {"ok":true}
```

> O certificado HTTPS é emitido no primeiro acesso e pode levar até 1 minuto. Se não emitir,
> veja [Solução de problemas](#12-solução-de-problemas).

---

## 5. Primeiro acesso, ativação e configuração

1. Abra `https://SEU-DOMINIO/admin/`, entre com o e-mail e a **senha temporária** e crie a sua senha.
1. Se o sistema ainda não foi ativado, aparece a tela **Ativação do sistema**: digite (ou cole) a
   chave `XXX-0000` e clique em **Ativar**. Isso é feito **uma única vez** por instalação.
   Enquanto não houver ativação, o painel fica bloqueado e o formulário público mostra
   "Inscrições em breve". (Também é possível ativar pelo terminal — veja a seção 10.)
2. **Configurações** → confira nome, cor, contatos, textos e declarações; envie a **logo**;
   ajuste as **Regras da fila** (recusas para ir ao fim da fila; edições de preferência do cônjuge).
3. **Núcleos** → crie os núcleos com as cidades/bairros de cada um. Para uma cidade dividida
   entre vários núcleos (ex.: Palhoça), use **Dividir cidade por bairros**: escolha a cidade,
   crie os núcleos e indique o núcleo de cada bairro. Bairros novos que aparecerem nas pré-fichas
   ficam marcados como "sem núcleo" nessa tela — volte lá de tempos em tempos.
4. **Usuários** → crie as contas da equipe e dos coordenadores de núcleo (cada um recebe uma
   senha temporária, que você repassa).
5. **Acampamentos** → cadastre as edições já realizadas que importam para as regras (ex.: as
   últimas de cada modalidade) — a preferência do cônjuge expira com base nelas.
6. Divulgue o link do formulário: `https://SEU-DOMINIO/`.
7. Configure o **backup** (seção 8). Não pule este passo.

---

## 6. Vários acampamentos no mesmo servidor

Cada acampamento tem **sua própria pasta, banco, usuários, marca e backups**. Um único Caddy,
instalado no servidor, recebe os acessos de todos os domínios e encaminha para cada um.

### 6.1 Instalar o Caddy no servidor

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

(Documentação: <https://caddyserver.com/docs/install>.)

### 6.2 Instalar cada acampamento com `--multi` e uma porta diferente

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-acampamento-a
cd /opt/prefichas-acampamento-a
sudo ./scripts/novo-acampamento.sh --multi --porta 3001 \
    --nome "Acampamento A" --dominio prefichas.acampamento-a.com.br \
    --admin admin@acampamento-a.com.br --nome-admin "Coordenação A"

sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-acampamento-b
cd /opt/prefichas-acampamento-b
sudo ./scripts/novo-acampamento.sh --multi --porta 3002 \
    --nome "Acampamento B" --dominio prefichas.acampamento-b.com.br \
    --admin admin@acampamento-b.com.br --nome-admin "Coordenação B"
```

Com `--multi`, o acampamento **não** sobe Caddy próprio; a aplicação fica disponível só dentro do
servidor, na porta indicada (`127.0.0.1:3001`, `127.0.0.1:3002`…).

### 6.3 Configurar o Caddy para todos os domínios

O assistente imprime o bloco de cada domínio. Edite `/etc/caddy/Caddyfile` (modelo em
[`deploy/Caddyfile.multi`](../deploy/Caddyfile.multi)):

```
prefichas.acampamento-a.com.br {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3001
}

prefichas.acampamento-b.com.br {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3002
}
```

Aplique:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Para um acampamento novo no futuro: clone em outra pasta, rode o assistente com `--multi` e a
próxima porta livre, acrescente o bloco no Caddyfile e recarregue.

> Já usa **Nginx** no servidor? Em vez do Caddy, use [`deploy/nginx.conf`](../deploy/nginx.conf)
> (um `server { }` por domínio, apontando para a porta de cada acampamento) e `certbot --nginx`.

---

## 7. Rede interna, sem domínio público

Para usar só dentro da rede da paróquia/casa de retiro, acessando pelo IP do servidor:

```bash
sudo ./scripts/novo-acampamento.sh --dominio :80 \
    --nome "Acampamento Exemplo" --admin seu-email@exemplo.com --nome-admin "Seu Nome"
```

Acesse `http://IP-DO-SERVIDOR/` e `http://IP-DO-SERVIDOR/admin/`. Nesse modo não há HTTPS:
use apenas em rede confiável. (Para HTTPS com certificado interno, veja `deploy/Caddyfile`.)

---

## 8. Backup e restauração

### 8.1 Fazer um backup agora

Dentro da pasta do acampamento:

```bash
cd /opt/prefichas-acampamento-a
sudo ./scripts/backup.sh
```

O arquivo vai para `backups/prefichas-AAAA-MM-DD_HHMMSS.dump`. Backups com mais de 30 dias são
apagados automaticamente (mude com `MANTER_DIAS=60 ./scripts/backup.sh`).

### 8.2 Backup automático todos os dias

```bash
sudo crontab -e
```

Acrescente (um por acampamento, em horários diferentes):

```
0 2 * * * cd /opt/prefichas-acampamento-a && ./scripts/backup.sh >> /var/log/prefichas-backup.log 2>&1
15 2 * * * cd /opt/prefichas-acampamento-b && ./scripts/backup.sh >> /var/log/prefichas-backup.log 2>&1
```

### 8.3 Copiar os backups para fora do servidor

Backup no mesmo disco não protege contra falha do disco, roubo ou perda do servidor. Copie
para outro lugar — por exemplo, para outro computador com `rsync` (também no cron):

```
30 3 * * * rsync -a /opt/prefichas-acampamento-a/backups/ usuario@outro-servidor:/backups/prefichas-acampamento-a/
```

Ou copie periodicamente para um HD externo / nuvem da organização. Os backups contêm dados
pessoais (LGPD): guarde-os em local protegido.

### 8.4 Restaurar

> ⚠️ Substitui **todos** os dados atuais pelos do backup.

```bash
cd /opt/prefichas-acampamento-a
sudo ./scripts/restaurar.sh backups/prefichas-2026-11-01_020000.dump
```

O script pede para digitar `RESTAURAR` como confirmação, para a aplicação, restaura e a liga de novo.

**Teste a restauração** de vez em quando (por exemplo, em outra máquina): backup que nunca foi
restaurado não é garantia.

---

## 9. Atualizar para uma nova versão

### Pelo painel (um clique)

O sistema consulta o GitHub ao iniciar e a cada 6 horas. Quando há versão nova, aparece para o
**administrador** o botão **"⬆ Atualização disponível"** no topo do painel. Ao clicar:

1. abre uma janela com **o que há de novo**;
2. em **Atualizar agora**, o servidor faz um **backup automático**, baixa o código novo, reconstrói
   e reinicia o sistema — a janela mostra cada etapa;
3. ao terminar, o painel recarrega sozinho e o botão some.

Os dados são mantidos (as mudanças no banco são aplicadas automaticamente). O sistema fica fora do
ar por alguns instantes no final. Se algo der errado, a janela mostra o motivo e o sistema continua
na versão anterior. No rodapé do painel, **verificar atualizações** abre a mesma janela a qualquer momento.

**Como funciona por baixo (segurança):** o site não tem poder sobre o servidor. Ao clicar, ele só
deixa um *pedido* em `atualizacao/pedido/` — a única pasta em que consegue escrever. Quem atualiza é
um serviço do próprio servidor (`prefichas-atualizador-<nome>`, instalado pelo assistente), que
escreve o andamento em `atualizacao/estado/`, pasta do root que o site só consegue ler. O serviço
recusa atalhos (symlinks) e nunca altera nada na pasta do site. O máximo que alguém conseguiria
pedir pelo site é "atualize para a versão oficial do GitHub".

> Instalações feitas antes desta versão: rode de novo `sudo ./scripts/instalar-atualizador.sh` e
> `sudo docker compose up -d` para passar para a estrutura de pastas nova.

> O assistente `novo-acampamento.sh` já ativa isso. Em instalações antigas (ou se o botão disser que a
> atualização pelo painel não está ativada), rode uma vez, na pasta da instalação:
> `sudo ./scripts/instalar-atualizador.sh` (sem Docker: `sudo MODO=local ./scripts/instalar-atualizador.sh`).
>
> O servidor precisa acessar `api.github.com` e `github.com`. Para desligar a verificação, use
> `ATUALIZACAO_VERIFICAR=false` no `.env`.

### Pelo terminal (alternativa)

```bash
cd /opt/prefichas-acampamento-a
sudo ./scripts/atualizar.sh
```

Faz exatamente o mesmo: mostra as novidades, faz backup, baixa, reconstrói e confere. Se alguém
alterou arquivos dentro da pasta da instalação, o script **para sem mexer em nada** e avisa — veja
com `git status` (normalmente basta desfazer com `git checkout -- .`). Sem Docker:
`sudo MODO=local ./scripts/atualizar.sh`.

Para acompanhar uma atualização feita pelo painel: `cat atualizacao/estado/log.txt` na pasta da instalação.

## 10. Comandos do dia a dia

Sempre dentro da pasta do acampamento (`cd /opt/prefichas-...`):

| Para… | Comando |
|---|---|
| Ver a situação dos serviços | `sudo docker compose ps` |
| Ver os logs da aplicação | `sudo docker compose logs -f app` (Ctrl+C para sair) |
| Reiniciar a aplicação | `sudo docker compose restart app` |
| Parar tudo | `sudo docker compose down` (os dados continuam salvos) |
| Ligar de novo | `sudo docker compose up -d` |
| Listar usuários | `sudo docker compose exec app node server/cli.js listar` |
| Criar administrador | `sudo docker compose exec app node server/cli.js criar-admin email@x.com "Nome"` |
| Criar coordenador | `sudo docker compose exec app node server/cli.js criar-coordenador email@x.com "Nome"` |
| Nova senha temporária | `sudo docker compose exec app node server/cli.js redefinir-senha email@x.com` |
| Bloquear / liberar acesso | `sudo docker compose exec app node server/cli.js desativar email@x.com` (ou `ativar`) |
| Aplicar um arquivo de marca | `sudo docker compose exec app node server/cli.js marca aplicar marcas/arquivo.json` |
| Salvar a marca atual | `sudo docker compose exec app node server/cli.js marca exportar` |
| Ativar o sistema | `sudo docker compose exec app node server/cli.js licenca ativar XXX-0000` |
| Ver se está ativado | `sudo docker compose exec app node server/cli.js licenca status` |

Os serviços voltam sozinhos quando o servidor reinicia (`restart: unless-stopped`).

---

## 11. Instalação sem Docker (avançado)

Para quem prefere instalar Node.js e PostgreSQL diretamente no sistema.

```bash
# Node.js 22 e PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx

# Banco de dados (anote a senha que você digitar)
sudo -u postgres createuser prefichas --pwprompt
sudo -u postgres createdb prefichas -O prefichas

# Aplicação
sudo useradd --system --home /opt/pre-fichas --shell /usr/sbin/nologin prefichas
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/pre-fichas
cd /opt/pre-fichas
sudo npm ci && sudo npm run build && sudo npm prune --omit=dev

# Configuração (troque SENHA pela senha do banco)
sudo tee /etc/pre-fichas.env > /dev/null <<'EOF'
DATABASE_URL=postgres://prefichas:SENHA@localhost:5432/prefichas
HOST=127.0.0.1
PORTA=3000
NOME_ACAMPAMENTO=Acampamento Exemplo
EOF
sudo chmod 600 /etc/pre-fichas.env

# Serviço (inicia junto com o servidor)
sudo cp deploy/pre-fichas.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pre-fichas
sudo systemctl status pre-fichas

# Primeiro administrador
sudo bash -c 'set -a; . /etc/pre-fichas.env; cd /opt/pre-fichas; node server/cli.js criar-admin seu-email@exemplo.com "Seu Nome"'

# Nginx + HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/pre-fichas
sudo nano /etc/nginx/sites-available/pre-fichas          # troque o server_name pelo seu domínio
sudo ln -s /etc/nginx/sites-available/pre-fichas /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.seudominio.com.br
```

Backup sem Docker: `sudo bash -c 'set -a; . /etc/pre-fichas.env; cd /opt/pre-fichas; MODO=local ./scripts/backup.sh'`.

Atualização pelo painel: rode uma vez `cd /opt/pre-fichas && sudo MODO=local ./scripts/instalar-atualizador.sh`
(o serviço `deploy/pre-fichas.service` já permite gravar na pasta `atualizacao/`). Pelo terminal:
`sudo MODO=local ./scripts/atualizar.sh`.

Logs: `sudo journalctl -u pre-fichas -f`.

---

## 11b. E-mail (Esqueci minha senha e contas antigas)

O link de "Esqueci minha senha" — e a criação de senha das contas antigas importadas — é enviado
por e-mail. O instalador pergunta um Gmail; para configurar depois, acrescente ao `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORTA=465
SMTP_USUARIO=inscricoes@gmail.com
SMTP_SENHA=senhadeappdogoogle
SMTP_REMETENTE=inscricoes@gmail.com
```

No Gmail use uma **senha de app** (myaccount.google.com → Segurança → Senhas de app; exige
verificação em duas etapas na conta Google). Depois: `sudo docker compose up -d`.

**Importar contas antigas:** painel → Configurações → *Contas dos participantes* → planilha CSV com
as colunas `cpf`, `email`, `nome`, `data_nascimento` (ou `docker compose exec app node server/cli.js
participantes importar contas.csv`). As contas entram sem senha: a pessoa clica em "Esqueci minha
senha" e cria a senha pelo link. Nunca é usado o CPF como senha.

## 11c. Atualização rápida (imagem pronta)

A cada mudança na `main`, o GitHub gera a imagem pronta do sistema (`ghcr.io/ecruz-acamps/pre-fichas_acampamento`).
A instalação e o botão **Atualizar agora** baixam essa imagem em vez de recompilar tudo no servidor
(mais rápido e sem pesar na CPU durante as inscrições). Se a imagem não estiver disponível, o sistema
reconstrói no servidor como antes.

**Uma vez só (dono do repositório):** depois da primeira publicação, em GitHub → seu perfil → *Packages* →
`pre-fichas_acampamento` → *Package settings* → *Change visibility* → **Public**. Sem isso os servidores
não conseguem baixar a imagem e continuam reconstruindo localmente (funciona, só é mais lento).

## 11d. Servidor remoto: acesso pela VPN (FortiClient) e porta 22 fechada

Quando o servidor fica num local onde você não tem acesso à rede, ele mesmo conecta no túnel do
FortiGate da sua empresa usando o **FortiClient VPN para Linux**. Você acessa o servidor pela VPN e
fecha a porta 22 para a internet. O instalador pergunta isso no final; para fazer depois:

```bash
sudo ./scripts/vpn-fortinet.sh configurar   # instala o FortiClient, abre o assistente do perfil e conecta
sudo ./scripts/vpn-fortinet.sh status       # situação do túnel e do vigia de reconexão
# a partir da rede da empresa: ssh SEU_USUARIO@IP_DO_SERVIDOR_NA_VPN  (teste antes de fechar!)
sudo ./scripts/vpn-fortinet.sh fechar-ssh   # 22 só a partir das redes da VPN; 80/443 abertas
```

**O que o script faz:**
1. Instala o FortiClient pelo **repositório oficial** `repo.fortinet.com` (versão 7.4 por padrão;
   `FORTICLIENT_VERSAO=8.0` para outra), **conferindo a impressão digital da chave de assinatura** da
   Fortinet. Se não bater, cancela.
2. Abre o assistente do próprio FortiClient (`forticlient vpn edit prefichas`). Escolha **IPsec** e preencha
   com os dados do analista: gateway, PSK, IKE e usuário. **Não** marque "todo o tráfego pela VPN".
3. Conecta com senha salva e "sempre ativo" (`--save-password --always-up`).
4. Liga um **vigia** (systemd, a cada 2 minutos) que reconecta se o túnel cair.

**Peça ao analista** o túnel IPsec para o FortiClient (Linux), com:
- gateway e porta, **PSK** e **IKEv2** (o FortiClient 7.4 não aceita IKEv1);
- usuário **sem token/2FA**, se houver, porque o servidor conecta sozinho;
- **split tunnel**, só com as redes internas;
- liberação, da rede da empresa, para o IP do servidor na VPN, na porta 22;
- no local do servidor: saída **UDP 500 e 4500** liberada;
- depois do teste, **bloquear a 22 no NAT 1:1**.

**Limitações (documentação da Fortinet):**
- A versão Linux não tem todos os recursos das versões Windows/macOS.
- Em servidor sem interface gráfica, salvar a senha pode depender do `gnome-keyring`.

**Plano B:** se o FortiClient não conseguir manter o túnel IPsec sem tela, use
`sudo ./scripts/vpn-ipsec-strongswan.sh configurar`. Ele usa o strongSwan, compatível com o mesmo túnel do FortiGate.

**Emergência** (VPN fora do ar e SSH fechado): use o console da VM no provedor ou hipervisor e rode
`sudo ./scripts/vpn-fortinet.sh abrir-ssh`.

## 11e. Vários acampamentos na mesma VM (híbrido)

Cada acampamento pode ser publicado de um jeito diferente na mesma VM. Rode o comando único uma vez para
cada acampamento e escolha:

1. **Cloudflare**: `NOME.movimentocampista.com.br`, pelo túnel. Não usa as portas 80/443.
2. **Direto**: domínio próprio com registro A apontando para o IP público da VM. Todos os acampamentos
   diretos usam **um único proxy HTTPS compartilhado** (`/opt/prefichas-proxy`, nas portas 80/443),
   e o certificado de cada domínio é automático.
3. **Só rede local**: pelo IP, numa porta livre (8180, 8181…), sem HTTPS.

O instalador escolhe sozinho uma **porta local livre** para cada acampamento (3001, 3002…), sem repetir
portas de outras instâncias, mesmo das que estiverem paradas. Cada acampamento tem banco, usuários,
backups e marca próprios.

```bash
sudo /opt/prefichas-NOME/scripts/proxy-compartilhado.sh listar     # domínios diretos publicados
```

**Atenção:** acampamentos instalados antes desta versão no modo direto têm o próprio Caddy nas portas
80/443, e isso impede o proxy compartilhado de subir. Para migrar um deles:
`docker compose stop caddy`, coloque `COMPOSE_PROFILES=` no `.env`, rode `docker compose up -d` e depois
`sudo ./scripts/proxy-compartilhado.sh adicionar DOMINIO PORTA_LOCAL`.

## 11f. Painel central da VM e ordem de implantação

**Ordem de implantação numa VM com vários acampamentos:**

1. **Painel central primeiro**: rode o comando único e escolha **1) Painel central**:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
   ```
   Ele prepara a VM e guarda as configurações que os acampamentos vão usar:
   1. instala Docker e as ferramentas necessárias;
   2. configura a **VPN (FortiClient)** de acesso remoto, se você quiser;
   3. guarda o **domínio base e o token da Cloudflare**;
   4. guarda o **e-mail do Let's Encrypt** (certificados dos acampamentos diretos);
   5. guarda o **e-mail de envio** (Gmail com senha de app) usado em cada acampamento novo;
   6. instala o **painel central** e cria o seu usuário (senha + chave do autenticador, mostradas uma vez).
2. **Acampamentos depois**, pelo painel → aba **Nova instância**. Também dá para criar pelo comando único,
   opção 2.

Com vários acampamentos na mesma VM, o **painel central** mostra todas as instâncias (endereço,
publicação, situação, versão e memória), cria **novas instâncias**, atualiza uma ou todas, faz backup,
**atualiza o próprio painel** e registra tudo numa auditoria. Ele não mostra fichas de nenhum acampamento.

Para instalar o painel numa VM que já tem acampamentos: `sudo ./scripts/instalar-gerenciador.sh`
(variáveis `ESCUTAR`, `REDES_PERMITIDAS` e `ADMIN_EMAIL`).

**Acesso:**
- **Pela VPN:** `http://IP-DA-VM-NA-VPN:9090`.
- **Pelo próprio servidor:** com um túnel SSH, `ssh -L 9090:127.0.0.1:9090 usuario@servidor`, e abra `http://localhost:9090`.

**Segurança:**
- O painel controla o servidor inteiro, então **nunca o publique na internet**. Ele recusa conexões de fora das
  `REDES_PERMITIDAS`, mesmo que a porta esteja aberta, e o instalador não aceita `0.0.0.0/0`.
- O login exige **senha e código de 6 dígitos**. Depois de 5 erros, o acesso fica bloqueado por 15 minutos.
- A sessão expira após 2 horas sem uso.
- O painel roda num container somente leitura, com usuário sem privilégio. Ele **não executa nada**: só grava
  pedidos. O executor (`scripts/gerenciador-executor.sh`, via systemd) valida tudo de novo antes de agir.
- **Nova instância pela Cloudflare** usa o token guardado na preparação do painel (passo 3 da etapa 1).

**Acompanhar ao vivo (como um "verbose"):**
```bash
sudo /opt/prefichas-gerenciador/scripts/acompanhar.sh            # tarefas do painel (nova instância, atualizar…)
sudo /opt/prefichas-gerenciador/scripts/acompanhar.sh tudo       # tarefas + serviço + proxy
sudo /opt/prefichas-gerenciador/scripts/acompanhar.sh instancia prefichas-NOME   # logs de um acampamento
```

**Usuários do painel:**
```bash
G=/var/lib/prefichas-gerenciador; C=$(pwd)/gerenciador
docker run --rm -u 1000:1000 -e DADOS=/dados -v $C:/app:ro -v $G/dados:/dados -w /app node:22-alpine node cli.mjs criar-usuario outro@email
#   comandos: criar-usuario | nova-senha | novo-autenticador | desativar | listar
```

## 11g. Versões e como ficar na versão 1

- **`main`**: versão atual (2.x). É a que o comando único instala e a que o botão **Atualizações** acompanha.
- **`v1`**: versão 1.0 preservada (um acampamento por instalação), só para correções pontuais.
- O histórico de mudanças está em [`CHANGELOG.md`](../CHANGELOG.md).

**Instalar a versão 1:**
```bash
curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/v1/instalar.sh | sudo PREFICHAS_BRANCH=v1 bash
```

**Manter uma instalação existente na versão 1**, para o botão Atualizações não levar à 2.0:
```bash
cd /opt/prefichas-NOME
sudo git fetch origin v1 && sudo git checkout v1
echo 'ATUALIZACAO_BRANCH=v1' | sudo tee -a .env
sudo docker compose up -d
```

## 12. Solução de problemas

**O site não abre / certificado HTTPS não é emitido**
- Confira o DNS: `getent hosts SEU-DOMINIO` deve mostrar o IP do servidor.
- Confira as portas 80 e 443: `sudo ufw status` e o firewall/roteador do provedor.
- Veja o log do Caddy: `sudo docker compose logs caddy` (ou `sudo journalctl -u caddy` no modo vários acampamentos).
- Cloudflare: deixe o registro como "DNS only" até emitir.

**"address already in use" / "failed to bind host port 0.0.0.0:80"**
- Outro programa já usa a porta 80 (ou 443). Veja qual: `sudo ss -ltnp | grep -E ':(80|443) '`.
- O instalador de um comando já detecta isso e usa outra porta. Numa instalação manual, coloque
  no `.env` `PORTA_HTTP=8080` e `PORTA_HTTPS=8443` (e `DOMINIO=:80`, `COOKIE_SEGURO=false`) e rode
  `sudo docker compose up -d`. Para ter HTTPS com domínio, libere as portas 80/443 (pare o outro
  programa) ou use o modo `--multi` atrás do proxy que já existe.

**"502 Bad Gateway"**
- A aplicação não está respondendo: `sudo docker compose ps` e `sudo docker compose logs app`.
- No modo vários acampamentos, confira se a porta no Caddyfile é a mesma do `PORTA_LOCAL` no `.env` da pasta.

**Esqueci a senha do administrador**
```bash
sudo docker compose exec app node server/cli.js redefinir-senha seu-email@exemplo.com
```

**O painel pede a chave de ativação / o formulário mostra "Inscrições em breve"**
- A instalação ainda não foi ativada. Entre como administrador e informe a chave, ou rode
  `sudo docker compose exec app node server/cli.js licenca ativar XXX-0000`.
- Chave recusada: confira as letras e os números com o responsável. Após 5 tentativas erradas,
  aguarde 1 minuto. Cada acampamento (pasta) é ativado separadamente.

**"Muitas tentativas" ao entrar no painel**
- Proteção contra senha chutada: aguarde 1 minuto.
- "Muitas tentativas erradas para esta conta": a conta fica bloqueada por 15 minutos depois de
  8 senhas erradas (de qualquer lugar). Ajuste com `LOGIN_MAX_FALHAS_CONTA` e `LOGIN_BLOQUEIO_MINUTOS`.

**Perdi o celular com o código das duas etapas**
- Outro administrador gera uma **Nova senha** em Usuários (isso desliga as duas etapas), ou pelo
  terminal: `sudo docker compose exec app node server/cli.js redefinir-senha seu-email@exemplo.com`.

**"Muitos envios a partir desta rede" no formulário**
- Muitas pessoas enviando do mesmo Wi-Fi (ex.: evento na paróquia). Aumente `LIMITE_ENVIOS_POR_HORA`
  no `.env` e rode `sudo docker compose up -d`.

**A busca do CEP não preenche o endereço**
- O servidor precisa acessar `viacep.com.br`. Teste: `curl -s https://viacep.com.br/ws/01001000/json/`.
  Enquanto isso, a pessoa pode digitar o endereço normalmente.

**Disco cheio**
- Veja o uso: `df -h` e `sudo du -sh /opt/prefichas-*/backups`.
- Remova backups antigos já copiados para fora e imagens velhas: `sudo docker image prune -f`.

**O assistente diz "Já existe um .env nesta pasta"**
- O acampamento já está instalado nesta pasta. Para reinstalar **do zero** (apagando tudo):
  `sudo docker compose down -v && sudo rm .env` e rode o assistente de novo. Faça backup antes.

---

## 13. Checklist de segurança

- [ ] **Verificação em duas etapas** ativada pelos administradores (painel → Minha conta).
- [ ] `URL_PUBLICA` preenchida no `.env` (o assistente já faz).
- [ ] (Opcional) CAPTCHA no formulário, se houver envio de fichas falsas: crie um site gratuito no
      Cloudflare Turnstile e preencha `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET` no `.env`, depois
      `sudo docker compose up -d`. Limites do formulário: `LIMITE_ENVIOS_POR_HORA` (por IP),
      `LIMITE_ENVIOS_POR_CONTATO_DIA` (mesmo telefone/e-mail, padrão 3) e `LIMITE_ENVIOS_GLOBAL_HORA`
      (todos somados, padrão 300).

- [ ] Firewall ligado, só com SSH, 80 e 443.
- [ ] Sistema atualizado com frequência: `sudo apt update && sudo apt upgrade -y`
      (ou `sudo apt install unattended-upgrades` para atualizações automáticas de segurança).
- [ ] Acesso SSH com chave (sem senha) e sem login direto de root, se possível.
- [ ] Backup diário automático **e** cópia para fora do servidor.
- [ ] Restauração testada pelo menos uma vez.
- [ ] O arquivo `.env` de cada pasta não é compartilhado (contém a senha do banco).
- [ ] Cada pessoa da equipe com o seu próprio usuário; contas de quem saiu desativadas.
- [ ] Coordenadores com o papel **Coordenador de núcleo** (veem só a sua área).

---

## 14. Desinstalar

> ⚠️ Apaga definitivamente os dados do acampamento. Faça e guarde um backup antes.

```bash
cd /opt/prefichas-acampamento-a
sudo ./scripts/backup.sh
sudo docker compose down -v          # remove containers e o banco de dados
cd / && sudo rm -rf /opt/prefichas-acampamento-a
```
