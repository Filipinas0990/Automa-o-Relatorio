-- Migration 0038: remove as credenciais do painel do PharmaChatbot
--
-- O robô que fazia login no painel de cada farmácia e lia os números da tela
-- saiu do sistema. URL, e-mail e senha (criptografada) não têm mais uso, e
-- guardar a senha de login das farmácias é risco sem benefício. Os dados vão
-- chegar pela API do PharmaChatbot, com token próprio.
--
-- IRREVERSÍVEL: as senhas somem do banco. Faça backup antes se quiser guardar.
-- Idempotente: pode rodar de novo sem estragar nada.

ALTER TABLE farmacias DROP COLUMN IF EXISTS url_base;
ALTER TABLE farmacias DROP COLUMN IF EXISTS email;
ALTER TABLE farmacias DROP COLUMN IF EXISTS senha_enc;
