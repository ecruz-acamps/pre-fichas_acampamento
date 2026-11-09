-- Importação de pré-fichas de outro sistema (comando "fichas importar").
--  * a ficha importada guarda o lote e mantém a DATA ORIGINAL da pré-ficha (é ela que define a ordem da fila);
--  * e-mail, CEP, "como conheceu" e "por que participar" podem faltar nas fichas importadas (o sistema antigo não os exigia),
--    mas continuam obrigatórios para quem se inscreve agora (garantido por uma trava: só vale com o lote preenchido).
alter table pre_fichas
  add column importada_lote text,
  add column importada_em   timestamptz,
  alter column email         drop not null,
  alter column cep           drop not null,
  alter column como_conheceu drop not null,
  alter column motivo        drop not null;

alter table pre_fichas add constraint pre_fichas_obrigatorios_check check (
  importada_lote is not null
  or (email is not null and cep is not null and como_conheceu is not null and motivo is not null));
create index pre_fichas_lote_idx on pre_fichas (importada_lote) where importada_lote is not null;

-- Registro de cada importação (permite listar e desfazer um lote inteiro)
create table importacoes (
  lote                 text primary key check (lote ~ '^[A-Za-z0-9._-]{3,60}$'),
  criado_em            timestamptz not null default now(),
  arquivo              text,
  resumo               jsonb,
  acampamentos_criados bigint[] not null default '{}'
);

-- Na inscrição normal, a entrada na fila é "agora". Só uma importação autorizada (marcada na transação pelo próprio
-- comando e com o lote preenchido) mantém a data original da pré-ficha.
create or replace function iniciar_entrada_fila() returns trigger language plpgsql as $$
begin
  if current_setting('app.importacao', true) = 'sim' and new.importada_lote is not null then
    new.entrada_fila_em := new.created_at;
    new.recusas_seguidas := 0;
    return new;
  end if;
  new.created_at := clock_timestamp();
  new.entrada_fila_em := new.created_at;
  new.recusas_seguidas := 0;
  return new;
end;
$$;
