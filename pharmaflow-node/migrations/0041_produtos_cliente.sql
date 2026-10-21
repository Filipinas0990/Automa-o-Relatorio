-- Migration 0041: produtos que o próprio cliente envia pelo link de ofertas
--
-- Além de escolher no banco de imagens da agência, o dono da farmácia pode
-- mandar os produtos dele (foto + nome) pelo link público. Cada farmácia tem
-- um espaço de NO MÁXIMO 30 produtos (decisão do dono em 20/10/2026). Para
-- liberar vaga, o cliente exclui um dos que já mandou.
--
-- O limite é garantido AQUI, no banco, e não só na API: o gatilho trava a
-- linha da farmácia antes de contar, então dois envios ao mesmo tempo não
-- passam juntos do 30. A API confere antes só para dar uma mensagem amigável.
-- Se um dia o limite mudar, troque o 30 aqui E em LIMITE_PRODUTOS_CLIENTE
-- (src/ofertas/ProdutoClienteService.ts).
--
-- Idempotente: pode rodar de novo sem estragar nada.

CREATE TABLE IF NOT EXISTS produtos_cliente (
  id           serial PRIMARY KEY,
  farmacia_id  integer NOT NULL REFERENCES farmacias(id) ON DELETE CASCADE,
  nome         varchar(120) NOT NULL,
  -- Foto em base64 (sem o prefixo data:), como em catalogo_produtos.
  imagem_b64   text NOT NULL,
  mime         varchar(40) NOT NULL DEFAULT 'image/jpeg',
  criado_em    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS produtos_cliente_farmacia_idx ON produtos_cliente (farmacia_id);

COMMENT ON TABLE produtos_cliente IS
  'Produtos (foto + nome) enviados pelo dono da farmácia pelo link de ofertas. Máximo de 30 por farmácia, garantido pelo gatilho produtos_cliente_limite.';

CREATE OR REPLACE FUNCTION produtos_cliente_limite() RETURNS trigger AS $$
BEGIN
  -- Trava a farmácia: envios simultâneos do mesmo cliente esperam a vez.
  PERFORM 1 FROM farmacias WHERE id = NEW.farmacia_id FOR UPDATE;
  IF (SELECT count(*) FROM produtos_cliente WHERE farmacia_id = NEW.farmacia_id) >= 30 THEN
    RAISE EXCEPTION 'limite_produtos_cliente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS produtos_cliente_limite ON produtos_cliente;
CREATE TRIGGER produtos_cliente_limite
  BEFORE INSERT ON produtos_cliente
  FOR EACH ROW EXECUTE FUNCTION produtos_cliente_limite();
