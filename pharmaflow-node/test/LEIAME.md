# Processo de testes — PharmaFlow

## O que testamos e por quê

A escolha não foi teórica: olhamos o que **de fato quebrou** durante o
desenvolvimento. Os defeitos reais moraram na fronteira **API / banco /
configuração** — não na interação com a tela. Por isso o investimento está em
**testes funcionais de API**, que exercitam rota, autenticação, regra e banco
de verdade.

A regra mais cara de quebrar deste sistema é o **isolamento multi-tenant**: a
agência tem vários gestores, cada um com 16–20 farmácias clientes. Se vazar, um
gestor enxerga (ou dispara para) o cliente de outro. Essa é a razão principal
desta suíte existir.

**O que estes testes NÃO cobrem** (e é intencional):
- **Requisitos errados.** Nenhum teste pega "modelei por farmácia quando era por
  gestor". Isso só conversa resolve.
- **Configuração de ambiente.** `EVOLUTION_API_URL` com valor de exemplo passa
  em qualquer teste e quebra em produção.
- **A conexão real do WhatsApp.** Ler QR code é manual por natureza. A Evolution
  é sempre simulada — **nenhuma mensagem real sai durante os testes**.

## Como rodar

```bash
npm test          # roda a suíte uma vez
npm run test:watch # re-roda ao salvar
```

Pré-requisito: o container `farmacia_db` no ar (é onde o banco de teste é criado).

## Como funciona

- **Banco isolado.** Um banco separado, `farmacia_monitor_test`, **recriado do
  zero a cada execução** (`test/prepararBanco.ts`). O banco de desenvolvimento
  nunca é tocado.
- **Schema.** Vem de `test/schema.sql`, um dump do schema real.
- **Sem socket.** Os testes usam `app.inject()` do Fastify: passam pelo
  roteamento, pelos `preHandler` de autenticação e pelos handlers reais, sem
  abrir porta. Por isso `src/api/index.ts` só chama `listen()` quando é o ponto
  de entrada (`require.main === module`).
- **Tokens.** Assinados com o mesmo segredo e formato do `/api/auth/login`.

### Quando o schema mudar

Depois de criar uma migration, regenere o dump — senão a suíte roda contra um
schema velho e acusa erro onde não há:

```bash
docker exec farmacia_db pg_dump -U farmacia -d farmacia_monitor \
  --schema-only --no-owner --no-privileges > test/schema.sql
```

## Escrevendo um teste novo

Use os helpers de `test/helpers.ts` — eles criam dados únicos por teste, o que
evita colisão em colunas `UNIQUE`:

```ts
const gestor   = await criarGestor();
const farmacia = await criarFarmacia(gestor.id);
const r = await api('GET', '/api/ofertas/carteira', { token: gestor.token });
```

Chame `limparBanco()` no `beforeEach`. Para simular a Evolution, use
`simularEvolution()` de `test/disparos.test.ts` — ela responde conforme o
endpoint, inclusive o `connectionState`, que a API confere antes de todo disparo.

**Todo recurso novo com dono deve ganhar um teste de vazamento**: crie dois
gestores e prove que um não alcança o dado do outro.

## Verifique que o teste tem dentes

Um teste que nunca falha não protege nada. Ao escrever um teste de regra,
**quebre a regra de propósito** e confirme que ele acusa. Foi assim que
validamos a suíte: removendo a guarda de isolamento do link público, só o teste
"BLOQUEIA enviar para farmácia de outro gestor" falhou — os outros 14 seguiram
verdes, provando que ele mira exatamente aquilo.

## O que ainda falta

- **E2E da página pública de ofertas** (`/ofertas/:token`). É a tela que o dono
  da farmácia usa no celular, sem login — se quebrar, **ninguém da agência
  percebe**, porque nenhum gestor abre aquela tela. É o próximo teste a existir,
  e o único que justifica um navegador de verdade.
- **Testes do frontend.** Hoje o FrontEND não tem nenhuma ferramenta de teste.
