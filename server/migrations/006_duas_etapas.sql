-- =====================================================================
-- 006 · Verificação em duas etapas (TOTP) opcional por usuário
-- =====================================================================
alter table usuarios
  add column totp_segredo text check (char_length(totp_segredo) <= 64),
  add column totp_ativo boolean not null default false,
  add column totp_ultimo_passo bigint;
