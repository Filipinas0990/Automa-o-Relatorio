-- Migration 0010: Configuração e estado da instância WhatsApp (Evolution API)
-- Tabela single-row que guarda instância conectada, QR code e status em tempo real

CREATE TABLE IF NOT EXISTS whatsapp_config (
  id               SERIAL PRIMARY KEY,
  instance_name    VARCHAR(100) NOT NULL,
  -- open = conectado, close = desconectado, connecting = aguardando QR code
  status           VARCHAR(20) NOT NULL DEFAULT 'close',
  qr_code          TEXT,
  numero_conectado VARCHAR(30),
  atualizado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
