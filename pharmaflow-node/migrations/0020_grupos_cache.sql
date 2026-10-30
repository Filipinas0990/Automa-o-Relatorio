-- Migration 0020: cache dos grupos de WhatsApp
--
-- Listar grupos batia direto no /group/fetchAllGroups da Evolution a CADA
-- request, e esse endpoint sincroniza os metadados de todos os grupos com o
-- WhatsApp — em contas com muitos grupos são dezenas de segundos, toda vez que
-- o gestor abre o passo 2 do disparo.
--
-- Agora a listagem sai destas tabelas (resposta imediata) e o refresh acontece
-- em background quando o cache está velho, ou sob demanda no botão "Atualizar".

-- Um registro por grupo, por instância Evolution.
CREATE TABLE IF NOT EXISTS grupos_cache (
  instance_name varchar(100) NOT NULL,
  jid           varchar(120) NOT NULL,
  nome          varchar(255) NOT NULL,
  participantes integer,
  atualizado_em timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_name, jid)
);
-- A PK já indexa (instance_name, ...), que é como a listagem sempre filtra.

-- Quando cada instância foi sincronizada por inteiro. Tabela separada porque
-- precisamos saber a idade do cache mesmo quando a conexão não tem grupo
-- nenhum — senão "zero grupos" seria indistinguível de "nunca sincronizado" e
-- o gestor pagaria o fetchAllGroups lento em toda visita.
CREATE TABLE IF NOT EXISTS grupos_cache_sync (
  instance_name   varchar(100) PRIMARY KEY,
  sincronizado_em timestamptz NOT NULL DEFAULT NOW(),
  -- Última falha de sincronização (null = último sync deu certo). Serve para a
  -- UI avisar "mostrando lista de X min atrás" em vez de mentir silenciosamente.
  erro            text
);