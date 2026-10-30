# Disparo em Grupos — do pedido do cliente ao envio

Documento de requisitos do módulo que publica as ofertas da farmácia nos grupos de WhatsApp.
Escrito a partir do código (`src/disparos/*`, `FrontEND/src/routes/grupos.tsx`) e das observações
de produção já registradas.

- **Rota do gestor:** `/grupos` (abas *Novo disparo*, *Ofertas dos clientes*, *Histórico*)
- **Backend:** `src/disparos/{routes,service,repository}.ts` + `src/scheduler.ts`
- **Motor de envio:** repo `campanhas`, rodando em `/opt/campanhas` na VPS (**fora deste repositório**)
TESTE teste
---

## Índice

1. [Objetivo e escopo](#1-objetivo-e-escopo)
2. [Atores](#2-atores)
3. [Vocabulário](#3-vocabulário)
4. [Fluxo ponta a ponta](#4-fluxo-ponta-a-ponta)
5. [Volumetria — quantos produtos por hora](#5-volumetria--quantos-produtos-por-hora)
6. [Regras de negócio](#6-regras-de-negócio)
7. [Limites técnicos](#7-limites-técnicos)
8. [Exceções e recuperação](#8-exceções-e-recuperação)
9. [Riscos e pendências](#9-riscos-e-pendências)
10. [Como auditar em produção](#10-como-auditar-em-produção)
11. [Rastreabilidade](#11-rastreabilidade)

---

## 1. Objetivo e escopo

A agência posta as ofertas do cliente nos grupos de WhatsApp dele sem ninguém abrir o WhatsApp:
o gestor monta a arte, escolhe grupos e horários, e o sistema publica nos dias/horas marcados até
a campanha se encerrar.

**No escopo:** pedido de ofertas pelo dono da farmácia (link público), montagem do criativo, escolha
de grupos e conexão, agendamento com repetição, distribuição dos produtos ao longo dos envios,
execução via Evolution API e histórico por grupo.

**Fora do escopo:** anúncios pagos no Meta (módulo Campanhas), confirmação de reuniões por WhatsApp
(outro fluxo, tabela `whatsapp_config`) e conversa com o cliente final — o disparo publica, não responde.

---

## 2. Atores

| Ator | Papel | Decide |
|---|---|---|
| Dono da farmácia | Abre o link público (sem login) e marca no catálogo o que quer anunciar, com preço | Quais produtos e por quanto |
| Gestor da agência | Monta o criativo, escolhe grupos/conexão/horários e confirma | Arte, grupos, quando, com que frequência |
| Administrador | Cadastra e conecta os números da agência na tela Conexões | Quais números existem para disparar |
| Agendador (`src/scheduler.ts`) | Varre a cada 60 s os disparos vencidos, executa e recalcula o próximo envio | Nada — só cumpre o agendado |
| Motor de envio (`/opt/campanhas`) | Recebe o disparo pronto, enfileira (BullMQ) e entrega pela Evolution; devolve status por grupo no callback | O ritmo da entrega |

> **Multi-tenancy:** a conexão é **por gestor**, não por farmácia (`gestor_whatsapp`, instância
> `gestor_<id>`). Com 50+ farmácias, uma instância Evolution por farmácia seria inviável. Os grupos
> de todos os clientes daquele gestor vivem na conta dele.

---

## 3. Vocabulário

| Termo | O que é |
|---|---|
| **Disparo** | A campanha criada pelo gestor (linha em `disparos_grupo`): uma farmácia, uma lista de grupos, uma lista de criativos, um agendamento |
| **Postagem** | Uma execução do disparo, num horário marcado. É a unidade que chega no grupo |
| **Lote** | Os produtos que saem naquela postagem — no máximo 3 |
| **Criativo** | A arte de um produto (imagem + legenda com nome e preço), ou uma arte pronta enviada pelo gestor |
| **Conexão / instância** | O número que publica: a do gestor (`gestor_whatsapp`) ou uma da agência (`whatsapp_config`) |
| **Rodízio** | A regra que distribui a lista de produtos ao longo das postagens em vez de repetir tudo em cada uma |
| **Cursor** | `disparos_grupo.cursor_midia` — onde a lista parou; a próxima postagem continua daí |

---

## 4. Fluxo ponta a ponta

As etapas 1 a 5 são trabalho humano na tela; 6 e 7 o sistema faz sozinho.

### Etapa 1 — Pedido de ofertas (dono da farmácia)

O gestor manda um link com token, **um por cliente** (`links_oferta`, com `farmacia_id`). O dono abre
`/ofertas/:token` sem login, marca produtos do catálogo, digita o preço de cada um e pode acrescentar
itens livres (sem foto no banco de imagens).

- Rotas públicas: `/api/publico/ofertas/*` — o token é a credencial; a farmácia sai do token, não do corpo
- Saída: `solicitacoes_oferta.produtos_json = [{ id, nome, preco }]`
- O preço é sanitizado por `limparPreco` (`ofertas/service.ts`) porque vai direto para dentro da arte

### Etapa 2 — Passo 1: farmácia

Lista todas as farmácias (`getFarmacias()`), com busca. A escolha define o nome que sai no criativo e
na mensagem (sempre via `nomeVisivel` → nome de fachada, caindo na razão social) e é a chave da trava
da etapa 6.

### Etapa 3 — Passo 2: conexão e grupos

Primeiro o número que vai publicar (`GET /api/disparos/conexoes` — a do gestor + as da agência;
desconectada aparece desabilitada). Depois os grupos daquele número
(`GET /api/disparos/grupos?instance=`), servidos do cache `grupos_cache` (TTL 15 min,
stale-while-revalidate; `?refresh=1` força e espera).

**O sistema não marca grupo nenhum sozinho** — ver [RN-07](#6-regras-de-negócio). Existe o filtro
"só os desta farmácia" e o selo "nome parecido" (`lib/nomeGrupo.ts`), mas quem marca é o gestor.

Saída: `grupos_json = [{ jid, nome }]`. **O envio usa o `jid`**; o nome vai junto só para o histórico.

### Etapa 4 — Passo 3: criativos

Três modelos (Padrão, Abre Mês, Fecha Mês) mais o card **Novo**, para subir arte que já veio pronta de
fora — este pula produto/preço/prévia, não é gravado em lugar nenhum e vai **sem rótulo**.

Nos modelos, o gestor escolhe as fotos do banco de imagens (`listarCatalogoProdutos`), já filtrado pelo
que o cliente pediu (`GET /api/ofertas/ultima-escolha/:farmaciaId`) e com os preços dele preenchidos.

Ao confirmar, cada peça é rasterizada e comprimida no navegador
(`exportarCriativoPng` + `comprimirParaEnvio`), com orçamento **por envio** dividido pelo número de
peças (`orcamentoPorCriativo`). Saída: `midias_json = [{ b64, mime, rotulo }]`.

### Etapa 5 — Passo 4: agendamento

Modal com: "Essa campanha vai se repetir?" (não = envio único; sim = `FREQUENCIA = "diario"`), chips de
horários pré-definidos (`horarios_disparo`, semeados com `08:00 09:00 12:00 15:00 18:00`), "Começa em",
"Termina em" (`repetir_ate`, ou *até eu cancelar*), o toggle "Repetir os produtos" e a conexão.

Antes de confirmar, o modal **lista o nome de cada grupo** — ver [RN-14](#6-regras-de-negócio).

### Etapa 6 — `POST /api/disparos`: validar e travar

Recusas do servidor:

| Situação | Resposta |
|---|---|
| Sem mensagem e sem criativo | `400` |
| Nenhum grupo | `400` |
| `agendado_para` em sábado/domingo (no fuso do disparo), **sem** `permitir_fim_de_semana: true` | `400` |
| `repetir_produtos` sem `repetir_ate` | `400` |
| Conexão que não é do gestor nem global | `403` |
| Sem `instance` e conexão do gestor desconectada | `409` |
| Grupo com histórico de **outra** farmácia | `409` + `grupos_de_outro_cliente` |

O `409` de grupo alheio é liberado com `confirmar_grupo_de_outro_cliente: true` (checkbox obrigatório
no modal). A consulta é `donosDeGrupos(gestorId, jids)`.

### Etapa 7 — Execução

`scheduler.ts` roda `verificarDisparosAgendados()` a cada 60 s → `disparosService.executarDisparo(id)`:

```
loteDaVez(disparo, midias)          → 3 produtos (ou a lista inteira, no envio único)
montarEnvio(mensagem, lote)         → a mensagem vira LEGENDA de cada imagem
  ├── CAMPAIGNS_API_URL preenchida  → POST /disparo no motor (assíncrono)
  │     └── callback POST /api/disparos/callback → finalizarDisparo() grava o log por grupo
  └── vazia (fallback)              → envio direto pela Evolution, 1,5 s entre mensagens
grava cursor_midia, ultimo_envio e proximo_envio (ou encerra)
```

> **Em produção não há fallback:** com `CAMPAIGNS_API_URL` preenchida (e está), motor fora do ar =
> disparo vira `erro`, não cai no envio direto.

---

## 5. Volumetria — quantos produtos por hora

O sistema **não tem** parâmetro "produtos por hora". Tem lote por postagem e lista de horários:

```
produtos por hora, por grupo = PRODUTOS_POR_ENVIO × (horários marcados naquela hora)
mensagens por hora           = produtos por hora × nº de grupos
duração de uma postagem      = nº de grupos × produtos do lote × intervalo entre mensagens
```

`PRODUTOS_POR_ENVIO = 3`, fixo e **sem campo na tela** — regra do sistema, não configuração por
campanha (decisão do dono, 09/09/2026). Definido em **dois** lugares que precisam mudar juntos:
`src/disparos/service.ts` e `FrontEND/src/lib/rodizio.ts`.

**Resposta curta: 3 produtos por grupo por hora**, quando há um horário marcado dentro daquela hora.
Cada produto é uma mensagem de imagem com legenda.

### Cenários (8 grupos selecionados)

| Cenário | Produtos/postagem | Postagens/hora | Produtos/hora por grupo | Mensagens/hora |
|---|---:|---:|---:|---:|
| Campanha repetida, 1 horário naquela hora | 3 | 1 | 3 | 24 |
| Campanha repetida, 2 horários na mesma hora (09:00 e 09:30) | 3 | 2 | 6 | 48 |
| Envio único com lista de 20 produtos | 20 | 1 | 20 (de uma vez) | 160 |
| Duas campanhas do mesmo número no mesmo horário | 3 + 3 | 2 | 6 | 48 |

### Por dia e por campanha

- Com os 5 horários padrão: **15 produtos por grupo por dia**; **zero** sábado e domingo
- Lista de 42 produtos = 14 postagens ≈ 3 dias, e a campanha **encerra quando a lista acaba**
- O último lote sai **curto** de propósito (20 de 3 em 3 → última postagem com 2), para não repetir
  arte do começo da lista na mesma postagem

### O que NÃO existe

- **Teto diário por número.** Dez campanhas no mesmo horário simplesmente somam o volume
- **Pacing variável.** O intervalo é fixo, que é assinatura de robô (ver [pendências](#9-riscos-e-pendências))
- **Envio único não respeita o lote** — é a única combinação que ainda despeja a lista inteira

### Limite deste documento

O **intervalo entre mensagens** não é verificável aqui. `DELAY_ENTRE_GRUPOS_MS`
(`DISPARO_DELAY_MS`, padrão 1500 ms) só vale no **fallback**; em produção quem entrega é o motor em
`/opt/campanhas`, com a fila e o ritmo dele. Mudar essa env no PharmaFlow não muda nada em produção.

O teto técnico de **2.400 mensagens/hora** (3600 / 1,5 s) é, portanto, do fallback. Para o ritmo real,
a fonte é o horário das linhas de `disparos_grupo_log`, não este código.

### O que os gestores realmente fazem (medido em produção, 10/09/2026)

A prática é **drip manual: 1 produto por disparo**, criado à mão, várias vezes ao dia — não campanha
repetida. Por `repetir`: **176 `nunca`**, 33 `semanal`, 1 `diario`; os disparos recentes têm 1–2
produtos. Há casos de 30 disparos para 31 produtos do mesmo cliente numa semana.

Consequência a considerar antes de tratar 3 por postagem como número seguro: com 4 horários/dia, 3 por
postagem = 12 produtos/dia, o **triplo** do que o gestor já pratica na mão (~4/dia).

---

## 6. Regras de negócio

| # | Regra | Por que existe |
|---|---|---|
| RN-01 | 3 produtos por postagem em campanha repetida, sem campo na tela | Regra do sistema; mexer afeta todas as campanhas a partir do próximo envio |
| RN-02 | Ordem sequencial da lista, nunca sorteada | Sorteio repetiria produto, deixaria outro sem sair e não daria para auditar |
| RN-03 | Envio único (`repetir = 'nunca'`) manda a lista inteira | Só há uma ocorrência; fatiar deixaria a maior parte sem sair nunca |
| RN-04 | A campanha termina quando a lista acaba **ou** na data de término — o que vier primeiro | Decisão literal do dono: "a lista acabou, acabou" |
| RN-05 | Com "repetir os produtos" ligado, `repetir_ate` é obrigatória | Nesse modo a lista dá a volta; sem a data a campanha não pararia nunca |
| RN-06 | Por padrão, nada sai em sábado nem domingo — **a menos que o gestor libere ao criar a campanha** | Vale para o 1º envio (400 na criação) e para as repetições (empurradas para o próximo dia útil). Envio único no fim de semana **não** é adiado: encerra. O botão "Permitir disparos no fim de semana" (coluna `disparos_grupo.permitir_fim_de_semana`, migration 0044, padrão `false`) desliga a trava **só daquela campanha**; as já existentes continuam bloqueadas e não dá para liberar uma campanha depois de criada |
| RN-07 | O sistema nunca marca grupo sozinho | A pré-marcação por nome causou dois incidentes de oferta no grupo errado (21/08 e 29/08). Filtrar o que aparece é permitido; marcar, não |
| RN-08 | Grupo com histórico de outra farmácia é bloqueado, salvo confirmação explícita | Trava por **histórico** no servidor: pega erro humano e bug de tela. Medida contra os disparos reais, bloquearia só os contaminados |
| RN-09 | O gestor só dispara por conexões dele ou da agência | Senão puxaria grupos e postaria pela conta de outro gestor |
| RN-10 | Havendo criativo, a mensagem vira legenda de **cada** imagem | Cada foto é encaminhada e lida sozinha no WhatsApp; sem legenda repetida, a 2ª oferta chega sem dizer de que farmácia é |
| RN-11 | O que sai para fora usa o nome de fachada | O cliente final não pode ver razão social dentro da arte |
| RN-12 | Disparo preso em `enviando` > 30 min vira `erro` | Aparece no Histórico em vez de sumir. **Não há reenvio automático**: parte das mensagens pode ter saído |
| RN-13 | Um grupo conta como enviado se ao menos uma peça chegou | Falha parcial fica registrada no log daquele grupo, com o motivo |
| RN-14 | O que é irreversível se confirma por **nome**, não por contagem | Confirmação por número escondeu o incidente de 21/08; e 7 campanhas foram canceladas em 12 s por cliques em rajada (14/09) |

---

## 7. Limites técnicos

| Limite | Valor | Efeito prático |
|---|---:|---|
| Corpo do `POST` (imagens em base64) | **~4,2 MB** | Teto do proxy edge da Vercel — o `bodyLimit: 80 MB` do Fastify não vale nada, o pedido morre antes. Aguenta ~90 criativos com a compressão adaptativa |
| Tamanho de cada imagem na entrega | **800 KB** | `client_max_body_size` do nginx na frente da Evolution: acima disso o texto vai e a imagem não (413) |
| Piso de qualidade por criativo | 40 KB | Abaixo disso a peça fica ilegível |
| Cache de grupos | 15 min | Lista abre na hora; grupo novo aparece no próximo refresh ou no botão "Atualizar" |
| Ciclo do agendador | 60 s | Postagem marcada para 09:00 começa entre 09:00 e 09:01 |
| Timeout da Evolution | 30 s / 120 s | 120 s no `fetchAllGroups`, 30 s no resto |
| Disparo travado | 30 min | Vira `erro` em vez de ficar `enviando` para sempre |

---

## 8. Exceções e recuperação

| Cenário | O que o sistema faz |
|---|---|
| Evolution não responde | `evolutionReq` estoura no timeout e o disparo vira `erro`; a tela de conexões mostra o último status conhecido em vez de quebrar |
| Motor de campanhas fora do ar | `POST /disparo` falha → disparo vira `erro` (sem fallback, ver etapa 7) |
| Callback perdido | O disparo fica `enviando`; após 30 min `verificarDisparosTravados()` marca `erro` |
| API fora do ar no horário marcado | O disparo sai quando a API volta (já saiu com horas de atraso). `calcularProximoEnvio` avança até o futuro, mas o vencido é executado |
| Falha em parte das peças | O grupo conta como enviado, com `erro: "parcial — …"` no log |
| Imagem recusada (413) | Texto chega, arte não; visível no log do grupo |

---

## 9. Riscos e pendências

| Assunto | Situação | Estado |
|---|---|---|
| 3 produtos por postagem é o número certo? | Os gestores praticam ~1. Manter 3 triplica o volume diário no grupo — oposto do objetivo antiban. Levantado com o dono, **sem resposta** | decisão aberta |
| Teto diário por número | Não existe | não implementado |
| Pacing humano (intervalo variável + pausa a cada N grupos) | Mora no motor, em `/opt/campanhas` | fora deste repo |
| Número bloqueado continua agendado | Sem detecção de ban que pause os disparos daquela instância; seguem acumulando erro | não implementado |
| Trava de grupo alheio no fluxo "Montar" | O `EnviarGrupoWizard` não manda `confirmar_grupo_de_outro_cliente`; o 409 vira erro sem saída | pendente |
| Postagem atrasada após queda | Tolerância de atraso (pular ou marcar como perdido) foi oferecida e não foi decidida | decisão aberta |
| Rastreabilidade de quem operou | O sistema registra a **conta**, não a pessoa; login compartilhado torna "não fui eu" não verificável | risco aceito |

---

## 10. Como auditar em produção

Duas armadilhas conhecidas:

1. **`disparos_grupo.ultimo_envio` guarda só o último envio.** Num disparo com `horarios_json`
   (08/12/18) ele mostra 18:01 para algo "agendado 08:00" e *parece* 10 h de atraso. A verdade por
   envio está em `disparos_grupo_log` — uma linha por grupo por envio.
2. **Os logs dos containers não contêm JID de grupo.** `grep` por `120363…@g.us` dá 0 ocorrências
   mesmo quando o grupo recebeu. Para "o grupo X recebeu?", a fonte é o banco; os logs servem para
   cruzar por **id de disparo**.

```sql
-- atraso real por disparo
SELECT d.id, min(l.enviado_em) - d.agendado_para AS atraso
FROM disparos_grupo d JOIN disparos_grupo_log l ON l.disparo_id = d.id
GROUP BY d.id, d.agendado_para;

-- cancelamento em rajada (a hora do cancelamento é atualizado_em, não criado_em)
SELECT id, atualizado_em,
       atualizado_em - lag(atualizado_em) OVER (ORDER BY atualizado_em) AS intervalo
FROM disparos_grupo WHERE status = 'cancelado' ORDER BY atualizado_em;
```

---

## 11. Rastreabilidade

| Regra / comportamento | Onde vive |
|---|---|
| Lote de 3 produtos | `PRODUTOS_POR_ENVIO` em `src/disparos/service.ts` **e** `FrontEND/src/lib/rodizio.ts` |
| Rodízio e fim da lista | `fatiarRodizio`, `loteDaVez`, `listaAcabou` (`src/disparos/service.ts`) |
| Mensagem como legenda | `montarEnvio` (`src/disparos/service.ts`) |
| Próximo envio, horários fixos, fim de semana | `calcularProximoEnvio`, `ehFimDeSemana` (`src/disparos/agendamento.ts`); trava na criação em `DisparoService.criar`; `FrontEND/src/lib/diaUtil.ts`. A liberação por campanha é `permitirFimDeSemana` (migration 0044) |
| Intervalo entre mensagens (fallback) | `DELAY_ENTRE_GRUPOS_MS` / env `DISPARO_DELAY_MS` |
| Ciclo de 60 s e disparo travado | `src/scheduler.ts` (`INTERVALO_MS`, `LIMITE_ENVIANDO_MS`) |
| Dispatcher motor × fallback | `executarDisparo` / `executarDisparoDireto`; `src/disparos/campaignsClient.ts` |
| Trava de grupo de outro cliente | `POST /api/disparos` em `src/disparos/routes.ts` + `donosDeGrupos` no repository |
| Cache de grupos | `sincronizarGrupos`, `TTL_GRUPOS_MS`; tabelas `grupos_cache` / `grupos_cache_sync` |
| Orçamento de tamanho da arte | `orcamentoPorCriativo`, `comprimirParaEnvio` (`FrontEND/src/lib/exportarCriativo.ts`) |
| Casamento grupo × farmácia (só visual) | `FrontEND/src/lib/nomeGrupo.ts` |
| Nome visível do cliente | `nomeVisivel` em `src/database/schema.ts` e `FrontEND/src/lib/api.ts` |

---

*v1.0 — 16/09/2026. Mantenha este documento junto das mudanças em `src/disparos/`: lote, horários,
condições de término e limites de tamanho são exatamente o que o dono e os gestores perguntam.*
