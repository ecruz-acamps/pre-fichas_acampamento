-- =====================================================================
-- Pré-fichas do acampamento + fila de espera (PostgreSQL 14+)
-- Aplicado automaticamente pelo servidor ao iniciar (server/db.js).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Usuários da equipe (quem acessa o painel)
-- ---------------------------------------------------------------------
create table usuarios (
  id            bigint generated always as identity primary key,
  email         text not null check (email = lower(email) and char_length(email) <= 200),
  nome          text not null check (char_length(nome) between 1 and 120),
  senha_hash    text not null,
  papel         text not null default 'equipe' check (papel in ('admin', 'equipe')),
  ativo         boolean not null default true,
  -- true quando a senha foi gerada por um admin: obriga a trocar no próximo login
  trocar_senha  boolean not null default true,
  criado_em     timestamptz not null default now(),
  ultimo_login  timestamptz
);
create unique index usuarios_email_uk on usuarios (email);

-- Sessões de login (o cookie guarda um token aleatório; aqui fica só o hash dele)
create table sessoes (
  id           text primary key,
  usuario_id   bigint not null references usuarios (id) on delete cascade,
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null
);
create index sessoes_usuario_idx on sessoes (usuario_id);
create index sessoes_expira_idx on sessoes (expira_em);

-- ---------------------------------------------------------------------
-- Pré-fichas
-- ---------------------------------------------------------------------
create table pre_fichas (
  id                    bigint generated always as identity primary key,
  -- Data/hora da inscrição: definida SEMPRE pelo banco. É o critério da fila.
  created_at            timestamptz not null default clock_timestamp(),

  -- Dados pessoais
  nome_completo         text not null check (char_length(nome_completo) between 3 and 150),
  data_nascimento       date not null check (data_nascimento >= '1900-01-01'),
  estado_civil          text not null check (estado_civil in ('solteiro','casado','uniao_estavel','divorciado','viuvo')),
  sexo                  text not null check (sexo in ('masculino','feminino')),
  profissao             text check (char_length(profissao) <= 120),
  telefone              text not null check (char_length(telefone) between 10 and 20),
  responsavel_nome      text check (char_length(responsavel_nome) <= 150),
  responsavel_telefone  text check (char_length(responsavel_telefone) <= 20),

  -- Informações religiosas
  religiao              text not null check (char_length(religiao) <= 80),
  batizado              boolean not null,
  primeira_eucaristia   boolean not null,
  crismado              boolean not null,
  paroquia              text check (char_length(paroquia) <= 150),
  participa_pastoral    boolean not null,
  pastoral_qual         text check (char_length(pastoral_qual) <= 150),

  -- Contato
  email                 text not null check (char_length(email) <= 200),
  instagram             text check (char_length(instagram) <= 100),
  facebook              text check (char_length(facebook) <= 150),

  -- Endereço
  cep                   text not null check (cep ~ '^\d{8}$'),
  logradouro            text check (char_length(logradouro) <= 200),
  numero                text check (char_length(numero) <= 20),
  complemento           text check (char_length(complemento) <= 100),
  bairro                text check (char_length(bairro) <= 100),
  cidade                text not null check (char_length(cidade) <= 100),
  uf                    text not null check (uf ~ '^[A-Z]{2}$'),

  -- Acampamento
  como_conheceu         text not null check (char_length(como_conheceu) <= 200),
  motivo                text not null check (char_length(motivo) between 1 and 2000),
  modalidade            text not null check (modalidade in ('mirim','fac','juvenil','senior')),

  -- Informações adicionais
  possui_vicio          boolean not null,
  vicio_qual            text check (char_length(vicio_qual) <= 200),
  restricoes_medicas    text check (char_length(restricoes_medicas) <= 1000),
  retiros_anteriores    text check (char_length(retiros_anteriores) <= 1000),

  -- Termos aceitos (obrigatórios)
  aceite_lgpd           boolean not null check (aceite_lgpd),
  aceite_atividades     boolean not null check (aceite_atividades),
  aceite_lista_espera   boolean not null check (aceite_lista_espera),

  -- Controle interno da equipe
  status                text not null default 'aguardando'
                        check (status in ('aguardando','em_contato','confirmado','desistiu','participou')),
  observacoes_internas  text check (char_length(observacoes_internas) <= 4000),
  atualizado_em         timestamptz,
  atualizado_por        bigint references usuarios (id) on delete set null,

  -- Metadados do envio (auditoria)
  ip_origem             inet
);

create index pre_fichas_fila_idx on pre_fichas (modalidade, status, created_at, id);

-- A data/hora de inscrição nunca pode ser alterada, nem por engano direto no banco.
create function proteger_ordem_fila() returns trigger language plpgsql as $$
begin
  if new.created_at is distinct from old.created_at or new.id is distinct from old.id then
    raise exception 'A data/hora de inscrição (ordem da fila) não pode ser alterada.';
  end if;
  return new;
end;
$$;

create trigger pre_fichas_proteger_ordem
  before update on pre_fichas
  for each row execute function proteger_ordem_fila();

-- Histórico de alterações feitas pela equipe
create table pre_fichas_historico (
  id               bigint generated always as identity primary key,
  pre_ficha_id     bigint not null references pre_fichas (id) on delete cascade,
  usuario_id       bigint references usuarios (id) on delete set null,
  criado_em        timestamptz not null default now(),
  status_anterior  text,
  status_novo      text,
  observacao       text
);
create index pre_fichas_historico_ficha_idx on pre_fichas_historico (pre_ficha_id, criado_em);

-- Visão da fila: posição por modalidade, por ordem de chegada
create view fila_espera as
select
  row_number() over (partition by p.modalidade order by p.created_at, p.id) as posicao,
  p.*
from pre_fichas p
where p.status in ('aguardando', 'em_contato');
