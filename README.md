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

**Feito para vários acampamentos**
- Cada acampamento tem **sua própria instalação** (banco de dados separado): os dados do
  São Padre Pio e da Beata Albertina nunca se misturam. Podem ficar em servidores diferentes
  ou no mesmo servidor, cada um com seu domínio.
- **Marca configurável** sem mexer no código: nome, logo, cor, contatos, textos do formulário,
  declarações obrigatórias e tribos — pelo painel (**Configurações**) ou por arquivo
  (`marcas/*.json`). Vale na hora, sem reiniciar. Veja [`marcas/README.md`](marcas/README.md).
- Assistente de instalação: `./scripts/novo-acampamento.sh` coloca um acampamento no ar.

**Formulário (público)**
- Dados pessoais, informações religiosas, contato, endereço, acampamento e informações adicionais.
- Telefone/WhatsApp obrigatório; responsável para menores de 18 anos.
- CEP preenche o endereço; modalidade validada pela idade/estado civil.
- Declarações configuráveis por acampamento — o texto exato aceito fica gravado na ficha.
- Proteção contra robôs e limite de envios por IP.

**Fila de espera**
- Fila por modalidade, com a **posição** de cada pessoa (ordem de inscrição).
- Filtros por **núcleo, cidade e bairro**, busca, status, aviso de possível duplicado, WhatsApp direto.
- **Resumo por cidade e bairro**: quantas pessoas há em cada lugar, por modalidade.
- Observações internas e histórico de quem alterou o quê. Exportação CSV.

