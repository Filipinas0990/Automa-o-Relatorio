import { logger } from '../logger';

/**
 * Geocodificação de cidade → latitude/longitude, usada só para DESENHAR o mapa
 * do raio no wizard. O targeting do Meta continua indo pela "key" da cidade
 * (`geo_locations.cities`), então uma coordenada aproximada não afeta o anúncio.
 *
 * Fonte: Nominatim (OpenStreetMap), gratuito e sem chave. A política de uso pede
 * User-Agent identificando a aplicação e no máximo 1 req/s — por isso a busca
 * passa pelo servidor (e não pelo navegador de cada gestor) e fica em cache.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'PharmaFlow/1.0 (agencia de trafego para farmacias)';

export interface Coordenada {
  lat: number;
  lon: number;
}

// Cidade não muda de lugar: cache em memória vale pelo tempo de vida do processo.
const cache = new Map<string, Coordenada | null>();

// Nominatim pede no máximo 1 req/s. Uma fila serial simples garante isso mesmo
// com vários gestores mexendo no wizard ao mesmo tempo.
let ultimaChamada = 0;
let fila: Promise<unknown> = Promise.resolve();

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function enfileirar<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = fila.then(async () => {
    const espera = 1100 - (Date.now() - ultimaChamada);
    if (espera > 0) await dormir(espera);
    ultimaChamada = Date.now();
    return fn();
  });
  // A fila não pode quebrar quando uma chamada falha.
  fila = proxima.catch(() => undefined);
  return proxima;
}

/**
 * Devolve as coordenadas da cidade, ou null quando não encontra.
 * `regiao` é o estado ("Ceará") — melhora bastante a precisão em nomes repetidos
 * (Campo Grande, São Francisco...).
 */
export async function coordenadasDaCidade(nome: string, regiao = ''): Promise<Coordenada | null> {
  const cidade = nome.trim();
  if (!cidade) return null;

  const chave = `${cidade.toLowerCase()}|${regiao.trim().toLowerCase()}`;
  const emCache = cache.get(chave);
  if (emCache !== undefined) return emCache;

  const q = regiao.trim() ? `${cidade}, ${regiao.trim()}` : cidade;
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=br&limit=1&q=${encodeURIComponent(q)}`;

  try {
    const coord = await enfileirar(async () => {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' },
        signal:  AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Nominatim respondeu ${res.status}`);

      const json = await res.json() as Array<{ lat?: string; lon?: string }>;
      const primeiro = json[0];
      if (!primeiro?.lat || !primeiro?.lon) return null;

      const lat = Number(primeiro.lat);
      const lon = Number(primeiro.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    });

    cache.set(chave, coord);
    return coord;
  } catch (err) {
    // Sem coordenada o wizard só esconde o mapa — não é motivo para travar a etapa.
    logger.warn({ err: (err as Error).message, cidade: q }, 'Falha ao geocodificar cidade');
    return null;
  }
}
