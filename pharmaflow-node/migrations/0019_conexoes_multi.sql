-- Migration 0019: seleção de conexão no disparo (multi-conexão)
--
-- O disparo passa a poder sair de QUALQUER conexão — a do gestor (gestor_<id>)
-- ou uma das conexões globais da tela "Conexões". Então guardamos a instância
-- Evolution escolhida no próprio disparo (para os agendados saberem por onde
-- enviar). E a whatsapp_config, que era uma linha só, ganha um nome amigável e
-- passa a comportar várias conexões.

-- Instância Evolution escolhida para este disparo. Null = usa a do gestor
-- (compatibilidade com disparos criados antes desta migration).
ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS instance_name varchar(100);

-- Nome amigável da conexão global (ex.: "WhatsApp Ofertas SP").
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS nome varchar(120);

-- Cada conexão global é uma instância distinta — evita duplicar o mesmo nome.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_instance
  ON whatsapp_config (instance_name);
