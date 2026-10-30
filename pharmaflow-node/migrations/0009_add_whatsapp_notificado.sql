-- Migration 0009: Rastreamento de notificação WhatsApp para reuniões
-- Adiciona coluna para evitar envio duplicado da mensagem de confirmação

ALTER TABLE reunioes
  ADD COLUMN IF NOT EXISTS whatsapp_notificado_em TIMESTAMP WITH TIME ZONE;