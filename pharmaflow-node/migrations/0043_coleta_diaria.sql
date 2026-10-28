-- Migration 0043: coleta dia a dia
--
-- Até aqui o painel guardava só pacotes prontos de 7, 15 e 30 dias
-- (`coletas`), e não dava para ver "setembro fechado". Agora cada farmácia
-- guarda um número por dia e por origem; qualquer período (mês fechado, de/até)
-- é somado aqui, sem nova consulta ao PharmaChatbot.
--
-- A coleta diária busca só os últimos 7 dias no engine-prod e troca esses
-- dias (venda marcada no dia seguinte se corrige sozinha). A carga inicial
-- traz 90 dias, um mês por consulta.
--
-- `coletas` / `coleta_canais` continuam: o importador recalcula as janelas de
-- 7/15/30 a partir desta tabela, e as telas atuais seguem funcionando.
--
-- Idempotente: pode rodar de novo sem estragar nada.

CREATE TABLE IF NOT EXISTS coleta_diaria (
  farmacia_id   integer      NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  dia           date         NOT NULL,
  -- `tickets.origin` cru ("(sem origem)" quando nulo)
  origem        varchar(80)  NOT NULL,
  atendimentos  integer      NOT NULL DEFAULT 0,
  vendas        integer      NOT NULL DEFAULT 0,
  receita       numeric(15,2) NOT NULL DEFAULT 0,
  atualizado_em timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_id, dia, origem)
);

CREATE INDEX IF NOT EXISTS coleta_diaria_dia ON coleta_diaria (dia);
