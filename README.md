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

> 🗺️ **Próximos passos:** veja o [`ROADMAP.md`](ROADMAP.md) — a versão 2.0 trará o app Android e iOS para os neocampistas.
>
> 📘 **Instalação passo a passo no Linux:** [`docs/INSTALACAO.md`](docs/INSTALACAO.md)
> (preparar o servidor, domínio, HTTPS, vários acampamentos, backup, atualização e solução de problemas).

## Telas

> Capturas do sistema funcionando, com **dados fictícios** de demonstração.

<table>
<tr>
<td width="32%" valign="top"><strong>Formulário no celular</strong><br /><img src="docs/imagens/07-formulario-celular-preenchido.webp" alt="Formulário de pré-ficha no celular" /></td>
<td valign="top"><strong>Fila de espera (administrador)</strong><br /><img src="docs/imagens/09-painel-fila-de-espera.webp" alt="Fila de espera com selos de preferência, recusa e fim da fila" />
<br /><br /><strong>Ficha com preferência do cônjuge</strong> · <strong>Atualização pelo painel</strong><br />
<img src="docs/imagens/11-painel-ficha-completa-conjuge-preferencia.webp" alt="Ficha completa com cônjuge e preferência" width="260" /> <img src="docs/imagens/30-painel-janela-atualizacao.webp" alt="Janela de atualização" width="440" /></td>
</tr>
</table>

<details>
<summary><strong>Formulário público</strong></summary>

<p><em>Formulário no computador</em><br />
<img src="docs/imagens/05-formulario-computador.webp" alt="Formulário no computador" width="700" /></p>

<p><em>Avisos de campos obrigatórios</em><br />
<img src="docs/imagens/06-formulario-validacao-campos.webp" alt="Avisos de campos obrigatórios" width="700" /></p>

<p><em>Mensagem após o envio</em><br />
<img src="docs/imagens/08-formulario-celular-enviado.webp" alt="Mensagem após o envio" width="300" /></p>

<p><em>"Inscrições em breve" — antes da ativação do sistema</em><br />
<img src="docs/imagens/01-formulario-inscricoes-em-breve.webp" alt=""Inscrições em breve" — antes da ativação do sistema" width="300" /></p>

</details>

<details>
<summary><strong>Primeiro acesso e ativação</strong></summary>

<p><em>Login da equipe</em><br />
<img src="docs/imagens/02-painel-login.webp" alt="Login da equipe" width="700" /></p>

<p><em>Troca obrigatória da senha temporária</em><br />
<img src="docs/imagens/03-painel-primeiro-acesso-troca-senha.webp" alt="Troca obrigatória da senha temporária" width="700" /></p>

<p><em>Ativação do sistema com a chave XXX-0000</em><br />
<img src="docs/imagens/04-painel-ativacao-chave.webp" alt="Ativação do sistema com a chave XXX-0000" width="700" /></p>

</details>

<details>
<summary><strong>Fila de espera e ficha</strong></summary>

<p><em>Fila com selos: ★ preferência, recusa, fim da fila, possível duplicado</em><br />
<img src="docs/imagens/09-painel-fila-de-espera.webp" alt="Fila com selos: ★ preferência, recusa, fim da fila, possível duplicado" /></p>

<p><em>Filtro "Preferência"</em><br />
<img src="docs/imagens/10-painel-fila-filtro-preferencia.webp" alt="Filtro "Preferência"" /></p>

<p><em>Ficha: cônjuge vinculado e preferência para o 25º e 26º</em><br />
<img src="docs/imagens/11-painel-ficha-completa-conjuge-preferencia.webp" alt="Ficha: cônjuge vinculado e preferência para o 25º e 26º" width="400" /></p>

<p><em>Ficha: 2 recusas → fim da fila, com a trilha de auditoria</em><br />
<img src="docs/imagens/12-painel-ficha-recusas-fim-da-fila-historico.webp" alt="Ficha: 2 recusas → fim da fila, com a trilha de auditoria" width="400" /></p>

<p><em>Registrar recusa (comentário obrigatório)</em><br />
<img src="docs/imagens/13-painel-registrar-recusa.webp" alt="Registrar recusa (comentário obrigatório)" /></p>

