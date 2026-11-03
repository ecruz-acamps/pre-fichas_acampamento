-- =====================================================================
-- 009 · Segundo logo, usado no cabeçalho da ficha impressa (ex.: brasão da paróquia)
-- =====================================================================
alter table marca
  add column logo_impressao bytea,
  add column logo_impressao_tipo text check (logo_impressao_tipo in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'));
