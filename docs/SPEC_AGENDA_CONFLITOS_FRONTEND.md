# SPEC TÉCNICO — Controle de Conflitos e Bloqueio de Agenda
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-27
**Status:** Pronto para implementação

---

## 1. Problema que esta feature resolve

| Problema | Solução |
|----------|---------|
| Dois gestores marcam reunião no mesmo horário | API retorna 409 + o frontend mostra o conflito antes de salvar |
| Dono não pode naquele dia | Dono bloqueia o dia → ninguém consegue agendar |
| Gestor não sabe quais horários estão livres | Grade de disponibilidade no modal de agendamento |
| Dono não enxerga a agenda do mês | Visão de calendário mensal com ocupações e bloqueios |

---

## 2. O que muda no Modal de Agendamento (já existente)

### 2.1 Verificação em tempo real ao selecionar data/hora

Quando o gestor escolhe data + hora no formulário, o frontend faz uma chamada silenciosa:

```
GET /api/agenda/verificar?data=2026-06-05T14:00:00Z&duracao=60
```

**Se horário está livre → nada muda (UX limpa)**

**Se há conflito → alerta imediato abaixo do campo de hora:**

```
╔══════════════════════════════════════════════════════╗
║  📅  Agendar Reunião                             [✕] ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Data *          Hora *                              ║
║  ┌────────────┐  ┌──────────────────────────────┐    ║
║  │ 05/06/2026 │  │ 14:00               ⚠️       │    ║
║  └────────────┘  └──────────────────────────────┘    ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │  ⚠️  Horário indisponível                    │    ║
║  │  Conflito com "Revisão de metas" às 14:00   │    ║
║  │  Sugestão: 15:00, 15:30 ou 16:00            │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  [Ver grade de horários livres]                      ║
╚══════════════════════════════════════════════════════╝
```

**Se dia está bloqueado pelo dono:**
```
║  ┌──────────────────────────────────────────────┐    ║
║  │  🔒  Agenda fechada neste dia                │    ║
║  │  Motivo: Viagem para São Paulo               │    ║
║  │  Escolha outra data.                         │    ║
║  └──────────────────────────────────────────────┘    ║
```

### 2.2 Grade de horários livres (drawer)

Botão "Ver grade de horários livres" abre um painel lateral:

```
╔═══════════════════════════════════╗
║  📅 Quinta, 05 de Junho        [✕]║
╠═══════════════════════════════════╣
║                                   ║
║  08:00  ✅ Livre                  ║
║  08:30  ✅ Livre                  ║
║  09:00  ✅ Livre                  ║
║  09:30  ✅ Livre                  ║
║  10:00  🔴 Ocupado — Alinhamento  ║
║  10:30  🔴 Ocupado — Alinhamento  ║
║  11:00  ✅ Livre                  ║
║  11:30  ✅ Livre                  ║
║  12:00  ✅ Livre                  ║
║  12:30  ✅ Livre                  ║
║  13:00  ✅ Livre                  ║
║  13:30  ✅ Livre                  ║
║  14:00  🔴 Ocupado — Teste Daniel ║
║  14:30  🔴 Ocupado — Teste Daniel ║
║  15:00  ✅ Livre   ← clicar usa   ║
║  15:30  ✅ Livre                  ║
║  ...                              ║
╚═══════════════════════════════════╝
```

**Clicar em um slot livre** → preenche o campo de hora no formulário automaticamente.

---

## 3. Nova Aba "Agenda" na página de Reuniões

Adicionar uma quarta aba ao lado de Dashboard / Reuniões / Clientes:

```
[Dashboard]  [Reuniões]  [Clientes]  [📅 Agenda]
```

### 3.1 Visualização Mensal

