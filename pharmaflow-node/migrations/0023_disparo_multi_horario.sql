-- Migration 0023: um disparo pode sair em vários horários fixos
--
-- Antes cada disparo tinha UM horário (agendado_para) e a repetição só andava
-- de dia/semana/mês. Agora o gestor marca vários horários pré-definidos —
-- ex.: 08:00 e 18:00 — e o disparo passa em todos eles, em cada ocorrência.
--
-- JSON simples (["08:00","18:00"], ordenado) em vez de tabela filha: a lista é
-- curta, imutável depois de criada e sempre lida junto com o disparo.
-- NULL/vazio = comportamento antigo, um horário só (agendado_para).

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS horarios_json text;
