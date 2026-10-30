-- Migration 0011: Telefone direto na reunião
-- Número WhatsApp do contato que receberá a notificação 5h antes

ALTER TABLE reunioes
  ADD COLUMN IF NOT EXISTS telefone VARCHAR(20);