# Deploy — PharmaFlow API


```
Código TypeScript (src/)
        ↓
  tsc compila na VPS
        ↓
  Pasta dist/ gerada
        ↓
  docker build copia o dist/
        ↓
  Container roda: node dist/api/index.js
```

---

## Passo a passo completo de deploy

Sempre que houver uma atualização de código, siga essa sequência na VPS:

### 1. Entrar na pasta do projeto

```bash
cd /opt/pharmaflow
```

### 2. Baixar as atualizações do repositório

```bash
      git pull origin main
```

### 3. Compilar o TypeScript no host

```bash
cd pharmaflow-node
node --max-old-space-size=2048 node_modules/.bin/tsc --skipLibCheck
```

> O flag `--max-old-space-size=2048` garante que o Node.js use até 2 GB de RAM para compilar sem travar.  
> O flag `--skipLibCheck` ignora erros de tipagem em bibliotecas de terceiros, acelerando a compilação.

Após esse comando, a pasta `pharmaflow-node/dist/` será criada/atualizada com os arquivos `.js` compilados.

### 4. Reconstruir e reiniciar o container da API

```bash
  docker compose up -d --build api
```

> O `--build` força o Docker a reconstruir a imagem copiando o novo `dist/` para dentro.  
> O `-d` roda em background (detached).  
> O banco de dados (`postgres`) **não é reiniciado** — apenas a API.

### 5. Verificar se subiu corretamente

```bash
docker compose logs -f api
```

Você deve ver a linha:
```
PharmaFlow API rodando em http://0.0.0.0:8000
```

Pressione `Ctrl+C` para sair dos logs sem parar o container.

---

## Resumo rápido (sequência de comandos)

```bash
cd /opt/pharmaflow

git pull origin main

cd pharmaflow-node

node --max-old-space-size=2048 node_modules/.bin/tsc --skipLibCheck

cd /opt/pharmaflow

docker compose up -d --build api

docker compose logs -f api
```

---

## Quando instalar dependências novas

Se o `git pull` trouxer mudanças no `package.json` (novas bibliotecas foram adicionadas), rode o `npm install` antes de compilar:

```bash
cd /opt/pharmaflow/pharmaflow-node
npm install
node --max-old-space-size=2048 node_modules/.bin/tsc --skipLibCheck
cd /opt/pharmaflow
docker compose up -d --build api
```

---

## Senha do Banco de Imagens (uma vez só)

Toda ação no Banco de Imagens (subir, editar, ligar/desligar, classificar,
excluir, baixar) é só do admin **e** pede uma senha. Ela é definida no servidor,
no `.env` da raiz — não existe tela para trocá-la. Sem a variável, as ações do
banco ficam bloqueadas (503).

```bash
# depois do passo 3 (tsc), no servidor:
node pharmaflow-node/dist/gerar-senha-banco.js 'a senha escolhida'
# cole a linha BANCO_IMAGENS_SENHA_HASH=scrypt:... no .env da raiz e:
docker compose up -d --build api
```

Só o hash vai para o `.env`; a senha em si não fica gravada em lugar nenhum.
Para trocar, gere de novo, substitua a linha e reinicie a API. 5 erros seguidos
travam as ações daquele admin por 15 minutos.

## Rodando migrations do banco de dados

Quando uma migration nova for adicionada (pasta `migrations/`), ela precisa ser aplicada no banco **junto com o deploy**. O código novo já espera as tabelas novas: se a migration ficar para trás, a tela quebra com um erro do Postgres (ex.: `relation "grupos_cache_sync" does not exist`).

A pasta `migrations/` **não** é montada dentro do container do Postgres, então o arquivo tem de ser copiado para lá antes:

```bash
cd /opt/pharmaflow
git pull   # traz os .sql novos

docker cp pharmaflow-node/migrations/000X_nome.sql farmacia_db:/tmp/
docker exec farmacia_db psql -U farmacia -d farmacia_monitor -f /tmp/000X_nome.sql
```

Para conferir se aplicou:

```bash
docker exec farmacia_db psql -U farmacia -d farmacia_monitor -c '\d nome_da_tabela'
```

> Sempre verifique o número da última migration aplicada antes de rodar uma nova.
> As migrations são escritas para poder rodar de novo sem estragar nada
> (`IF NOT EXISTS`), então repetir uma já aplicada é seguro.

---

## Estrutura dos serviços Docker

| Serviço | Container | Porta | Descrição |
|---|---|---|---|
| `postgres` | `farmacia_db` | 5432 | Banco de dados PostgreSQL 16 |
| `api` | `farmacia_api` | 8000 | API Fastify — sempre rodando |

### Coleta de dados

Não há mais serviço de coleta. O robô que fazia login no painel do
PharmaChatbot foi removido; os dados vão chegar pela API do PharmaChatbot
quando ela existir. Não há cron de coleta na VPS.

---

## Comandos úteis do dia a dia

```bash
# Ver status de todos os containers
docker compose ps

# Ver logs da API em tempo real
docker compose logs -f api

# Ver logs do banco
docker compose logs -f postgres

# Reiniciar só a API (sem rebuild — quando não há mudança de código)
docker compose restart api

# Parar tudo
docker compose down

# Parar tudo e apagar os volumes (CUIDADO — apaga o banco!)
docker compose down -v
```

---

## Por que o TypeScript é compilado fora do Docker?

O Dockerfile foi configurado dessa forma intencionalmente:

```dockerfile
# TypeScript compilado no host antes do docker build (evita OOM dentro do container)
# Execute: node --max-old-space-size=2048 node_modules/.bin/tsc --skipLibCheck
```

Compilar TypeScript dentro de um container em VPS de pouca RAM frequentemente causa:
- Processo morto pelo sistema (`killed`) por falta de memória
- Build extremamente lento
- Falha silenciosa sem mensagem de erro clara

Compilando no host (na própria VPS, fora do Docker), o Node.js tem acesso direto à memória disponível sem as restrições do container, tornando o processo mais estável e rápido.

ssh -i ~/.ssh/minha-chave-aws ubuntu@3.239.249.15
