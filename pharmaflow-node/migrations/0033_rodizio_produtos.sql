-- Migration 0033: rodízio de produtos no disparo repetido
--
-- Até aqui um disparo mandava SEMPRE o `midias_json` inteiro, em toda ocorrência
-- e em todo horário. Com 20 produtos, 3 horários por dia e repetição semanal por
-- 2 meses, o grupo do cliente recebia as mesmas 20 artes, na mesma ordem, 3x por
-- dia — centenas de postagens idênticas. Além de queimar o grupo, é o padrão de
-- repetição que mais pesa no risco de ban do número.
--
-- Agora, quando o disparo se repete, cada envio leva um LOTE de 3 produtos e o
-- cursor avança; ao chegar no fim da lista, recomeça do início (decisão do dono
-- em 09/09/2026: 3 fixos, ordem da lista, recomeça a volta).
--
-- O cursor vive aqui e não em memória porque a API reinicia e o agendador
-- (`setInterval` de 60s do scheduler) precisa continuar de onde parou.
--
-- Começa em 0 para todo mundo, inclusive os disparos já agendados: o próximo
-- envio deles passa a mandar os 3 primeiros produtos em vez da lista inteira.
-- Isso é a correção, não um efeito colateral.
--
-- Envio único (`repetir = 'nunca'`) NÃO entra no rodízio — só há uma ocorrência,
-- então fatiar deixaria o resto dos produtos sem sair nunca. Essa regra está no
-- código (`fatiarRodizio`), não em constraint: depende de `repetir`, não da coluna.

ALTER TABLE disparos_grupo
  ADD COLUMN IF NOT EXISTS cursor_midia integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN disparos_grupo.cursor_midia IS
  'Índice em midias_json de onde o PRÓXIMO envio começa. Avança de 3 em 3 e dá a volta. Sempre 0 quando repetir = nunca.';