</details>

<details>
<summary><strong>Nomes, resumo, acampamentos e auditoria</strong></summary>

<p><em>Nomes (A–Z): pré-fichas e campistas</em><br />
<img src="docs/imagens/14-painel-nomes-a-z.webp" alt="Nomes (A–Z): pré-fichas e campistas" /></p>

<p><em>Resumo por cidade e bairro, por modalidade</em><br />
<img src="docs/imagens/15-painel-resumo-por-cidade-e-bairro.webp" alt="Resumo por cidade e bairro, por modalidade" /></p>

<p><em>Acampamentos realizados</em><br />
<img src="docs/imagens/16-painel-acampamentos.webp" alt="Acampamentos realizados" /></p>

<p><em>Edição do acampamento: quem fez e a cor da tribo</em><br />
<img src="docs/imagens/17-painel-acampamento-participantes-tribos.webp" alt="Edição do acampamento: quem fez e a cor da tribo" /></p>

<p><em>Auditoria</em><br />
<img src="docs/imagens/18-painel-auditoria.webp" alt="Auditoria" /></p>

</details>

<details>
<summary><strong>Núcleos, usuários e configurações</strong></summary>

<p><em>Núcleos e suas áreas</em><br />
<img src="docs/imagens/19-painel-nucleos.webp" alt="Núcleos e suas áreas" /></p>

<p><em>Dividir cidade por bairros (ex.: Palhoça em 4 núcleos)</em><br />
<img src="docs/imagens/20-painel-dividir-palhoca-por-bairros.webp" alt="Dividir cidade por bairros (ex.: Palhoça em 4 núcleos)" /></p>

<p><em>Usuários e papéis (senha temporária gerada)</em><br />
<img src="docs/imagens/21-painel-usuarios.webp" alt="Usuários e papéis (senha temporária gerada)" /></p>

<p><em>Configurações: marca, textos, declarações, regras da fila e tribos</em><br />
<img src="docs/imagens/22-painel-configuracoes-marca.webp" alt="Configurações: marca, textos, declarações, regras da fila e tribos" /></p>

</details>

<details>
<summary><strong>Coordenador de núcleo</strong></summary>

<p><em>Fila apenas do núcleo</em><br />
<img src="docs/imagens/23-coordenador-fila-do-nucleo.webp" alt="Fila apenas do núcleo" /></p>

<p><em>Nomes: pré-fichas do núcleo e todos os campistas</em><br />
<img src="docs/imagens/24-coordenador-nomes-prefichas-e-campistas.webp" alt="Nomes: pré-fichas do núcleo e todos os campistas" /></p>

<p><em>Campista de outro núcleo em modo consulta</em><br />
<img src="docs/imagens/25-coordenador-campista-outro-nucleo-consulta.webp" alt="Campista de outro núcleo em modo consulta" width="400" /></p>

</details>

<details>
<summary><strong>Atualização pelo painel</strong></summary>

<p><em>Botão "Atualização disponível" (aparece só quando há versão nova)</em><br />
<img src="docs/imagens/29-painel-botao-atualizacao-disponivel.webp" alt="Botão "Atualização disponível" (aparece só quando há versão nova)" /></p>

<p><em>O que há de novo e "Atualizar agora"</em><br />
<img src="docs/imagens/30-painel-janela-atualizacao.webp" alt="O que há de novo e "Atualizar agora"" /></p>

<p><em>Andamento da atualização</em><br />
<img src="docs/imagens/31-painel-atualizando.webp" alt="Andamento da atualização" /></p>

</details>

<details>
<summary><strong>Celular</strong></summary>

<p><em>Painel no celular</em><br />
<img src="docs/imagens/26-celular-painel-fila.webp" alt="Painel no celular" width="300" /></p>


</details>


## Funcionalidades

**Feito para vários acampamentos**
- Cada acampamento tem **sua própria instalação** (banco de dados separado): os dados de
  um acampamento nunca se misturam com os de outro. Podem ficar em servidores diferentes
  ou no mesmo servidor, cada um com seu domínio.
