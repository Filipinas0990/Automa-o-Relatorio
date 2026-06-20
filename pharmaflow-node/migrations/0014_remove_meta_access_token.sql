-- Migration 0014: remove access_token da tabela meta_tokens
-- O token agora vem do env META_ACCESS_TOKEN (System User do Business Manager)
ALTER TABLE meta_tokens DROP COLUMN IF EXISTS access_token;
