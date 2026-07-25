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
cd /opt/pharmaflow
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

## Rodando migrations do banco de dados

Quando uma migration nova for adicionada (pasta `migrations/`), ela precisa ser aplicada no banco antes ou logo após o deploy:

```bash
docker compose exec postgres psql -U farmacia -d farmacia_monitor -f /migrations/000X_nome.sql
```

Ou usando a variável `DATABASE_URL` diretamente:

```bash
docker compose exec api npx drizzle-kit push
```

> Sempre verifique o número da última migration aplicada antes de rodar uma nova.

---

## Estrutura dos serviços Docker

| Serviço | Container | Porta | Descrição |
|---|---|---|---|
| `postgres` | `farmacia_db` | 5432 | Banco de dados PostgreSQL 16 |
| `api` | `farmacia_api` | 8000 | API Fastify — sempre rodando |
| `scraper` | `farmacia_scraper` | — | Scraper Playwright — acionado pelo cron |

### O serviço `scraper`

O scraper **não fica rodando o tempo todo**. Ele usa o perfil `scraper` do Docker Compose e é acionado pelo cron da VPS:

```bash
docker compose run --rm scraper
```

Isso cria um container temporário, executa o scraper e remove o container ao terminar.

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
