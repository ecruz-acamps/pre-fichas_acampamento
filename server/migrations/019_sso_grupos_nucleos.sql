-- Login Microsoft: o núcleo do coordenador pode vir do grupo do Microsoft Entra (sem liberação manual).
alter table nucleos add column entra_grupo_id text check (entra_grupo_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
create unique index nucleos_entra_grupo_uk on nucleos (lower(entra_grupo_id)) where entra_grupo_id is not null;
-- usuários criados pelo login Microsoft: os núcleos são sincronizados a cada entrada com os grupos do Entra
alter table usuarios add column sso_gerenciado boolean not null default false;
-- 'liberacao' = quem entra pela 1ª vez fica aguardando liberação; 'grupos' = entra direto, com os núcleos dos grupos do Entra
alter table sso_config add column provisionar text not null default 'liberacao' check (provisionar in ('liberacao', 'grupos'));
