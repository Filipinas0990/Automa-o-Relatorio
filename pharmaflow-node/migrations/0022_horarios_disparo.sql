-- Migration 0022: horários pré-definidos de disparo
--
-- No agendamento o gestor digitava a hora na mão toda vez. Agora ele configura
-- os horários que a operação usa (Configurações → Horários de Disparo) e, na
-- hora de agendar, escolhe num clique.
--
-- `horario` é varchar "HH:MM" de propósito, e não `time`: é exatamente o que o
-- <input type="time"> manda e devolve, sem conversão de fuso no meio do
-- caminho. O fuso do disparo já é resolvido em disparos_grupo.timezone.

CREATE TABLE IF NOT EXISTS horarios_disparo (
  id        serial PRIMARY KEY,
  gestor_id integer     NOT NULL REFERENCES gestores_trafego(id),
  horario   varchar(5)  NOT NULL,
  -- nome opcional dado pelo gestor ("Abertura", "Pico da tarde"...)
  rotulo    varchar(40),
  criado_em timestamptz NOT NULL DEFAULT NOW()
);

-- O mesmo horário duas vezes na lista só confunde na hora de escolher.
CREATE UNIQUE INDEX IF NOT EXISTS idx_horarios_disparo_gestor_hora
  ON horarios_disparo (gestor_id, horario);