**Coordenadores de núcleo**
- Um **núcleo** reúne cidades inteiras e/ou bairros específicos (ex.: "São José inteira +
  Florianópolis/Centro"). Maiúsculas e acentos não importam ("SAO JOSE" = "São José").
- O **coordenador de núcleo** só vê as pré-fichas da sua área — garantido pelo servidor —
  e usa o resumo para saber quem chamar em cada acampamento.
- O painel mostra quais cidades/bairros com pré-fichas ainda não têm núcleo.

**Acampamentos realizados**
- Cadastre cada edição (**número + modalidade**, ex.: 45º Juvenil, com datas).
- Marque quem **fez o acampamento** e a **cor da tribo** (azul, preto, amarelo, verde, roxo,
  laranja, marrom — lista configurável). A pessoa sai da fila automaticamente.
- Contagem por tribo, exportação da lista e histórico de acampamentos em cada ficha.

**Papéis**

| Papel | Pode |
|---|---|
| Administrador | tudo: usuários, núcleos, configurações da marca, acampamentos, fila |
| Equipe | ver toda a fila, atualizar status, registrar acampamentos e tribos |
| Coordenador de núcleo | ver e atualizar só a fila das cidades/bairros dos seus núcleos |

**Segurança**
- As regras valem no servidor (o navegador só orienta), inclusive o que cada papel enxerga.
- A data/hora da inscrição é definida pelo banco e um *trigger* impede alterá-la.
- Senhas com scrypt, senha temporária com troca obrigatória, cookie `HttpOnly` + `SameSite=Strict`,
  proteção CSRF, limite de tentativas de login, CSP. Logo enviada é conferida (SVG com script é recusado).
- O banco não fica exposto na rede.

---

## Instalação com Docker (recomendado)

Requisitos: um servidor Linux com [Docker Engine e o plugin Compose](https://docs.docker.com/engine/install/).
Para HTTPS automático, um domínio apontando para o IP do servidor, com as portas 80 e 443 liberadas.

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-sao-padre-pio
cd /opt/prefichas-sao-padre-pio
sudo ./scripts/novo-acampamento.sh \
    --marca marcas/sao-padre-pio.json \
    --dominio app.acampamentosaopadrepio.com.br \
    --admin voce@email.com --nome-admin "Seu Nome"
```

O assistente gera o `.env` (com senha aleatória para o banco), sobe banco + aplicação + HTTPS,
aplica a marca e cria o primeiro administrador (mostra a senha temporária).
Acesse `https://SEU-DOMINIO/` (formulário) e `https://SEU-DOMINIO/admin/` (painel).

Prefere configurar à mão? `cp .env.example .env`, edite e rode `docker compose up -d --build`.

**Rede interna, sem domínio público?** Use `--dominio :80` (acesso por `http://IP-DO-SERVIDOR`).

**Já tem Nginx no servidor?** Rode o assistente com `--multi` (sem Caddy próprio) e use
`deploy/nginx.conf` apontando para a porta local (`--porta`, padrão 3000).

### Vários acampamentos no mesmo servidor

Cada acampamento fica em uma pasta própria, com porta local diferente, e um único Caddy
na frente atende todos os domínios:

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-sao-padre-pio
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-beata-albertina

cd /opt/prefichas-sao-padre-pio && sudo ./scripts/novo-acampamento.sh --multi --porta 3001 \
    --marca marcas/sao-padre-pio.json --dominio app.acampamentosaopadrepio.com.br \
    --admin admin@saopadrepio.com.br --nome-admin "Coordenação SPP"

cd /opt/prefichas-beata-albertina && sudo ./scripts/novo-acampamento.sh --multi --porta 3002 \
    --marca marcas/beata-albertina.json --dominio prefichas.beataalbertina.com.br \
    --admin admin@beataalbertina.com.br --nome-admin "Coordenação Beata"
```

Depois instale o Caddy no servidor e use [`deploy/Caddyfile.multi`](deploy/Caddyfile.multi)
(o assistente imprime o bloco de cada domínio). Cada instalação tem seu banco, seus usuários,
seus backups e sua marca.

### Novo acampamento? Crie a marca dele

```bash
cp marcas/sao-padre-pio.json marcas/meu-acampamento.json   # edite nome, cor, contatos, tribos...
cp ~/logo.png marcas/meu-acampamento.png                     # e indique "logo": "meu-acampamento.png" no .json
```

Tudo pode ser ajustado depois no painel → **Configurações** (inclusive importar/exportar o `.json`).

### Comandos do dia a dia

```bash
docker compose ps                      # situação dos serviços
docker compose logs -f app             # logs da aplicação
docker compose exec app node server/cli.js listar
docker compose exec app node server/cli.js redefinir-senha pessoa@email.com
docker compose exec app node server/cli.js desativar pessoa@email.com
docker compose exec app node server/cli.js criar-coordenador pessoa@email.com "Nome"
docker compose exec app node server/cli.js marca aplicar marcas/beata-albertina.json
docker compose exec app node server/cli.js marca exportar        # mostra a marca atual (JSON)

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

echo 'MARCA_INICIAL=marcas/sao-padre-pio.json' | sudo tee -a /etc/pre-fichas.env

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
index.html, admin/index.html   páginas (formulário e painel; o servidor aplica a marca)
src/form/                      formulário público
src/admin/                     fila, resumo, acampamentos, núcleos, usuários, configurações
shared/                        regras de validação, opções e marca (site E servidor)
server/                        API (Fastify), sessões, senhas, marca, CLI
marcas/                        identidade de cada acampamento (.json + logo)
server/migrations/             estrutura do banco (aplicada automaticamente)
server/teste/                  testes de integração
deploy/                        Caddyfile, Caddyfile.multi, nginx.conf, serviço systemd
scripts/                       novo-acampamento, backup e restauração
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

### Trilha de auditoria

Tudo fica registrado no histórico de cada ficha e na tela **Auditoria** (filtros por tipo de evento,
período e texto; exportação CSV): inscrição, mudanças de status, observações, recusas,
idas para o fim da fila (com data anterior → nova, quem fez e o motivo) e registros de acampamento.

- O próprio **banco de dados** registra toda mudança da data na fila — mesmo que alguém altere
  direto no banco, aparece como "alteração direta no banco".
- Os registros **não podem ser editados** (o banco recusa).
- O coordenador de núcleo vê a auditoria apenas da sua área.
