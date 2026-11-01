-- =====================================================================
-- 003 · Recusas, "mover para o fim da fila" e trilha de auditoria
--
-- created_at       = data/hora ORIGINAL da inscrição (nunca muda)
-- entrada_fila_em  = data/hora que define a POSIÇÃO na fila. Começa igual à
--                    inscrição; quando a pessoa recusa 2x seguidas (ou a equipe
--                    decide), passa a ser "agora" — ela vai para o fim da fila.
--                    Só pode AVANÇAR no tempo (ninguém fura a fila).
-- =====================================================================

drop view fila_espera;

alter table pre_fichas add column entrada_fila_em timestamptz;
update pre_fichas set entrada_fila_em = created_at;
alter table pre_fichas
  alter column entrada_fila_em set not null,
  add column recusas_seguidas integer not null default 0 check (recusas_seguidas >= 0);

drop index pre_fichas_fila_idx;
create index pre_fichas_fila_idx on pre_fichas (modalidade, status, entrada_fila_em, id);

-- Na inscrição, a entrada na fila é exatamente a data da inscrição.
create function iniciar_entrada_fila() returns trigger language plpgsql as $$
begin
  new.created_at := clock_timestamp();
  new.entrada_fila_em := new.created_at;
  new.recusas_seguidas := 0;
  return new;
end;
$$;
create trigger pre_fichas_iniciar_fila
  before insert on pre_fichas
  for each row execute function iniciar_entrada_fila();

-- Inscrição: nunca muda. Entrada na fila: só pode ir para depois.
create or replace function proteger_ordem_fila() returns trigger language plpgsql as $$
begin
  if new.created_at is distinct from old.created_at or new.id is distinct from old.id then
    raise exception 'A data/hora de inscrição não pode ser alterada.';
  end if;
  if new.entrada_fila_em < old.entrada_fila_em then
    raise exception 'A posição na fila só pode ser movida para o fim, nunca adiantada.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Histórico = trilha de auditoria
-- ---------------------------------------------------------------------
alter table pre_fichas_historico
  add column tipo text not null default 'observacao'
    check (tipo in ('inscricao', 'status', 'observacao', 'recusa', 'fim_da_fila', 'acampamento')),
  add column detalhes jsonb;

update pre_fichas_historico set tipo = case
  when observacao ~ '^(Fez o|Tribo alterada|Registro no)' then 'acampamento'
  when status_novo is not null then 'status'
  else 'observacao' end;

create index pre_fichas_historico_tipo_idx on pre_fichas_historico (tipo, criado_em desc);
create index pre_fichas_historico_data_idx on pre_fichas_historico (criado_em desc);

-- A trilha não pode ser editada.
create function historico_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'O histórico (trilha de auditoria) não pode ser alterado.';
end;
$$;
create trigger pre_fichas_historico_imutavel
  before update on pre_fichas_historico
  for each row execute function historico_imutavel();

-- Registro da inscrição na trilha (feito pelo banco)
create function auditar_inscricao() returns trigger language plpgsql as $$
begin
  insert into pre_fichas_historico (pre_ficha_id, criado_em, tipo, detalhes)
  values (new.id, new.created_at, 'inscricao', jsonb_build_object('modalidade', new.modalidade));
  return null;
end;
$$;
create trigger pre_fichas_auditar_inscricao
  after insert on pre_fichas
  for each row execute function auditar_inscricao();

insert into pre_fichas_historico (pre_ficha_id, criado_em, tipo, detalhes)
select id, created_at, 'inscricao', jsonb_build_object('modalidade', modalidade) from pre_fichas;

-- Toda mudança na posição da fila é registrada PELO BANCO, com data anterior e
-- nova, quem fez e o motivo — inclusive se alguém alterar direto no banco.
-- A aplicação informa usuário e motivo com set_config('app.usuario_id' / 'app.motivo').
create function auditar_entrada_fila() returns trigger language plpgsql as $$
declare
  usuario text := nullif(current_setting('app.usuario_id', true), '');
  motivo  text := nullif(current_setting('app.motivo', true), '');
begin
  insert into pre_fichas_historico (pre_ficha_id, usuario_id, tipo, observacao, detalhes)
  values (new.id, usuario::bigint, 'fim_da_fila',
          coalesce(motivo, '(alterado diretamente no banco de dados)'),
          jsonb_build_object('entrada_anterior', old.entrada_fila_em,
                             'entrada_nova', new.entrada_fila_em,
                             'inscricao_original', new.created_at));
  return null;
end;
$$;
create trigger pre_fichas_auditar_entrada_fila
  after update of entrada_fila_em on pre_fichas
  for each row when (old.entrada_fila_em is distinct from new.entrada_fila_em)
  execute function auditar_entrada_fila();

-- Visão da fila (recriada): ordem pela entrada na fila
create view fila_espera as
select
  row_number() over (partition by p.modalidade order by p.entrada_fila_em, p.id) as posicao,
  p.*
from pre_fichas p
where p.status in ('aguardando', 'em_contato');