- **Marca configurável** sem mexer no código: nome, logo, cor, contatos, textos do formulário,
  declarações obrigatórias e tribos — pelo painel (**Configurações**) ou por arquivo
  (`marcas/*.json`). Vale na hora, sem reiniciar. Veja [`marcas/README.md`](marcas/README.md).
- **Instalação em um único comando** (`instalar.sh`): instala o Docker, baixa o sistema, pergunta o nome do acampamento e coloca no ar.
- **Atualização pelo painel**: o sistema compara a versão instalada com o GitHub; quando há versão
  nova, o administrador vê o botão **"Atualização disponível"**, confere o que mudou e clica em
  **Atualizar agora** — backup, código novo, reconstrução e reinício, acompanhados na tela. (Também
  pelo terminal: `sudo ./scripts/atualizar.sh`.)
- **Ativação por chave**: depois de instalado e configurado, o sistema pede uma chave de ativação
  (`XXX-0000`), fornecida pelo responsável pela implantação. Até ativar, o painel fica bloqueado
  e o formulário não recebe inscrições.

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
- **Dividir cidade por bairros**: para cidades com vários núcleos (ex.: Palhoça → Centro, Ponte do
  Imaruim, Aririu e São Sebastião), uma tela lista os bairros da cidade (com quantas pré-fichas há
  em cada um) e você escolhe o núcleo de cada bairro.
- **Nomes (A–Z)**: lista alfabética com as pré-fichas do núcleo do coordenador e **todos os
  campistas** (quem já fez o acampamento) de todos os núcleos, com a ficha completa — campistas não
  são restritos ao núcleo. Campistas de outros núcleos abrem em modo consulta (alterações ficam com
  o núcleo deles, a equipe ou o administrador).

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
| Coordenador de núcleo | ver e atualizar as pré-fichas das cidades/bairros dos seus núcleos; consultar todos os campistas |

**Segurança**
- As regras valem no servidor (o navegador só orienta), inclusive o que cada papel enxerga.
- A data/hora da inscrição é definida pelo banco e um *trigger* impede alterá-la.
- Senhas com scrypt, senha temporária com troca obrigatória, cookie `HttpOnly` + `SameSite=Strict`,
  proteção CSRF, CSP.
- Login: limite por IP **e por conta**, e **verificação em duas etapas** opcional (aplicativo autenticador).
- Formulário: limite por IP, por telefone/e-mail e geral; inscrição repetida da mesma pessoa é descartada;
  CAPTCHA opcional (Cloudflare Turnstile). Logo enviada é conferida (SVG com script é recusado).
- O banco não fica exposto na rede.

---

## Instalação (um único comando)

Num servidor Linux (Ubuntu ou Debian), rode:

```bash
curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
```

O instalador faz tudo sozinho: instala o que faltar (git, Docker), baixa o sistema em
`/opt/prefichas-NOME`, **pergunta o nome do acampamento**, o domínio (opcional) e os dados do
administrador, sobe banco + aplicação, cria o administrador (mostra a senha temporária) e pede a
**chave de ativação** (ENTER = ativar depois pelo painel). No fim mostra os endereços do
formulário e do painel.

- **Com domínio** (ex.: `prefichas.seuacampamento.com.br` apontando para o servidor): HTTPS automático.
- **Sem domínio**: deixe em branco e acesse por `http://IP-DO-SERVIDOR`.
- **Porta 80/443 já ocupada** por outro programa: o instalador avisa quem está usando e instala
  numa porta livre (padrão `http://IP:8180`; escolha outra na pergunta "Porta do site").

Guia completo e instalação manual: [`docs/INSTALACAO.md`](docs/INSTALACAO.md).

**Já tem Nginx no servidor?** Rode o assistente com `--multi` (sem Caddy próprio) e use
`deploy/nginx.conf` apontando para a porta local (`--porta`, padrão 3000).

### Vários acampamentos no mesmo servidor

Cada acampamento fica em uma pasta própria, com porta local diferente, e um único Caddy
na frente atende todos os domínios:

