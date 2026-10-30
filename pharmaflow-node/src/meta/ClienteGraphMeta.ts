const GRAPH = 'https://graph.facebook.com/v20.0';

/** GET no Graph API do Meta. Erro do Meta vira exceção com a mensagem dele. */
export class ClienteGraphMeta {
  async get<T>(caminho: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${GRAPH}${caminho}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res  = await fetch(url);
    const json = await res.json() as T & { error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'Erro do Meta');
    return json;
  }
}
