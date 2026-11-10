-- Grupos do Entra ligados aos núcleos: quem criou, nome lido e situação; leitura periódica opcional.
alter table nucleos
  add column entra_grupo_criado boolean not null default false,   -- criado pelo sistema (só esses podem ser apagados por ele)
  add column entra_grupo_nome   text,
  add column entra_grupo_visto  timestamptz,                      -- última vez que o grupo foi encontrado no Entra
  add column entra_grupo_sumiu  boolean not null default false;   -- a leitura não encontrou mais o grupo
alter table sso_config
  add column leitura_dias   integer not null default 0 check (leitura_dias between 0 and 90),   -- 0 = só pelo botão
  add column ultima_leitura timestamptz;
-- Grupos encontrados no Entra (nome começando por "Pré-fichas") que ainda não estão ligados a nenhum núcleo
create table entra_grupos_livres (
  grupo_id  text primary key check (grupo_id ~ '^[0-9a-f-]{36}$'),
  nome      text not null check (char_length(nome) <= 256),
  lido_em   timestamptz not null default now()
);
