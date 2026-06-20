# SISTEMA DE AUTOMAÇÃO DE ANÚNCIOS

---

## Contexto

Agência com **70 clientes** ativos em Meta Ads, operada por uma equipe de **5 gestores de tráfego pago**. O volume de criações, subidas e ajustes de campanhas é alto, tornando o processo manual um gargalo real de tempo e escala.

---

## O Problema que Queremos Resolver

- Subir uma campanha manualmente no Meta Ads consome entre 15–40 minutos por campanha
- Com 70 clientes e 5 gestores, o tempo operacional come horas que poderiam ir para análise e estratégia
- Erros humanos acontecem: budget errado, criativo no conjunto errado, data de término esquecida
- O processo não é padronizado entre os gestores

---

## A Ideia

Criar um sistema onde o gestor envia pelo **WhatsApp** (ou plataforma similar):
- As **imagens/vídeos** do criativo
- O **texto do anúncio** (copy)
- As **configurações da campanha** (orçamento, público, datas, objetivo)

E a **IA cuida de todo o resto**: interpreta o pedido, organiza os dados e **sobe a campanha direto no Meta Ads** do cliente correto — sem que o gestor precise abrir o Gerenciador de Anúncios.

---

## Como Vai Funcionar (Fluxo Detalhado)

```
[Gestor no WhatsApp]
        |
        | envia: imagem + copy + configs
        v
[Camada de Integração WhatsApp]
  (Evolution API / Z-API / Twilio)
        |
        v
[Orquestrador de Workflow]
  (n8n / Make.com)
        |
        v
[IA — Interpretação da Mensagem]
  (Claude API com visão)
  - Extrai: cliente, objetivo, orçamento, público, datas, copy, criativo
  - Valida se os dados estão completos
  - Pede confirmação ao gestor se faltar algo
        |
        v
[Confirmação pelo WhatsApp]
  Gestor aprova ou corrige antes de publicar
        |
        v
[Meta Marketing API]
  - Faz upload do criativo
  - Cria a Campanha
  - Cria o Conjunto de Anúncios (targeting, budget, datas)
  - Cria o Anúncio (copy + criativo)
  - Publica ou agenda
        |
        v
[Resposta ao Gestor no WhatsApp]
  "Campanha criada com sucesso! 🎯
   Cliente: [nome]
   ID da campanha: [id]
   Link para revisar: [link]"
```

---

## Stack Técnica Recomendada

### Visão Geral da Arquitetura

```
WhatsApp (Evolution API / Baileys)
        ↓
  Express.js  ←  recebe webhook das mensagens
        ↓
  Serviço de IA  ←  Claude API (@anthropic-ai/sdk)
        ↓
  Meta Marketing API  ←  facebook-nodejs-business-sdk
        ↓
  PostgreSQL  ←  Prisma (ORM)
```

Tudo rodando em um único servidor Node.js com Docker. Simples, barato e direto.

---

### 1. Linguagem e Runtime — Node.js
**Por que Node.js é a escolha certa aqui:**
- As principais bibliotecas de WhatsApp (Evolution API, Baileys) são nativas em JS
- O Meta Business SDK oficial tem versão Node.js
- Assíncrono por natureza — ideal para ouvir mensagens e disparar chamadas de API em paralelo
- Ecossistema enorme no npm para tudo que o projeto vai precisar

### 2. Canal de entrada — WhatsApp
**Recomendação: Evolution API**
- Open source, muito usado no Brasil, gratuito para hospedar
- Usa Baileys por baixo — biblioteca Node.js amplamente testada
- Alternativa paga mais estável: **Z-API** (~R$150/mês)
- Para 5 gestores, Evolution API em um VPS já resolve

### 3. Servidor Web
**Recomendação: Express.js**
- Recebe os webhooks do WhatsApp (mensagens recebidas)
- Expõe rotas internas para gerenciar clientes e tokens
- Leve, simples, amplamente documentado

### 4. Camada de IA
**Recomendação: Claude API**
- Pacote: `@anthropic-ai/sdk`
- Suporta visão — analisa as imagens do criativo enviadas pelo gestor
- Extrai dados estruturados de mensagens informais (orçamento, público, datas, copy)
- O prompt do sistema define o "formulário" que a IA preenche a partir da conversa

