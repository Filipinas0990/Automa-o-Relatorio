-- ============================================================
-- Banco de dados: farmacia_monitor
-- ============================================================

CREATE TABLE IF NOT EXISTS gestores_trafego (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(120) NOT NULL,
    email       VARCHAR(120) UNIQUE NOT NULL,
    senha_hash  VARCHAR(255) NOT NULL,
    is_admin    BOOLEAN DEFAULT FALSE NOT NULL,
    ativo       BOOLEAN DEFAULT TRUE,
    criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farmacias (
    id                  SERIAL PRIMARY KEY,
    nome                VARCHAR(120) NOT NULL,
    url_base            VARCHAR(255) NOT NULL,
    email               VARCHAR(120) NOT NULL,
    senha_enc           TEXT,
    gestor_id           INTEGER REFERENCES gestores_trafego(id) ON DELETE SET NULL,
    ativa               BOOLEAN DEFAULT TRUE,
    criado_em           TIMESTAMPTZ DEFAULT NOW(),
    meta_vendas         INTEGER,
    meta_receita        NUMERIC(12, 2),
    meta_leads_google   INTEGER,
    meta_leads_meta     INTEGER
);

CREATE TABLE IF NOT EXISTS coletas (
    id                      SERIAL PRIMARY KEY,
    farmacia_id             INTEGER NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
    data_coleta             TIMESTAMPTZ DEFAULT NOW(),
    periodo_inicio          DATE NOT NULL,
    periodo_fim             DATE NOT NULL,
    periodo_dias            INTEGER DEFAULT 7,

    clientes_google         INTEGER DEFAULT 0,
    clientes_facebook       INTEGER DEFAULT 0,
    clientes_grupos_oferta  INTEGER DEFAULT 0,
    total_atendimentos      INTEGER DEFAULT 0,

    vendas_realizadas       INTEGER DEFAULT 0,
    receita_total           NUMERIC(12, 2) DEFAULT 0,

    variacao_google         NUMERIC(8, 2) DEFAULT 0,
    variacao_facebook       NUMERIC(8, 2) DEFAULT 0,
    variacao_grupos         NUMERIC(8, 2) DEFAULT 0,
    variacao_vendas         NUMERIC(8, 2) DEFAULT 0,
    variacao_receita        NUMERIC(8, 2) DEFAULT 0,

    score_criticidade       NUMERIC(5, 2) DEFAULT 0,
    nivel_alerta            VARCHAR(10) DEFAULT 'verde' NOT NULL
        CHECK (nivel_alerta IN ('verde', 'amarelo', 'vermelho')),

    atingiu_meta            BOOLEAN DEFAULT FALSE NOT NULL,
    atingiu_meta_google     BOOLEAN,
    atingiu_meta_meta       BOOLEAN
);

CREATE TABLE IF NOT EXISTS coleta_canais (
    id              SERIAL PRIMARY KEY,
    coleta_id       INTEGER NOT NULL REFERENCES coletas(id) ON DELETE CASCADE,
    canal           VARCHAR(80) NOT NULL,
    atendimentos    INTEGER DEFAULT 0,
    vendas          INTEGER DEFAULT 0,
    receita_vendas  NUMERIC(12, 2) DEFAULT 0
);

-- ============================================================
-- Índices
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_coletas_farmacia_id  ON coletas(farmacia_id);
CREATE INDEX IF NOT EXISTS idx_coletas_data_coleta  ON coletas(data_coleta DESC);
CREATE INDEX IF NOT EXISTS idx_coletas_nivel_alerta ON coletas(nivel_alerta);
CREATE INDEX IF NOT EXISTS idx_coletas_score        ON coletas(score_criticidade DESC);
CREATE INDEX IF NOT EXISTS idx_coletas_periodo_dias ON coletas(periodo_dias);
CREATE INDEX IF NOT EXISTS idx_canais_coleta_id     ON coleta_canais(coleta_id);

-- ============================================================
-- View: ranking atual (última coleta de cada farmácia)
-- ============================================================

CREATE OR REPLACE VIEW vw_ranking_atual AS
WITH latest AS (
    SELECT DISTINCT ON (farmacia_id, periodo_dias)
        id, farmacia_id, periodo_dias, data_coleta,
        periodo_inicio, periodo_fim,
        clientes_google, clientes_facebook, clientes_grupos_oferta,
        total_atendimentos, vendas_realizadas, receita_total,
        variacao_google, variacao_facebook, variacao_grupos,
        variacao_vendas, variacao_receita,
        score_criticidade, nivel_alerta
    FROM coletas
    ORDER BY farmacia_id, periodo_dias, data_coleta DESC
)
SELECT
    f.id                        AS farmacia_id,
    f.nome                      AS farmacia,
    l.data_coleta,
    l.periodo_inicio,
    l.periodo_fim,
    l.periodo_dias,
    l.clientes_google,
    l.clientes_facebook,
    l.clientes_grupos_oferta,
    l.total_atendimentos,
    l.vendas_realizadas,
    l.receita_total,
    l.variacao_google,
    l.variacao_facebook,
    l.variacao_grupos,
    l.variacao_vendas,
    l.variacao_receita,
    l.score_criticidade,
    l.nivel_alerta,
    RANK() OVER (PARTITION BY l.periodo_dias ORDER BY l.score_criticidade DESC) AS posicao_ranking
FROM farmacias f
JOIN latest l ON l.farmacia_id = f.id
WHERE f.ativa = TRUE;

-- ============================================================
-- View: evolução semanal (últimas 8 semanas por farmácia)
-- ============================================================

CREATE OR REPLACE VIEW vw_evolucao_semanal AS
SELECT
    f.id            AS farmacia_id,
    f.nome          AS farmacia,
    c.periodo_inicio,
    c.periodo_fim,
    c.periodo_dias,
    c.clientes_google,
    c.clientes_facebook,
    c.clientes_grupos_oferta,
    c.vendas_realizadas,
    c.receita_total,
    c.score_criticidade,
    c.nivel_alerta,
    ROW_NUMBER() OVER (
        PARTITION BY f.id, c.periodo_dias ORDER BY c.data_coleta DESC
    ) AS semana_numero
FROM farmacias f
JOIN coletas c ON c.farmacia_id = f.id
WHERE f.ativa = TRUE
  AND c.data_coleta >= NOW() - INTERVAL '56 days';
