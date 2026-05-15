-- Migration v5: Sistema de pontos mensais por gestor
-- Adiciona atingiu_meta em coletas + view de ranking mensal de gestores
-- Execute no servidor após o git pull:
--   docker compose exec postgres psql -U farmacia -d farmacia_monitor -f /app/sql/migration_v5.sql

-- 1. Coluna que congela se a farmácia bateu a meta no momento da coleta
ALTER TABLE coletas
    ADD COLUMN IF NOT EXISTS atingiu_meta BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. View: pontos por gestor por mês
--    1 ponto = 1 coleta onde a farmácia atingiu a meta
--    Zera automaticamente a cada virada de mês (sem cron necessário)
CREATE OR REPLACE VIEW vw_pontos_gestor_mensal AS
SELECT
    g.id                                            AS gestor_id,
    g.nome                                          AS gestor_nome,
    DATE_TRUNC('month', c.data_coleta)::DATE        AS mes,
    COUNT(*) FILTER (WHERE c.atingiu_meta = TRUE)   AS pontos,
    COUNT(*)                                        AS coletas_no_mes,
    COUNT(DISTINCT c.farmacia_id)                   AS farmacias_ativas,
    RANK() OVER (
        PARTITION BY DATE_TRUNC('month', c.data_coleta)
        ORDER BY COUNT(*) FILTER (WHERE c.atingiu_meta = TRUE) DESC
    )                                               AS posicao
FROM gestores_trafego g
JOIN farmacias f        ON f.gestor_id = g.id AND f.ativa = TRUE
JOIN coletas   c        ON c.farmacia_id = f.id
WHERE g.ativo = TRUE
GROUP BY g.id, g.nome, DATE_TRUNC('month', c.data_coleta);

-- 3. View auxiliar: somente o mês atual (usada pelo endpoint /api/ranking/gestores)
CREATE OR REPLACE VIEW vw_ranking_gestores_atual AS
SELECT *
FROM vw_pontos_gestor_mensal
WHERE mes = DATE_TRUNC('month', NOW())::DATE;

SELECT 'Migration v5 aplicada com sucesso!' AS resultado;
