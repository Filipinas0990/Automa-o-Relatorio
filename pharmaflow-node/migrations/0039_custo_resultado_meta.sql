-- Migration 0039: custo por resultado do Meta Ads (7, 15 e 30 dias)
--
-- Um job diário (06:00, horário de Brasília) lê no Meta o gasto e os resultados
-- de cada farmácia nas janelas de 7, 15 e 30 dias — sempre terminando ONTEM —
-- e grava aqui o custo por resultado. Não há histórico: cada rodada sobrescreve
-- a anterior (uma linha por farmácia e janela).
--
-- Idempotente: pode rodar de novo sem estragar nada.

CREATE TABLE IF NOT EXISTS custo_resultado_meta (
  farmacia_id         integer       NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  janela_dias         integer       NOT NULL,
  periodo_inicio      date,
  periodo_fim         date,
  gasto               numeric(15,2) NOT NULL DEFAULT 0,
  resultados          integer       NOT NULL DEFAULT 0,
  -- gasto / resultados; null quando não houve resultado (não dá para dividir)
  custo_por_resultado numeric(15,2),
  -- Tipo de resultado dominante ("Conversas no WhatsApp", "Leads"...)
  tipo_resultado      varchar(80),
  cliques             integer       NOT NULL DEFAULT 0,
  impressoes          integer       NOT NULL DEFAULT 0,
  -- Última falha ao ler esta farmácia (null = a última leitura deu certo).
  -- Os números acima ficam os da última leitura boa.
  erro                text,
  sincronizado_em     timestamptz   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (farmacia_id, janela_dias),
  CONSTRAINT custo_resultado_meta_janela CHECK (janela_dias IN (7, 15, 30))
);

-- Linha única (id = 1): quando o job rodou por último. Serve para o scheduler
-- não repetir a rodada do dia a cada reinício da API.
CREATE TABLE IF NOT EXISTS custo_resultado_meta_execucao (
  id           integer     PRIMARY KEY DEFAULT 1,
  executado_em timestamptz NOT NULL DEFAULT NOW(),
  farmacias_ok integer     NOT NULL DEFAULT 0,
  farmacias_erro integer   NOT NULL DEFAULT 0,
  CONSTRAINT custo_resultado_meta_execucao_linha_unica CHECK (id = 1)
);
