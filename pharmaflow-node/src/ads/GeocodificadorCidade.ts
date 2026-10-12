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

/**
 * Só o nome da cidade, sem o rabo de estado/país.
 *
 * A Meta devolve o rótulo completo em `name` ("Rio Verde, Goias, Brazil") e o
 * estado de novo em `region` ("Goiás"). Jogar isso inteiro no Nominatim vira
 * "Rio Verde, Goias, Brazil, Goiás", que não casa com nada e volta vazio — era
 * por isso que o mapa caía no "Brasil inteiro" mesmo com a cidade escolhida.
 */
function soACidade(nome: string): string {
  return (nome.split(',')[0] ?? '').trim();
}

export class GeocodificadorCidade {
  // Cidade não muda de lugar: cache em memória vale pelo tempo de vida do processo.
  private readonly cache = new Map<string, Coordenada | null>();

  // Nominatim pede no máximo 1 req/s. Uma fila serial simples garante isso mesmo
  // com vários gestores mexendo no wizard ao mesmo tempo.
  private ultimaChamada = 0;
  private fila: Promise<unknown> = Promise.resolve();

  private dormir(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private enfileirar<T>(fn: () => Promise<T>): Promise<T> {
    const proxima = this.fila.then(async () => {
      const espera = 1100 - (Date.now() - this.ultimaChamada);
      if (espera > 0) await this.dormir(espera);
      this.ultimaChamada = Date.now();
      return fn();
    });
    // A fila não pode quebrar quando uma chamada falha.
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  /** Uma tentativa no Nominatim; `params` já vem montado (busca estruturada ou livre). */
  private async consultar(params: URLSearchParams): Promise<Coordenada | null> {
    return this.enfileirar(async () => {
      const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
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
  }

  /**
   * Devolve as coordenadas da cidade, ou null quando não encontra.
   * `regiao` é o estado ("Ceará") — melhora bastante a precisão em nomes repetidos
   * (Campo Grande, São Francisco...).
   *
   * Tenta em três níveis, do mais preciso ao mais tolerante, e para na primeira
   * que responde: cada nível cobre um jeito diferente de a Meta escrever o nome.
   */
  async coordenadas(nome: string, regiao = ''): Promise<Coordenada | null> {
    const cidade = soACidade(nome);
    const estado = soACidade(regiao);
    if (!cidade) return null;

    const chave = `${cidade.toLowerCase()}|${estado.toLowerCase()}`;
    const emCache = this.cache.get(chave);
    if (emCache !== undefined) return emCache;

    const base = { format: 'jsonv2', countrycodes: 'br', limit: '1' };

    // 1) Busca estruturada (city + state): a mais confiável para cidade homônima.
    // 2) Busca livre "cidade, estado": pega grafias que o campo `city` recusa.
    // 3) Só a cidade: último recurso, quando o estado veio errado ou vazio.
    const tentativas: URLSearchParams[] = [];
    if (estado) {
      tentativas.push(new URLSearchParams({ ...base, city: cidade, state: estado }));
      tentativas.push(new URLSearchParams({ ...base, q: `${cidade}, ${estado}` }));
    }
    tentativas.push(new URLSearchParams({ ...base, q: cidade }));

    for (const params of tentativas) {
      try {
        const coord = await this.consultar(params);
        if (coord) {
          this.cache.set(chave, coord);
          return coord;
        }
      } catch (err) {
        // Nominatim fora do ar ou lento: tenta o próximo formato antes de desistir.
        logger.warn(
          { err: (err as Error).message, cidade, estado },
          'Falha ao geocodificar cidade',
        );
      }
    }

    // Sem coordenada o wizard mostra o Brasil inteiro — não é motivo para travar a etapa.
    // Negativo não entra no cache: pode ter sido indisponibilidade momentânea.
    logger.warn({ cidade, estado }, 'Cidade não encontrada no Nominatim');
    return null;
  }
}
