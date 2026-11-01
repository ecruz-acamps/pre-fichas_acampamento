-- =====================================================================
-- 002 · Marca configurável, núcleos (coordenadores) e edições do acampamento
-- =====================================================================

-- A view da fila usa "p.*"; é recriada no fim com as colunas novas.
drop view fila_espera;

-- ---------------------------------------------------------------------
-- Normalização de nomes de lugares para comparação:
-- "São José", "SAO JOSE" e "sao  josé" viram "sao jose".
-- (A mesma regra existe em shared/util.js → chaveLocal)
-- ---------------------------------------------------------------------
create function chave_local(texto text) returns text
language sql immutable parallel safe as $$
  select nullif(trim(regexp_replace(lower(translate(coalesce(texto, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

alter table pre_fichas
  add column cidade_chave text generated always as (chave_local(cidade)) stored,
  add column bairro_chave text generated always as (chave_local(bairro)) stored;
create index pre_fichas_local_idx on pre_fichas (uf, cidade_chave, bairro_chave);

-- ---------------------------------------------------------------------
-- Termos aceitos: o texto exato de cada declaração fica gravado na ficha
-- (cada acampamento configura as suas declarações).
-- ---------------------------------------------------------------------
alter table pre_fichas add column termos_aceitos jsonb;
update pre_fichas set termos_aceitos = jsonb_build_array(
  'Autorizo o uso dos meus dados pessoais exclusivamente para fins do acampamento, sem exposição pública.',
  'Entendo que durante o acampamento são realizadas atividades físicas moderadas. Por questões de segurança, não é permitida a participação de gestantes ou pessoas com restrições médicas graves.',
  'Entendo que estou entrando em uma lista de espera e que o preenchimento dessa pré-ficha não significa que estarei automaticamente participando do próximo acampamento. Compreendo que quando chegar a minha vez de participar, alguém irá entrar em contato comigo por telefone.'
);
alter table pre_fichas
  alter column termos_aceitos set not null,
  add constraint pre_fichas_termos_check check (jsonb_typeof(termos_aceitos) = 'array'),
  drop column aceite_lgpd,
  drop column aceite_atividades,
  drop column aceite_lista_espera;

-- ---------------------------------------------------------------------
-- Marca / identidade do acampamento (uma linha só)
-- ---------------------------------------------------------------------
create table marca (
  id             boolean primary key default true check (id),
  dados          jsonb not null default '{}'::jsonb,
  logo           bytea,
  logo_tipo      text check (logo_tipo in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  atualizado_em  timestamptz not null default now()
);
insert into marca (id) values (true);

-- ---------------------------------------------------------------------
-- Papéis: admin (tudo), equipe (toda a fila + acampamentos),
--         coordenador (só a fila das cidades/bairros do seu núcleo)
-- ---------------------------------------------------------------------
alter table usuarios drop constraint usuarios_papel_check;
alter table usuarios add constraint usuarios_papel_check check (papel in ('admin', 'equipe', 'coordenador'));

create table nucleos (
  id         bigint generated always as identity primary key,
  nome       text not null check (char_length(nome) between 1 and 120),
  criado_em  timestamptz not null default now()
);
create unique index nucleos_nome_uk on nucleos (lower(nome));

-- Área de um núcleo: uma cidade inteira (bairro nulo) ou bairros específicos dela
create table nucleo_areas (
  id            bigint generated always as identity primary key,
  nucleo_id     bigint not null references nucleos (id) on delete cascade,
  uf            text not null check (uf ~ '^[A-Z]{2}$'),
  cidade        text not null check (char_length(cidade) between 1 and 100),
  bairro        text check (char_length(bairro) <= 100),
  cidade_chave  text generated always as (chave_local(cidade)) stored,
  bairro_chave  text generated always as (chave_local(bairro)) stored
);
create unique index nucleo_areas_uk on nucleo_areas (nucleo_id, uf, cidade_chave, coalesce(bairro_chave, ''));
create index nucleo_areas_local_idx on nucleo_areas (uf, cidade_chave, bairro_chave);

create table usuario_nucleos (
  usuario_id  bigint not null references usuarios (id) on delete cascade,
  nucleo_id   bigint not null references nucleos (id) on delete cascade,
  primary key (usuario_id, nucleo_id)
);

-- Quais núcleos cobrem cada ficha
create view ficha_nucleos as
select distinct p.id as pre_ficha_id, a.nucleo_id
from pre_fichas p
join nucleo_areas a
  on a.uf = p.uf
 and a.cidade_chave = p.cidade_chave
 and (a.bairro_chave is null or a.bairro_chave = p.bairro_chave);

-- ---------------------------------------------------------------------
-- Edições do acampamento e participações (com a cor da tribo)
-- ---------------------------------------------------------------------
create table acampamentos (
  id           bigint generated always as identity primary key,
  numero       integer not null check (numero > 0),
  modalidade   text not null check (modalidade in ('mirim','fac','juvenil','senior')),
  data_inicio  date,
  data_fim     date check (data_fim is null or data_inicio is null or data_fim >= data_inicio),
  observacao   text check (char_length(observacao) <= 1000),
  criado_em    timestamptz not null default now(),
  criado_por   bigint references usuarios (id) on delete set null
);
create unique index acampamentos_uk on acampamentos (modalidade, numero);

create table participacoes (
  acampamento_id  bigint not null references acampamentos (id) on delete restrict,
  pre_ficha_id    bigint not null references pre_fichas (id) on delete cascade,
  tribo           text check (char_length(tribo) <= 40),
  registrado_em   timestamptz not null default now(),
  registrado_por  bigint references usuarios (id) on delete set null,
  primary key (acampamento_id, pre_ficha_id)
);
create index participacoes_ficha_idx on participacoes (pre_ficha_id);

-- Visão da fila (recriada): posição por modalidade, por ordem de chegada
create view fila_espera as
select
  row_number() over (partition by p.modalidade order by p.created_at, p.id) as posicao,
  p.*
from pre_fichas p
where p.status in ('aguardando', 'em_contato');
