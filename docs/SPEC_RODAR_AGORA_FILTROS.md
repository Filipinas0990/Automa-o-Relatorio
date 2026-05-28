# SPEC — Modal "Rodar Agora" com Filtros de Período e Gestor

**Versão:** 1.0  
**Data:** 2026-05-28  
**Backend implementado:** ✅

---

## Motivação

Rodar os 3 períodos (7, 15, 30 dias) para todas as farmácias de uma só vez é demorado e desperdiça recursos quando o usuário só quer, por exemplo, atualizar os dados de 7 dias de um gestor específico.

---

## Novos Endpoints

### `GET /api/rodar-agora/preview`

Retorna uma prévia de quantas farmácias seriam coletadas **sem disparar nada**.

**Query params:**
| Param | Tipo | Default | Exemplo |
|---|---|---|---|
| `periodos` | string (CSV) | `7,15,30` | `?periodos=7,30` |
| `gestor_id` | number | *(todas)* | `?gestor_id=3` |

**Response:**
```json
{
  "farmaciasTotais": 5,
  "nomes": ["Farmácia Bem Estar", "Drogaria São João", "..."],
  "periodos": [7, 30]
}
```

---

### `POST /api/rodar-agora`

Agora aceita body opcional:

```json
{
  "periodos": [7, 30],
  "gestor_id": 3
}
```

**Se não enviar body** — comportamento atual: roda 7 + 15 + 30 para todas as farmácias.

**Response (202):**
```json
{
  "status": "iniciado",
  "mensagem": "Pipeline iniciado em background",
  "periodos": [7, 30],
  "gestor_id": 3
}
```

**Response (409) — já está rodando:**
```json
{
  "status": "ja_rodando",
  "mensagem": "Pipeline já está em execução"
}
```

---

## Componente: `<ModalRodarAgora>`

### Localização sugerida
`src/components/ModalRodarAgora.tsx`

---

### Fluxo do usuário

```
Usuário clica "▶ Rodar Agora"
        │
        ▼
┌────────────────────────────┐
│  Modal com as opções       │  ← aparece (não dispara ainda)
│  Período + Gestor          │
│  Preview de farmácias      │
└────────────────────────────┘
        │
   [Confirmar e Rodar]
        │
        ▼
  POST /api/rodar-agora   ← agora dispara
        │
        ▼
  Toast "Pipeline iniciado ✅"
  Botão fica desabilitado enquanto roda
```

---

### Wireframe

```
┌──────────────────────────────────────────────────────┐
│  ▶ Configurar Automação                      [✕]    │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Período de coleta                                    │
│  ┌──────────────────────────────────────────────┐    │
│  │  [✓] 7 dias    [✓] 15 dias    [ ] 30 dias   │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  Filtrar por Gestor  (opcional)                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  Todos os gestores                    [▼]    │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  📊 Prévia                                   │    │
│  │                                              │    │
│  │  5 farmácias · 2 períodos · ~8 min           │    │
│  │                                              │    │
│  │  • Farmácia Bem Estar                        │    │
│  │  • Drogaria São João                         │    │
│  │  • Farmácia Central                          │    │
│  │  • ...                                       │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ⚠️  Cada farmácia × período demora ~1-2 min         │
│                                                       │
├──────────────────────────────────────────────────────┤
│           [Cancelar]   [▶ Confirmar e Rodar]         │
└──────────────────────────────────────────────────────┘
```

**Enquanto pipeline roda (botão no header fica bloqueado):**
```
┌──────────────────────────────────────────────────────┐
│  ⏳ Rodando...   5 farm × 2 períodos                 │
└──────────────────────────────────────────────────────┘
```

---

## Implementação React

### Estado

