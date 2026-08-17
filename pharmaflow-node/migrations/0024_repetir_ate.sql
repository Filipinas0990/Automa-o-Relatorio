-- Migration 0024: data em que a repetição termina
--
-- O modal já mostrava "Data de término" desde o começo, mas o campo NUNCA foi
-- aplicado: o disparo repetia para sempre até alguém cancelar no Histórico.
-- Agora a data é de verdade — depois dela o disparo é finalizado.
--
-- NULL = repete até o gestor cancelar (é o padrão da tela).

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS repetir_ate timestamptz;