```
╔══════════════════════════════════════════════════════════════════════╗
║  📅 Agenda — Junho 2026              [◀ Mai]  [Jun ▼]  [Jul ▶]     ║
╠══════════════════════════════════════════════════════════════════════╣
║  Seg    Ter    Qua    Qui    Sex    Sáb    Dom                       ║
║                                                                      ║
║   1      2      3      4      5 🔴   6      7                       ║
║                               2 reun                                 ║
║                                                                      ║
║   8      9     10     11     12 🔒  13     14                       ║
║                               Bloq.                                  ║
║                                                                      ║
║  15     16     17     18     19     20     21                        ║
║   1 reun                                                             ║
╚══════════════════════════════════════════════════════════════════════╝
```

**Legenda:**
- 🟢 Dia com reunião(ões)
- 🔒 Dia bloqueado pelo dono
- Branco = livre

**Clicar em um dia** → abre painel lateral com detalhe do dia (reuniões + bloqueios).

### 3.2 Painel de Bloqueios (somente Admin/Dono)

```
╔══════════════════════════════════════════════════════╗
║  🔒 Fechar Agenda                                    ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  ┌─────────────────────────────────────────────┐     ║
║  │  [🔒 Fechar dia inteiro]  [⏰ Fechar horário]│     ║
║  └─────────────────────────────────────────────┘     ║
║                                                      ║
║  Data *                                              ║
║  ┌──────────────────────────────────────────┐        ║
║  │  05/06/2026                              │        ║
║  └──────────────────────────────────────────┘        ║
║                                                      ║
║  (se horário parcial):                               ║
║  ┌────────────┐  ┌────────────┐                      ║
║  │ Das: 14:00 │  │ Até: 17:00 │                      ║
║  └────────────┘  └────────────┘                      ║
║                                                      ║
║  Motivo (opcional)                                   ║
║  ┌──────────────────────────────────────────┐        ║
║  │  Viagem para São Paulo                   │        ║
║  └──────────────────────────────────────────┘        ║
║                                                      ║
║             [Cancelar]   [🔒 Fechar Agenda]          ║
╚══════════════════════════════════════════════════════╝
```

### 3.3 Lista de Bloqueios Ativos

```
╔══════════════════════════════════════════════════════╗
║  Bloqueios de Agenda                                  ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  🔒  05/Jun  — Dia inteiro                     │  ║
║  │  Viagem para São Paulo          [🗑 Remover]   │  ║
║  └────────────────────────────────────────────────┘  ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  🔒  12/Jun  — 14:00 às 17:00                 │  ║
║  │  Dentista                       [🗑 Remover]   │  ║
║  └────────────────────────────────────────────────┘  ║
║                                                      ║
║  [+ Adicionar Bloqueio]                              ║
╚══════════════════════════════════════════════════════╝
```

---

## 4. Endpoints da API

### 4.1 Verificação rápida (chamada ao selecionar hora)

```
GET /api/agenda/verificar?data=2026-06-05T14:00:00Z&duracao=60
GET /api/agenda/verificar?data=...&duracao=60&reuniao_id=5   ← ao editar, ignora a própria reunião
```

**Resposta — livre:**
```json
{ "conflito": false }
```

**Resposta — conflito de horário:**
```json
{
  "conflito": true,
  "tipo": "sobreposicao",
  "detalhe": "Conflito com \"Revisão de metas\" às 14:00",
  "reuniao_conflitante": {
    "id": 3,
    "titulo": "Revisão de metas",
    "data_reuniao": "2026-06-05T14:00:00Z",
    "duracao_minutos": 60
  }
}
```

**Resposta — dia bloqueado:**
```json
{
  "conflito": true,
  "tipo": "bloqueio",
  "detalhe": "Agenda fechada: Viagem para São Paulo"
}
```

---

### 4.2 Disponibilidade do dia (grade de slots)

```
GET /api/agenda/disponibilidade?data=2026-06-05
GET /api/agenda/disponibilidade?data=2026-06-05&hora=14:00&duracao=60
```

