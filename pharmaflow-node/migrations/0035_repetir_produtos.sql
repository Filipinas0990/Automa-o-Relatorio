-- Migration 0035: a lista de produtos pode dar a volta (escolha do gestor)
--
-- Até aqui um disparo repetido terminava por uma de DUAS razões, o que viesse
-- primeiro: os produtos acabarem (rodízio sem volta, 0034) ou chegar a data de
-- término. Regra do dono (10/09/2026): o gestor decide, por campanha, se a
-- lista recomeça quando acaba.
--
-- Com repetir_produtos = true sobra UMA razão para terminar: a data de término
-- definida pelo gestor. O cursor volta a zero ao alcançar o fim de midias_json
-- e a campanha segue postando a lista de novo, do começo.
--
-- Default false: as campanhas que já existem foram criadas sob a regra da 0034
-- e não podem mudar de comportamento no meio do caminho — quem quiser a volta
-- liga o toggle na próxima campanha.

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS repetir_produtos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN disparos_grupo.repetir_produtos IS
  'true = ao chegar no fim de midias_json a lista recomeça do zero, e só a data de término (repetir_ate) encerra a campanha. false (padrão) = acabaram os produtos, acabou a campanha.';

COMMENT ON COLUMN disparos_grupo.cursor_midia IS
  'Índice em midias_json de onde o PRÓXIMO envio começa. Avança de 3 em 3. Ao alcançar o fim: com repetir_produtos = true volta para 0, senão o disparo é encerrado. Sempre 0 quando repetir = nunca.';
