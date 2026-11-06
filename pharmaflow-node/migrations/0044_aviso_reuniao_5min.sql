-- Migration 0044: Aviso WhatsApp 5 minutos antes da reunião
-- Coluna própria (separada do lembrete de 5h) para não enviar o aviso duas vezes.
-- null = aviso ainda não enviado

ALTER TABLE reunioes
  ADD COLUMN IF NOT EXISTS whatsapp_aviso_5min_em TIMESTAMP WITH TIME ZONE;
