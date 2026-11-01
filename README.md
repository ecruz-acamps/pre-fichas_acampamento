# Pré-fichas do Acampamento · Fila de espera

Sistema para receber as pré-fichas de novos campistas e organizar a **fila de espera**
por ordem de chegada (data e hora do envio — quem se inscreveu primeiro tem preferência).

Roda **100% no seu servidor Linux** (on-premises): sem serviços de nuvem, sem CDN, sem
fontes externas. A única chamada externa é a consulta de CEP ao [ViaCEP](https://viacep.com.br),
feita pelo servidor — se ela falhar, a pessoa preenche o endereço à mão.

- **`/`** → formulário público de pré-ficha (funciona no celular)
- **`/admin/`** → painel da fila de espera (login da equipe)

| Camada | Tecnologia |
|---|---|
| Site | React + Vite (gerado como arquivos estáticos) |
| Servidor / API | Node.js 22 + Fastify |
| Banco de dados | PostgreSQL 16 |
| HTTPS | Caddy (certificado automático) — ou o seu Nginx |
| Implantação | Docker Compose — ou systemd, sem Docker |

## Funcionalidades

**Formulário**
- Dados pessoais, informações religiosas, contato, endereço, acampamento e informações adicionais.
- Telefone/WhatsApp obrigatório (é por ele que a equipe faz o contato).
- Menores de 18 anos: pede nome e telefone de um responsável.
- CEP preenche rua, bairro, cidade e UF automaticamente.
- Modalidade validada pela idade/estado civil (Mirim 7–13, FAC 13–18, Juvenil 18–30,
  Sênior casado(a) ou 30+).
- As três declarações obrigatórias do formulário atual.
- Proteção contra robôs (campo invisível) e limite de envios por IP.

**Painel**
- Fila separada por modalidade, com a **posição** de cada pessoa.
- Status: Aguardando → Em contato → Confirmado / Desistiu / Já participou.
  Quem sai da fila libera a posição para o próximo.
- Busca, filtros, link direto para o WhatsApp e aviso de **possível duplicado**.
- Observações internas e **histórico** de quem alterou o quê e quando.
- Exportação para CSV (abre no Excel).
- **Usuários**: administradores criam contas da equipe, redefinem senhas e desativam acessos.
  Toda senha criada por um admin é temporária e precisa ser trocada no primeiro acesso.

**Segurança**
- As regras valem no servidor (o formulário só orienta): campos, tamanhos, opções e idade × modalidade.
- A data/hora da inscrição é definida pelo banco e um *trigger* impede alterá-la — ninguém "fura a fila".
- A equipe só altera `status` e `observações`; não há exclusão de fichas pelo sistema.
- Senhas com scrypt; sessão em cookie `HttpOnly` + `SameSite=Strict`; proteção CSRF;
  limite de tentativas de login; cabeçalhos de segurança (CSP, etc.).
- O banco não fica exposto na rede; só o proxy (portas 80/443) é publicado.

---

## Instalação com Docker (recomendado)

Requisitos: um servidor Linux com [Docker Engine e o plugin Compose](https://docs.docker.com/engine/install/).
Para HTTPS automático, um domínio (ex.: `prefichas.seudominio.com.br`) apontando para o IP
do servidor, com as portas 80 e 443 liberadas.

```bash
# 1. Baixar o código
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/pre-fichas
cd /opt/pre-fichas

# 2. Configurar
sudo cp .env.example .env
sudo nano .env        # DOMINIO, POSTGRES_PASSWORD (use: openssl rand -hex 24), WhatsApp...
sudo chmod 600 .env

# 3. Subir (banco + aplicação + HTTPS)
sudo docker compose up -d --build

# 4. Criar o primeiro administrador (mostra uma senha temporária)
sudo docker compose exec app node server/cli.js criar-admin voce@email.com "Seu Nome"
```

Pronto: acesse `https://SEU-DOMINIO/` (formulário) e `https://SEU-DOMINIO/admin/` (painel).
As tabelas são criadas automaticamente na primeira inicialização.

**Rede interna, sem domínio público?** No `.env` use `DOMINIO=:80` e `COOKIE_SEGURO=false`
(acesso por `http://IP-DO-SERVIDOR`). Para HTTPS com certificado interno, veja `deploy/Caddyfile`.

**Já tem Nginx no servidor?** Remova o serviço `caddy` do `docker-compose.yml`, descomente
`ports: ["127.0.0.1:3000:3000"]` no serviço `app` e use `deploy/nginx.conf`.

### Comandos do dia a dia

```bash
docker compose ps                      # situação dos serviços
docker compose logs -f app             # logs da aplicação
docker compose exec app node server/cli.js listar
docker compose exec app node server/cli.js redefinir-senha pessoa@email.com
docker compose exec app node server/cli.js desativar pessoa@email.com

# Atualizar para uma nova versão do código
git pull && docker compose up -d --build
```

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

# Primeiro administrador
sudo bash -c 'set -a; . /etc/pre-fichas.env; node server/cli.js criar-admin voce@email.com "Seu Nome"'
```

Depois configure o Nginx com `deploy/nginx.conf` e gere o certificado com `certbot --nginx`.

---

## Backup

```bash
./scripts/backup.sh                       # Docker (padrão) — salva em ./backups
MODO=local DATABASE_URL=... ./scripts/backup.sh   # sem Docker
./scripts/restaurar.sh backups/prefichas-AAAA-MM-DD_HHMMSS.dump
```

Agende um backup diário no cron (`sudo crontab -e`):

```
0 2 * * * cd /opt/pre-fichas && ./scripts/backup.sh >> /var/log/pre-fichas-backup.log 2>&1
```

Os backups com mais de 30 dias são apagados (`MANTER_DIAS`). **Copie a pasta `backups/` para
outro lugar** (outro servidor, HD externo) — backup no mesmo disco não protege contra falha do disco.

---

## Desenvolvimento

```bash
npm install
cp .env.example .env     # e defina DATABASE_URL apontando para um PostgreSQL local
npm run dev:api          # API em http://localhost:3000
npm run dev              # site em http://localhost:5173 (repassa /api para a API)
npm run usuarios -- criar-admin voce@email.com "Seu Nome"

# Testes de integração (APAGAM o banco indicado — use um banco só para testes)
DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
```

## Estrutura

```
index.html, admin/index.html   páginas (formulário e painel)
src/form/                      formulário público
src/admin/                     login, fila, detalhes, usuários, exportação CSV
shared/                        regras de validação e opções (usadas no site E no servidor)
server/                        API (Fastify), sessões, senhas, CLI de usuários
server/migrations/             estrutura do banco (aplicada automaticamente)
server/teste/                  testes de integração
deploy/                        Caddyfile, nginx.conf, serviço systemd
scripts/                       backup e restauração
Dockerfile, docker-compose.yml implantação com Docker
```

## Regra da fila

A posição é calculada **por modalidade**, ordenando pela data/hora de inscrição registrada pelo
banco (precisão de microssegundos) e, em empate, pelo número da ficha. Entram na contagem as
fichas com status **Aguardando** ou **Em contato**. A view `fila_espera` traz a mesma posição
para consultas direto no banco.