```tsx
interface OpcoesPipeline {
  periodos: number[];      // ex: [7, 15]
  gestor_id: number | null;
}

interface PreviewData {
  farmaciasTotais: number;
  nomes: string[];
  periodos: number[];
}

const [modalAberto, setModalAberto]     = useState(false);
const [opcoes, setOpcoes]               = useState<OpcoesPipeline>({
  periodos: [7, 15, 30],
  gestor_id: null,
});
const [preview, setPreview]             = useState<PreviewData | null>(null);
const [carregandoPreview, setCarregandoPreview] = useState(false);
const [pipelineRodando, setPipelineRodando]     = useState(false);
```

---

### Hook `usePreviewPipeline`

```tsx
function usePreviewPipeline(opcoes: OpcoesPipeline, token: string) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opcoes.periodos.length) { setPreview(null); return; }

    setLoading(true);
    const params = new URLSearchParams();
    params.set('periodos', opcoes.periodos.join(','));
    if (opcoes.gestor_id) params.set('gestor_id', String(opcoes.gestor_id));

    fetch(`/api/rodar-agora/preview?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setPreview)
      .finally(() => setLoading(false));
  }, [opcoes.periodos.join(','), opcoes.gestor_id]); // re-fetch quando muda opção

  return { preview, loading };
}
```

---

### Componente Modal Completo

```tsx
function ModalRodarAgora({ onClose, token, gestores }: {
  onClose: () => void;
  token: string;
  gestores: { id: number; nome: string }[];
}) {
  const [opcoes, setOpcoes] = useState<OpcoesPipeline>({
    periodos: [7, 15, 30],
    gestor_id: null,
  });
  const [rodando, setRodando] = useState(false);
  const { preview, loading } = usePreviewPipeline(opcoes, token);

  function togglePeriodo(dias: number) {
    setOpcoes(prev => ({
      ...prev,
      periodos: prev.periodos.includes(dias)
        ? prev.periodos.filter(p => p !== dias)
        : [...prev.periodos, dias].sort((a, b) => a - b),
    }));
  }

  async function confirmarERodar() {
    if (!opcoes.periodos.length) {
      toast.error('Selecione ao menos um período');
      return;
    }
    setRodando(true);
    try {
      const res = await fetch('/api/rodar-agora', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          periodos: opcoes.periodos,
          gestor_id: opcoes.gestor_id,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        toast.error('Pipeline já está em execução');
        return;
      }
      const farm = preview?.farmaciasTotais ?? '?';
      const per  = opcoes.periodos.join(', ');
      toast.success(`Pipeline iniciado: ${farm} farmácias · períodos ${per} dias`);
      onClose();
    } catch {
      toast.error('Erro ao iniciar pipeline');
    } finally {
      setRodando(false);
    }
  }

  // Estimativa de tempo: ~1.5 min por farmácia × período
  const estimativaMin = preview
    ? Math.round(preview.farmaciasTotais * opcoes.periodos.length * 1.5)
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">

        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-800">▶ Configurar Automação</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* Períodos */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Período de coleta
          </label>
          <div className="flex gap-3">
            {[7, 15, 30].map(dias => (
              <button
                key={dias}
                onClick={() => togglePeriodo(dias)}
                className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                  opcoes.periodos.includes(dias)
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 text-gray-400 hover:border-gray-300'
                }`}
              >
                {opcoes.periodos.includes(dias) ? '✓ ' : ''}{dias} dias
              </button>
            ))}
          </div>
        </div>

        {/* Gestor */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Filtrar por Gestor <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <select
            value={opcoes.gestor_id ?? ''}
            onChange={e => setOpcoes(prev => ({
              ...prev,
              gestor_id: e.target.value ? parseInt(e.target.value) : null,
            }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          >
            <option value="">Todos os gestores</option>
            {gestores.map(g => (
              <option key={g.id} value={g.id}>{g.nome}</option>
            ))}
          </select>
        </div>

        {/* Preview */}
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 min-h-[100px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-gray-600">📊 Prévia</span>
            {loading && <span className="text-xs text-gray-400 animate-pulse">carregando...</span>}
          </div>

          {preview && !loading && (
            <>
              <div className="text-sm text-gray-700 font-medium mb-2">
                {preview.farmaciasTotais} farmácia{preview.farmaciasTotais !== 1 ? 's' : ''}
                {' · '}
                {opcoes.periodos.length} período{opcoes.periodos.length !== 1 ? 's' : ''}
                {estimativaMin && ` · ~${estimativaMin} min`}
              </div>
              <ul className="text-xs text-gray-500 space-y-0.5 max-h-28 overflow-y-auto">
                {preview.nomes.map(nome => (
                  <li key={nome}>• {nome}</li>
                ))}
              </ul>
            </>
          )}

          {preview?.farmaciasTotais === 0 && !loading && (
            <p className="text-sm text-orange-600">
              Nenhuma farmácia encontrada com esses filtros.
            </p>
          )}
        </div>

        {/* Aviso */}
        {(preview?.farmaciasTotais ?? 0) > 0 && (
          <p className="text-xs text-gray-400">
            ⚠️ Cada farmácia × período demora ~1-2 min. Não feche o servidor.
          </p>
        )}

        {/* Ações */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirmarERodar}
            disabled={rodando || !opcoes.periodos.length || preview?.farmaciasTotais === 0}
            className="flex-1 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 
                       text-white rounded-lg text-sm font-semibold transition-all"
          >
            {rodando ? '⏳ Iniciando...' : '▶ Confirmar e Rodar'}
          </button>
        </div>

      </div>
    </div>
  );
}
```

---

### Integração no componente pai (Dashboard/Header)

```tsx
// Estado no componente raiz
const [modalPipelineAberto, setModalPipelineAberto] = useState(false);
const [pipelineRodando, setPipelineRodando]         = useState(false);

// Checa se já está rodando ao montar e a cada 30s
useEffect(() => {
  const checar = async () => {
    const res  = await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setPipelineRodando(data.pipeline_rodando);
  };
  checar();
  const interval = setInterval(checar, 30_000);
  return () => clearInterval(interval);
}, []);

// Botão no header
<button
  onClick={() => {
    if (pipelineRodando) {
      toast.error('Pipeline já está em execução');
      return;
    }
    setModalPipelineAberto(true);
  }}
  disabled={pipelineRodando}
  className="flex items-center gap-2 bg-green-500 hover:bg-green-600 
             disabled:opacity-60 disabled:cursor-not-allowed
             text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all"
>
  {pipelineRodando ? (
    <>⏳ Rodando...</>
  ) : (
    <>▶ Rodar Agora</>
  )}
</button>

{/* Modal */}
{modalPipelineAberto && (
  <ModalRodarAgora
    token={token}
    gestores={gestores}   // lista de gestores carregada do GET /api/gestores
    onClose={() => {
      setModalPipelineAberto(false);
      // Inicia polling após fechar, pois pipeline pode ter começado
      setTimeout(() => setPipelineRodando(true), 500);
    }}
  />
)}
```

---

## Endpoint de gestores para o select

O select de gestores precisa de uma lista. Use:

```
GET /api/gestores
Authorization: Bearer <token>
```

Response: `[{ id: 1, nome: "João Silva" }, ...]`

---

## Tempo estimado por configuração

| Farmácias | Períodos | Estimativa |
|---|---|---|
| 5 | 1 (ex: 7d) | ~7 min |
| 5 | 2 (ex: 7d + 30d) | ~15 min |
| 5 | 3 (7 + 15 + 30) | ~22 min |
| 10 | 3 | ~45 min |

---

## Checklist Frontend

- [ ] Criar `ModalRodarAgora.tsx`
- [ ] Adicionar `usePreviewPipeline` hook (ou incluir no componente)
- [ ] Botão "Rodar Agora" no header abre modal (não dispara diretamente)
- [ ] Polling de `GET /api/status` a cada 30s para mostrar estado do pipeline
- [ ] Botão desabilitado com "⏳ Rodando..." enquanto `pipeline_rodando = true`
- [ ] Carregar lista de gestores para o select (usar `GET /api/gestores`)
- [ ] Validar que ao menos 1 período está selecionado antes de confirmar