### 5. Meta Marketing API
- Pacote: `facebook-nodejs-business-sdk`
- API oficial do Meta para criação de campanhas, conjuntos e anúncios
- Cada cliente precisa de um **Access Token** com permissão na conta de anúncios dele
- O sistema armazena e usa o token correto por cliente automaticamente

### 6. Banco de Dados
**Recomendação: PostgreSQL + Prisma**
- Prisma é o ORM mais moderno e produtivo para Node.js
- Armazena: clientes, tokens Meta, histórico de campanhas, logs de erro
- Fundamental para saber qual conta Meta usar para cada cliente

### 7. Servidor / Hospedagem
- VPS simples (Hetzner, DigitalOcean, Contabo) de ~$10–20/mês sustenta tudo
- **Docker Compose** para subir Evolution API + servidor Node.js + PostgreSQL juntos
- Exemplo de `docker-compose.yml`:
```yaml
services:
  evolution-api:
    image: atendai/evolution-api
    ports: ["8080:8080"]

  app:
    build: .
    ports: ["3000:3000"]
    depends_on: [postgres, evolution-api]

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: automacao_ads
```

---

## Minha Opinião: Por Onde Começar

> O risco maior desse projeto é tentar construir tudo de uma vez. Recomendo fortemente um MVP em 3 fases:

### Fase 1 — MVP (2–3 semanas)
- Fluxo fixo: gestor manda mensagem estruturada no WhatsApp (ex: template pré-definido)
- n8n processa e chama Meta API
- Sem IA ainda — só parsing de texto estruturado
- Testar com **1 cliente real** antes de escalar

### Fase 2 — Adicionar IA (2 semanas)
- Integrar Claude API para interpretar mensagens livres
- IA extrai os dados e pede confirmação antes de publicar
- Tratar erros e casos incompletos

### Fase 3 — Escalar (contínuo)
- Onboarding de clientes (gestão de tokens Meta por cliente)
- Dashboard simples para ver campanhas criadas
- Suporte a vídeos, carrosséis, múltiplos formatos

---

## Pontos de Atenção Críticos

| Ponto | Detalhe |
|-------|---------|
| **Tokens Meta por cliente** | Cada cliente precisa autorizar o acesso. Use o fluxo OAuth do Meta para coletar e armazenar tokens com segurança |
| **Expiração de tokens** | Tokens do Meta expiram. Implemente renovação automática ou alertas |
| **Validação antes de publicar** | Sempre pedir confirmação do gestor antes de criar a campanha. Um erro de budget publicado pode queimar dinheiro do cliente |
| **Formatos de criativo** | Meta tem restrições de tamanho, proporção e texto na imagem. A IA deve validar isso antes de enviar |
| **Rate limits** | Meta Marketing API tem limites por hora. Com 70 clientes, monitorar para não ser bloqueado |
| **Logs de auditoria** | Registrar tudo: quem pediu, o que foi criado, quando. Importante para resolver disputas |

---

## Exemplo de Conversa no WhatsApp

```
Gestor:
  [envia imagem do criativo]
  "Cliente: Loja da Maria
   Objetivo: Conversões
   Orçamento: R$50/dia
   Público: mulheres 25-45, SP capital
   Copy: 'Coleção nova chegou! Aproveite o frete grátis hoje. 👗'
   Período: 18/06 a 30/06"

Sistema (IA):
  "✅ Entendido! Vou criar a campanha com os seguintes dados:
   - Cliente: Loja da Maria
   - Objetivo: Conversões
   - Budget diário: R$ 50,00
   - Público: Mulheres, 25–45 anos, São Paulo capital
   - Datas: 18/06/2026 – 30/06/2026
   - Criativo: imagem enviada

   Confirma para publicar? Responda SIM ou faça correções."

Gestor:
  "SIM"

Sistema:
  "🎯 Campanha criada com sucesso!
   ID: 120210XXXXXXX
   Conta: Loja da Maria Ads
   Status: Ativa
   Ver no Meta: [link direto]"
```

---

## Próximos Passos Sugeridos

- [ ] Definir qual ferramenta de WhatsApp usar (Evolution API ou Z-API)
- [ ] Criar conta de desenvolvedor no Meta e gerar App para usar a Marketing API
- [ ] Montar o template de mensagem padrão para o MVP
- [ ] Escolher onde hospedar (VPS recomendado)
- [ ] Testar o fluxo com uma conta de anúncios de teste antes de usar clientes reais
