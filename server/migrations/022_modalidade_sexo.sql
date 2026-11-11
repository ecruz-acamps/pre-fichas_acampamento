-- Modalidade pode ser só para um sexo (ex.: "Homens"). Vale para novas inscrições; as fichas existentes não mudam.
alter table modalidades add column sexo text check (sexo in ('masculino', 'feminino'));