```bash
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-acampamento-a
sudo git clone https://github.com/ecruz-acamps/pre-fichas_acampamento.git /opt/prefichas-acampamento-b

cd /opt/prefichas-acampamento-a && sudo ./scripts/novo-acampamento.sh --multi --porta 3001 \
    --nome "Acampamento A" --dominio prefichas.acampamento-a.com.br \
    --admin admin@acampamento-a.com.br --nome-admin "Coordenação A"

cd /opt/prefichas-acampamento-b && sudo ./scripts/novo-acampamento.sh --multi --porta 3002 \
    --nome "Acampamento B" --dominio prefichas.acampamento-b.com.br \
    --admin admin@acampamento-b.com.br --nome-admin "Coordenação B"
```

Depois instale o Caddy no servidor e use [`deploy/Caddyfile.multi`](deploy/Caddyfile.multi)
(o assistente imprime o bloco de cada domínio). Cada instalação tem seu banco, seus usuários,
seus backups e sua marca.

### Logo, cores e tribos

O nome é escolhido na instalação. Logo, cor, contatos e tribos ficam no painel → **Configurações**.
Se preferir arquivo:

```bash
cp marcas/modelo.json marcas/meu-acampamento.json   # edite nome, cor, contatos, tribos...
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
docker compose exec app node server/cli.js marca aplicar marcas/meu-acampamento.json
docker compose exec app node server/cli.js marca exportar        # mostra a marca atual (JSON)

# Atualizar: pelo botão "Atualização disponível" no painel, ou pelo terminal
sudo ./scripts/atualizar.sh
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

echo 'NOME_ACAMPAMENTO=Nome do Acampamento' | sudo tee -a /etc/pre-fichas.env

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
scripts/                       novo-acampamento, atualizar, atualizador do painel, backup e restauração
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

### Preferência do cônjuge

Quem faz o acampamento **N** dá ao cônjuge **preferência** para ser chamado nas próximas edições
da mesma modalidade — por padrão **2** (fez o 24º Sênior → preferência no 25º e 26º). Depois disso
ela expira sozinha. O número de edições fica em **Configurações → Regras da fila** (0 = desligado).

1. **No formulário**, quem é casado(a)/união estável informa (opcional) nome e telefone do cônjuge,
   se ele já fez o acampamento e qual.
2. **Na ficha**, a equipe **vincula os cônjuges** — o sistema sugere a ficha pelo telefone/nome declarado.
3. Com o vínculo, ao registrar que um deles **fez o acampamento**, o outro ganha a preferência
   **automaticamente**. Se o vínculo for feito depois, a preferência também é criada (se ainda estiver no prazo).
4. Se o cônjuge fez o acampamento antes do sistema (sem ficha), use **Registrar preferência de cônjuge**
   informando o nome e o número da edição.

A situação de cada preferência é calculada a partir das edições cadastradas em **Acampamentos**:
**ativa**, **usada** (a pessoa fez uma das edições cobertas), **expirada** (as edições cobertas já
foram cadastradas) ou **revogada** (cancelada pela equipe, com motivo). Por isso, cadastre cada edição
realizada.

Na fila, o filtro **Preferência** mostra quem tem preferência ativa (selo ★) e quem declarou que o
cônjuge fez o acampamento mas ainda não foi validado. Na lista de chamada de cada edição, quem tem
preferência para aquela edição aparece primeiro. Vincular/desvincular e criar/revogar preferências
é feito por administradores e equipe, e tudo fica na auditoria.

### Trilha de auditoria

Tudo fica registrado no histórico de cada ficha e na tela **Auditoria** (filtros por tipo de evento,
período e texto; exportação CSV): inscrição, mudanças de status, observações, recusas,
idas para o fim da fila (com data anterior → nova, quem fez e o motivo), registros de acampamento,
vínculos de cônjuge e preferências criadas/revogadas.

- O próprio **banco de dados** registra toda mudança da data na fila — mesmo que alguém altere
  direto no banco, aparece como "alteração direta no banco".
- Os registros **não podem ser editados** (o banco recusa).
- O coordenador de núcleo vê a auditoria apenas da sua área.
