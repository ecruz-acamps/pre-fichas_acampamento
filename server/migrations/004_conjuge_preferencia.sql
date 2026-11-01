-- =====================================================================
-- 004 · Cônjuge e preferência
--
-- Regra: quando uma pessoa faz o acampamento N (ex.: 24º Sênior), o cônjuge
-- tem PREFERÊNCIA para ser chamado nas próximas edições da mesma modalidade
-- (padrão: 2 → 25º e 26º). Depois disso a preferência expira sozinha.
-- =====================================================================

-- O que a pessoa DECLARA no formulário (a equipe valida)
alter table pre_fichas
  add column conjuge_nome text check (char_length(conjuge_nome) <= 150),
  add column conjuge_telefone text check (char_length(conjuge_telefone) <= 20),
  add column conjuge_fez_acampamento boolean,
  add column conjuge_acampamento_numero integer check (conjuge_acampamento_numero between 1 and 100000),
  -- Vínculo confirmado pela equipe entre as fichas dos cônjuges (mão dupla)
  add column conjuge_id bigint references pre_fichas (id) on delete set null
    check (conjuge_id is distinct from id);

create table preferencias (
  id                  bigint generated always as identity primary key,
  pre_ficha_id        bigint not null references pre_fichas (id) on delete cascade,  -- quem tem a preferência
  motivo              text not null default 'conjuge' check (motivo in ('conjuge')),
  origem              text not null check (origem in ('automatica', 'manual')),
  modalidade          text not null check (modalidade in ('mirim','fac','juvenil','senior')),
  acampamento_numero  integer not null check (acampamento_numero > 0),   -- edição que o cônjuge fez
  edicoes             integer not null check (edicoes between 1 and 10), -- quantas edições seguintes valem
  acampamento_id      bigint references acampamentos (id) on delete set null,
  conjuge_ficha_id    bigint references pre_fichas (id) on delete set null,
  conjuge_nome        text check (char_length(conjuge_nome) <= 150),
  observacao          text check (char_length(observacao) <= 1000),
  criado_em           timestamptz not null default now(),
  criado_por          bigint references usuarios (id) on delete set null,
  revogada_em         timestamptz,
  revogada_por        bigint references usuarios (id) on delete set null,
  motivo_revogacao    text check (char_length(motivo_revogacao) <= 1000),
  check (conjuge_ficha_id is not null or conjuge_nome is not null)
);
create index preferencias_ficha_idx on preferencias (pre_ficha_id);
create unique index preferencias_ativa_uk on preferencias (pre_ficha_id, modalidade, acampamento_numero)
  where revogada_em is null;

-- Situação calculada de cada preferência:
--   ativa    → ainda vale (as edições seguintes não aconteceram todas)
--   usada    → a pessoa fez uma das edições cobertas
--   expirada → já foram cadastradas as edições cobertas (ex.: o 26º)
--   revogada → a equipe cancelou
create view preferencias_situacao as
select pr.*,
  pr.acampamento_numero + 1 as valida_de,
  pr.acampamento_numero + pr.edicoes as valida_ate,
  case
    when pr.revogada_em is not null then 'revogada'
    when exists (
      select 1 from participacoes pa join acampamentos a on a.id = pa.acampamento_id
       where pa.pre_ficha_id = pr.pre_ficha_id and a.modalidade = pr.modalidade
         and a.numero between pr.acampamento_numero + 1 and pr.acampamento_numero + pr.edicoes) then 'usada'
    when coalesce((select max(a.numero) from acampamentos a where a.modalidade = pr.modalidade), 0)
         >= pr.acampamento_numero + pr.edicoes then 'expirada'
    else 'ativa'
  end as situacao
from preferencias pr;

-- Novos tipos de evento na trilha de auditoria
alter table pre_fichas_historico drop constraint pre_fichas_historico_tipo_check;
alter table pre_fichas_historico add constraint pre_fichas_historico_tipo_check
  check (tipo in ('inscricao', 'status', 'observacao', 'recusa', 'fim_da_fila', 'acampamento', 'preferencia', 'conjuge'));

-- A view da fila usa "p.*": recriada para incluir as colunas novas
drop view fila_espera;
create view fila_espera as
select
  row_number() over (partition by p.modalidade order by p.entrada_fila_em, p.id) as posicao,
  p.*
from pre_fichas p
where p.status in ('aguardando', 'em_contato');
