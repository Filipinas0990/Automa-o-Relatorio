-- Migration v6: Meta de leads por canal (Google e Meta/Facebook)
-- Rodar no servidor: psql $DATABASE_URL -f sql/migration_v6_leads_meta.sql

ALTER TABLE farmacias
  ADD COLUMN IF NOT EXISTS meta_leads_google INTEGER,
  ADD COLUMN IF NOT EXISTS meta_leads_meta   INTEGER;

ALTER TABLE coletas
  ADD COLUMN IF NOT EXISTS atingiu_meta_google BOOLEAN,
  ADD COLUMN IF NOT EXISTS atingiu_meta_meta   BOOLEAN;