**Resposta:**
```json
{
  "data": "2026-06-05",
  "disponivel": true,
  "conflito": { "conflito": false },
  "dia_bloqueado": false,
  "reunioes_dia": [
    { "id": 3, "titulo": "Revisão de metas", "data_reuniao": "2026-06-05T14:00:00Z", "duracao_minutos": 60, "status": "confirmada", "farmacia_nome": "São Rafael" }
  ],
  "bloqueios": [],
  "slots": [
    { "hora": "08:00", "disponivel": true  },
    { "hora": "08:30", "disponivel": true  },
    { "hora": "09:00", "disponivel": true  },
    { "hora": "14:00", "disponivel": false },
    { "hora": "14:30", "disponivel": false },
    { "hora": "15:00", "disponivel": true  }
  ]
}
```

---

### 4.3 Calendário mensal

```
GET /api/agenda/calendario?mes=2026-06
```

**Resposta:**
```json
{
  "mes": "2026-06",
  "dias": [
    { "data": "2026-06-01", "reunioes": { "total": 0, "realizadas": 0, "confirmadas": 0, "agendadas": 0 }, "bloqueado": false, "bloqueio": null },
    { "data": "2026-06-05", "reunioes": { "total": 2, "realizadas": 0, "confirmadas": 1, "agendadas": 1 }, "bloqueado": false, "bloqueio": null },
    { "data": "2026-06-12", "reunioes": { "total": 0, "realizadas": 0, "confirmadas": 0, "agendadas": 0 }, "bloqueado": true,  "bloqueio": { "motivo": "Dentista", "hora_inicio": "14:00", "hora_fim": "17:00" } }
  ]
}
```

---

### 4.4 Criar bloqueio (somente admin)

```
POST /api/agenda/bloqueios
Content-Type: application/json
```

**Fechar dia inteiro:**
```json
{
  "data": "2026-06-12",
  "dia_inteiro": true,
  "motivo": "Viagem para São Paulo"
}
```

**Fechar horário específico:**
```json
{
  "data": "2026-06-05",
  "dia_inteiro": false,
  "hora_inicio": "14:00",
  "hora_fim": "17:00",
  "motivo": "Dentista"
}
```

**Resposta (201):**
```json
{
  "id": 1,
  "data": "2026-06-12",
  "dia_inteiro": true,
  "motivo": "Viagem para São Paulo",
  "mensagem": "Dia 2026-06-12 bloqueado."
}
```

---

### 4.5 Listar bloqueios

```
GET /api/agenda/bloqueios
GET /api/agenda/bloqueios?mes=2026-06
```

---

### 4.6 Remover bloqueio (somente admin)

```
DELETE /api/agenda/bloqueios/:id
```

---

### 4.7 Como o POST /api/reunioes responde agora com conflito

```
POST /api/reunioes  →  409 Conflict
```

```json
{
  "detail": "Conflito com \"Revisão de metas\" às 14:00",
  "tipo_conflito": "sobreposicao",
  "reuniao_conflitante": {
    "id": 3,
    "titulo": "Revisão de metas",
    "data_reuniao": "2026-06-05T14:00:00Z",
    "duracao_minutos": 60
  }
}
```

---

## 5. Lógica do Frontend no Modal

```tsx
// Hook de verificação de conflito
function useVerificarConflito(data: string, hora: string, duracao: number, reuniaoId?: number) {
  const [resultado, setResultado] = useState<ResultadoConflito | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    if (!data || !hora) { setResultado(null); return; }

    const dt = `${data}T${hora}:00Z`;
    setVerificando(true);

    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ data: dt, duracao: String(duracao) });
        if (reuniaoId) params.set('reuniao_id', String(reuniaoId));

        const res = await fetch(`/api/agenda/verificar?${params}`, { headers });
        const json = await res.json();
        setResultado(json);
      } catch {
        setResultado(null);
      } finally {
        setVerificando(false);
      }
    }, 500); // debounce 500ms

    return () => clearTimeout(timeout);
  }, [data, hora, duracao, reuniaoId]);

  return { resultado, verificando };
}
```

