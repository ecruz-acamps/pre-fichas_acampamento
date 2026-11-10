-- Login com a conta Microsoft corporativa (Microsoft Entra ID, OpenID Connect). O segredo do aplicativo NÃO fica no banco (variável MICROSOFT_CLIENT_SECRET).
create table sso_config (
  id               boolean primary key default true check (id),
  ativo            boolean not null default false,
  tenant_id        text check (tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  client_id        text check (client_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  criar_pendentes  boolean not null default true,    -- quem entra pela 1ª vez vira "cadastro aguardando liberação"
  atualizado_em    timestamptz not null default now()
);
insert into sso_config (id) values (true);
-- identificador imutável da pessoa no Microsoft (oid): vincula a conta ao usuário Microsoft, não só ao e-mail
alter table usuarios add column sso_oid text check (char_length(sso_oid) <= 64);
create unique index usuarios_sso_oid_uk on usuarios (sso_oid) where sso_oid is not null;
