-- Migration 0044: o gestor escolhe, por disparo, se a campanha pode sair no fim de semana
--
-- Até aqui a regra do dono (11/09/2026, "nada sai em sábado nem domingo") valia
-- para TODOS os disparos, sem exceção. Agora ela continua sendo o padrão, mas o
-- gestor pode liberar o sábado e o domingo ao criar um disparo novo, com um
-- botão na tela.
--
-- Default false: todo disparo que já existe foi criado sob a regra antiga e não
-- pode mudar de comportamento no meio do caminho. Quem quiser postar no fim de
-- semana liga o botão na PRÓXIMA campanha.
--
-- Só vale para disparos criados depois desta migration — não há como (nem
-- motivo para) liberar o fim de semana de uma campanha que já está na fila.

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS permitir_fim_de_semana boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN disparos_grupo.permitir_fim_de_semana IS
  'false (padrão) = o disparo nunca sai em sábado/domingo: o 1º envio é recusado e as repetições são empurradas para segunda. true = o gestor liberou o fim de semana nesta campanha e os envios saem em qualquer dia.';