```tsx
// No modal de agendamento
const { resultado, verificando } = useVerificarConflito(dataForm, horaForm, duracao, reuniaoId);

// Desabilita o botão Agendar se há conflito
const podeAgendar = !resultado?.conflito && !verificando;

// Alerta de conflito abaixo do campo de hora
{resultado?.conflito && (
  <AlertaConflito
    tipo={resultado.tipo!}
    detalhe={resultado.detalhe!}
    onVerGrade={() => abrirGradeHorarios(dataForm)}
  />
)}
```

---

## 6. Tratamento do 409 ao salvar

```tsx
async function salvarReuniao(dados: NovaReuniao) {
  try {
    const res = await fetch('/api/reunioes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });

    if (res.status === 409) {
      const erro = await res.json();
      // Mostra o erro NO modal (não fecha)
      setErroConflito({
        mensagem: erro.detail,
        tipo:     erro.tipo_conflito,
        conflito: erro.reuniao_conflitante,
      });
      return; // não fecha o modal
    }

    if (!res.ok) throw new Error('Erro ao salvar');

    // Sucesso
    fecharModal();
    toast.success('Reunião agendada!');
    recarregarLista();

  } catch {
    toast.error('Erro de conexão. Tente novamente.');
  }
}
```

---

## 7. Componentes a Criar

| # | Componente | Descrição | Complexidade |
|---|-----------|-----------|--------------|
| 1 | `<AlertaConflito />` | Banner amarelo/vermelho no modal | Baixa |
| 2 | `useVerificarConflito()` | Hook de debounce + chamada à API | Baixa |
| 3 | `<GradeHorarios />` | Drawer com slots do dia (clicável) | Média |
| 4 | `<CalendarioMensal />` | Grid de 30 dias com indicadores | Alta |
| 5 | `<ModalBloqueio />` | Formulário para fechar agenda | Média |
| 6 | `<ListaBloqueios />` | Lista com botão de remover | Baixa |
| 7 | Aba "Agenda" na página `/reunioes` | Container das views acima | Baixa |

---

## 8. Regras de Negócio

| Regra | Quem pode |
|-------|----------|
| Criar bloqueio de agenda | Apenas Admin (dono) |
| Remover bloqueio | Apenas Admin |
| Ver grade de horários | Qualquer gestor logado |
| Agendar reunião em dia/hora bloqueado | **Ninguém** (API rejeita com 409) |
| Dois gestores no mesmo horário | **Impossível** (API rejeita com 409) |

---

## 9. Ordem de Implementação

| # | Tarefa | Tempo |
|---|--------|-------|
| 1 | `useVerificarConflito()` hook | 30 min |
| 2 | `<AlertaConflito />` no modal | 30 min |
| 3 | Tratar 409 no POST sem fechar modal | 20 min |
| 4 | `<GradeHorarios />` drawer | 1h |
| 5 | `<CalendarioMensal />` | 2h |
| 6 | `<ModalBloqueio />` + endpoints | 1h |
| 7 | `<ListaBloqueios />` | 30 min |
| 8 | Aba "Agenda" integrando tudo | 30 min |

**Total estimado: ~6h**

---

## 10. Critérios de Aceite

- [ ] Ao selecionar hora ocupada, alerta aparece imediatamente (sem precisar clicar em salvar)
- [ ] Botão "Agendar" fica desabilitado enquanto há conflito
- [ ] Se o dono bloqueou o dia, gestor vê mensagem explicando o motivo
- [ ] Ao tentar salvar com conflito, modal não fecha — mostra o erro
- [ ] Grade de horários mostra slots livres em verde e ocupados em vermelho
- [ ] Clicar em slot livre na grade preenche o campo de hora automaticamente
- [ ] Calendário mensal mostra dias com reuniões e dias bloqueados
- [ ] Admin consegue fechar dia inteiro ou intervalo específico
- [ ] Bloqueios aparecem na lista e podem ser removidos pelo admin
- [ ] Reunião existente NÃO gera conflito consigo mesma ao editar

---

*Backend implementado em `pharmaflow-node/src/api/index.ts`.*
*Migration: `migrations/0004_add_agenda_bloqueios.sql`.*
