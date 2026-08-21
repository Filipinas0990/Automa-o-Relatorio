-- Migration 0025: separa razão social do nome de fachada
--
-- `farmacias.nome` sempre guardou a razão social ("BARROS E SILVA COMERCIO DE
-- MEDICAMENTOS LTDA - DROGARIA BEM ESTAR"), e era ela que ia parar dentro do
-- criativo postado no grupo de ofertas. O cliente final não tem por que ver o
-- nome jurídico do estabelecimento — ele conhece a farmácia pela fachada.
--
-- Entra NULL de propósito: as farmácias já cadastradas não têm o dado, e não
-- dá para inventar. O campo é obrigatório no cadastro novo (validado na API) e
-- quem consome usa `COALESCE(nome_fachada, nome)` até o cadastro antigo ser
-- completado.

ALTER TABLE farmacias
  ADD COLUMN IF NOT EXISTS nome_fachada varchar(120);

COMMENT ON COLUMN farmacias.nome         IS 'Razão social (nome jurídico) — uso interno';
COMMENT ON COLUMN farmacias.nome_fachada IS 'Nome de fachada — é o que aparece para o cliente final';

-- POR QUE NÃO PREENCHEMOS OS ANTIGOS COM UM TEXTO MARCADOR:
-- a ideia de gravar algo como 'Nome da fachada' nas farmácias sem o dado
-- deixaria o marcador SAIR NA ARTE e na mensagem do grupo
-- ("🔥 *OFERTAS* — Nome da fachada 🔥"), que é pior do que a razão social.
-- Quem falta preencher é sinalizado na interface (badge vermelho "SEM
-- FACHADA" na lista de farmácias e no passo 1 do disparo, mais um aviso no
-- passo do criativo), e `nomeVisivel()` segura a ponta até lá.
