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

- **Um domínio** (ou subdomínio) para o formulário, ex.: `app.acampamentosaopadrepio.com.br`.
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

### 4.1 Baixar o código

Use uma pasta por acampamento — o nome da pasta ajuda a identificar:

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-sao-padre-pio
cd /opt/prefichas-sao-padre-pio
```

### 4.2 (Se for um acampamento novo) criar a marca

O repositório já traz `marcas/sao-padre-pio.json` e `marcas/beata-albertina.json`. Para outro
acampamento, copie e edite (nome, cor, WhatsApp, tribos — veja [`marcas/README.md`](../marcas/README.md)):

```bash
sudo cp marcas/sao-padre-pio.json marcas/meu-acampamento.json
sudo nano marcas/meu-acampamento.json
```

A logo pode ser enviada depois pelo painel. Tudo isso também pode ser ajustado depois em
**Configurações**, então não precisa estar perfeito agora.

### 4.3 Rodar o assistente

```bash
sudo ./scripts/novo-acampamento.sh \
    --marca marcas/sao-padre-pio.json \
    --dominio app.seudominio.com.br \
    --admin seu-email@exemplo.com \
    --nome-admin "Seu Nome"
```

(Se omitir alguma opção, o assistente pergunta no terminal. A chave de ativação também pode ser
informada já no comando, com `--chave XXX-0000`.)

O assistente:

1. cria o arquivo `.env` com uma **senha aleatória para o banco** (só o root consegue ler);
2. baixa as imagens, gera a aplicação e sobe banco + aplicação + Caddy — **a primeira vez leva
   alguns minutos**;
3. espera a aplicação responder e cria as tabelas do banco automaticamente;
4. aplica a marca do acampamento;
5. cria o **primeiro administrador** e mostra uma **senha temporária**;
6. pede a **chave de ativação** (`XXX-0000`). Se você ainda não tiver a chave, aperte ENTER:
   o painel vai pedi-la no primeiro acesso.

```
Usuário criado: seu-email@exemplo.com
Senha temporária: abcd-2345-efgh
(será pedida uma nova senha no primeiro acesso)

Chave de ativação (formato XXX-0000) — ENTER para ativar depois pelo painel: ●●●-●●●●
✓ Sistema ativado.

✓ Acampamento São Padre Pio instalado.
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
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-sao-padre-pio
cd /opt/prefichas-sao-padre-pio
sudo ./scripts/novo-acampamento.sh --multi --porta 3001 \
    --marca marcas/sao-padre-pio.json --dominio app.acampamentosaopadrepio.com.br \
    --admin admin@saopadrepio.com.br --nome-admin "Coordenação São Padre Pio"

sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-beata-albertina
cd /opt/prefichas-beata-albertina
sudo ./scripts/novo-acampamento.sh --multi --porta 3002 \
    --marca marcas/beata-albertina.json --dominio prefichas.beataalbertina.com.br \
    --admin admin@beataalbertina.com.br --nome-admin "Coordenação Beata Albertina"
```

Com `--multi`, o acampamento **não** sobe Caddy próprio; a aplicação fica disponível só dentro do
servidor, na porta indicada (`127.0.0.1:3001`, `127.0.0.1:3002`…).

### 6.3 Configurar o Caddy para todos os domínios

O assistente imprime o bloco de cada domínio. Edite `/etc/caddy/Caddyfile` (modelo em
[`deploy/Caddyfile.multi`](../deploy/Caddyfile.multi)):

```
app.acampamentosaopadrepio.com.br {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3001
}

prefichas.beataalbertina.com.br {
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
    --marca marcas/sao-padre-pio.json --admin seu-email@exemplo.com --nome-admin "Seu Nome"
```

Acesse `http://IP-DO-SERVIDOR/` e `http://IP-DO-SERVIDOR/admin/`. Nesse modo não há HTTPS:
use apenas em rede confiável. (Para HTTPS com certificado interno, veja `deploy/Caddyfile`.)

---

## 8. Backup e restauração

### 8.1 Fazer um backup agora

Dentro da pasta do acampamento:

```bash
cd /opt/prefichas-sao-padre-pio
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
0 2 * * * cd /opt/prefichas-sao-padre-pio && ./scripts/backup.sh >> /var/log/prefichas-backup.log 2>&1
15 2 * * * cd /opt/prefichas-beata-albertina && ./scripts/backup.sh >> /var/log/prefichas-backup.log 2>&1
```

### 8.3 Copiar os backups para fora do servidor

Backup no mesmo disco não protege contra falha do disco, roubo ou perda do servidor. Copie
para outro lugar — por exemplo, para outro computador com `rsync` (também no cron):

```
30 3 * * * rsync -a /opt/prefichas-sao-padre-pio/backups/ usuario@outro-servidor:/backups/prefichas-sao-padre-pio/
```

Ou copie periodicamente para um HD externo / nuvem da organização. Os backups contêm dados
pessoais (LGPD): guarde-os em local protegido.

### 8.4 Restaurar

> ⚠️ Substitui **todos** os dados atuais pelos do backup.

```bash
cd /opt/prefichas-sao-padre-pio
sudo ./scripts/restaurar.sh backups/prefichas-2026-11-01_020000.dump
```

O script pede para digitar `RESTAURAR` como confirmação, para a aplicação, restaura e a liga de novo.

**Teste a restauração** de vez em quando (por exemplo, em outra máquina): backup que nunca foi
restaurado não é garantia.

---

## 9. Atualizar para uma nova versão

```bash
cd /opt/prefichas-sao-padre-pio
sudo ./scripts/backup.sh                 # sempre faça um backup antes
sudo git pull
sudo docker compose up -d --build
sudo docker compose ps                   # confira se está tudo "Up"
```

As mudanças no banco (migrações) são aplicadas automaticamente quando a aplicação sobe — os dados
existentes são preservados. Com vários acampamentos, repita em cada pasta.

---

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
MARCA_INICIAL=marcas/sao-padre-pio.json
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

Atualizar: `cd /opt/pre-fichas && sudo git pull && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev && sudo systemctl restart pre-fichas`.

Logs: `sudo journalctl -u pre-fichas -f`.

---

## 12. Solução de problemas

**O site não abre / certificado HTTPS não é emitido**
- Confira o DNS: `getent hosts SEU-DOMINIO` deve mostrar o IP do servidor.
- Confira as portas 80 e 443: `sudo ufw status` e o firewall/roteador do provedor.
- Veja o log do Caddy: `sudo docker compose logs caddy` (ou `sudo journalctl -u caddy` no modo vários acampamentos).
- Cloudflare: deixe o registro como "DNS only" até emitir.

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
cd /opt/prefichas-sao-padre-pio
sudo ./scripts/backup.sh
sudo docker compose down -v          # remove containers e o banco de dados
cd / && sudo rm -rf /opt/prefichas-sao-padre-pio
```
