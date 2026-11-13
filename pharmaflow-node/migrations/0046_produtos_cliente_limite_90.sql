-- Espaço de produtos do cliente (link de ofertas) passa de 30 para 90 por
-- farmácia (decisão do dono em 13/11/2026). Só troca o número do gatilho;
-- o valor tem de bater com LIMITE_PRODUTOS_CLIENTE em
-- src/ofertas/ProdutoClienteService.ts.

CREATE OR REPLACE FUNCTION produtos_cliente_limite() RETURNS trigger AS $$
BEGIN
  -- Trava a farmácia: envios simultâneos do mesmo cliente esperam a vez.
  PERFORM 1 FROM farmacias WHERE id = NEW.farmacia_id FOR UPDATE;
  IF (SELECT count(*) FROM produtos_cliente WHERE farmacia_id = NEW.farmacia_id) >= 90 THEN
    RAISE EXCEPTION 'limite_produtos_cliente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE produtos_cliente IS
  'Produtos (foto + nome) enviados pelo dono da farmácia pelo link de ofertas. Máximo de 90 por farmácia, garantido pelo gatilho produtos_cliente_limite.';
