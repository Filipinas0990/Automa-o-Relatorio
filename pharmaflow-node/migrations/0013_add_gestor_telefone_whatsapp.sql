-- Migration 0013: telefone WhatsApp nos gestores (para identificar quem manda mensagem)
ALTER TABLE gestores_trafego
  ADD COLUMN IF NOT EXISTS telefone_whatsapp VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gestores_telefone_whatsapp
  ON gestores_trafego (telefone_whatsapp)
  WHERE telefone_whatsapp IS NOT NULL;
