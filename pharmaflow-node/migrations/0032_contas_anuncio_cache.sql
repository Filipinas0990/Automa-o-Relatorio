-- Migration 0032: cache das contas de anúncio do Meta
--
-- A etapa 1 do wizard de campanha ("Em qual conta será subida a campanha?")
-- chamava /me/adaccounts na Graph API a CADA abertura da tela. Esse endpoint
-- pede, por conta, o business dono e o funding_source_details (a forma de
-- pagamento), e a Meta leva vários segundos para montar isso — com paginação
-- de 100 em 100, o gestor ficava olhando "Carregando contas de anúncios..."
-- toda vez que ia subir uma campanha.
--
-- Mesma solução da migration 0020 (cache dos grupos de WhatsApp): a listagem
-- passa a sair daqui, e o refresh acontece em background quando o cache está
-- velho, ou sob demanda no botão "Atualizar". A lista de contas muda quando
-- entra cliente novo no BM — questão de semanas —, então servir o que está
-- salvo é correto, não um atalho.

-- Uma linha por conta de anúncio. É o retrato do que o token enxerga, e não um
-- cadastro: quem sai do BM some daqui no próximo sync.
CREATE TABLE IF NOT EXISTS contas_anuncio_cache (
  id              varchar(40)  PRIMARY KEY,          -- "act_123456789"
  account_id      varchar(40)  NOT NULL,             -- "123456789"
  nome            varchar(255) NOT NULL,
  cliente         varchar(255) NOT NULL DEFAULT '',  -- nome do Business Manager dono
  moeda           varchar(10)  NOT NULL DEFAULT '',
  status          varchar(40)  NOT NULL DEFAULT '',  -- rótulo legível ("Ativa", "Fechada"...)
  ativa           boolean      NOT NULL DEFAULT false,
  tem_pagamento   boolean      NOT NULL DEFAULT false,
  forma_pagamento text         NOT NULL DEFAULT '',
  atualizado_em   timestamptz  NOT NULL DEFAULT NOW()
);

-- Quando a lista inteira foi sincronizada. Tabela à parte pelo mesmo motivo da
-- grupos_cache_sync: sem ela, "nenhuma conta" seria indistinguível de "nunca
-- sincronizei", e o gestor pagaria a chamada lenta em toda visita.
--
-- Linha única (id = 1): o token é um só, do System User do BM, e enxerga o
-- mesmo conjunto de contas para todo mundo — não há o que particionar.
CREATE TABLE IF NOT EXISTS contas_anuncio_cache_sync (
  id              integer     PRIMARY KEY DEFAULT 1,
  sincronizado_em timestamptz NOT NULL DEFAULT NOW(),
  -- Última falha (null = último sync deu certo). Serve para a tela avisar
  -- "mostrando a lista de X min atrás" em vez de mentir em silêncio.
  erro            text,
  CONSTRAINT contas_anuncio_cache_sync_linha_unica CHECK (id = 1)
);
