/**
 * Token do Facebook colado pelo gestor: o curto do nosso app vira de ~60 dias;
 * o de outro app é gravado como veio, com aviso. O Meta é sempre simulado.
 */
import { describe, it, expect } from 'vitest';
import { ConexaoMetaService } from '../src/meta/ConexaoMetaService';
import type { ClienteGraphMeta } from '../src/meta/ClienteGraphMeta';
import type { StateOAuth } from '../src/auth/StateOAuth';
import type { GestorRepository } from '../src/gestores/GestorRepository';

const TOKEN_CURTO = `EA${'a'.repeat(60)}`;
const TOKEN_LONGO = `EA${'b'.repeat(60)}`;
const DUAS_HORAS  = () => Math.floor(Date.now() / 1000) + 2 * 3600;

function montar(appDoToken: string) {
  const gravados: Array<Record<string, unknown>> = [];
  const pedidos: string[] = [];
  const graph = {
    get: async (caminho: string, params: Record<string, string>) => {
      pedidos.push(caminho);
      if (caminho === '/debug_token') {
        return { data: {
          is_valid: true, app_id: appDoToken, type: 'USER', expires_at: DUAS_HORAS(),
          scopes: ['ads_management', 'pages_manage_ads', 'pages_show_list'],
        } };
      }
      if (caminho === '/oauth/access_token') {
        expect(params.fb_exchange_token).toBe(TOKEN_CURTO);
        return { access_token: TOKEN_LONGO, expires_in: 60 * 86_400 };
      }
      if (caminho === '/me') return { id: '42', name: 'Victor' };
      throw new Error(`inesperado: ${caminho}`);
    },
  } as unknown as ClienteGraphMeta;
  const gestores = { atualizar: async (_id: number, d: Record<string, unknown>) => { gravados.push(d); } } as unknown as GestorRepository;

  const service = new ConexaoMetaService(
    { appId: 'nosso-app', appSecret: 'segredo', redirectUri: 'http://x' },
    graph, {} as StateOAuth, gestores, (t) => `cifrado:${t}`,
  );
  return { service, gravados, pedidos };
}

describe('Token do Facebook colado', () => {
  it('token curto do NOSSO app é trocado pelo de ~60 dias, sem aviso', async () => {
    const { service, gravados } = montar('nosso-app');
    const r = await service.conectarPorToken(3, TOKEN_CURTO);

    expect(r.aviso).toBeNull();
    expect(gravados[0].metaAccessToken).toBe(`cifrado:${TOKEN_LONGO}`);
    const dias = ((gravados[0].metaTokenExpiraEm as Date).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(59);
  });

  it('token curto de OUTRO app (ex.: Graph Explorer) é gravado como veio, com aviso de que vence', async () => {
    const { service, gravados, pedidos } = montar('app-do-graph-explorer');
    const r = await service.conectarPorToken(3, TOKEN_CURTO);

    expect(pedidos).not.toContain('/oauth/access_token');            // nem tenta: o Meta recusaria
    expect(gravados[0].metaAccessToken).toBe(`cifrado:${TOKEN_CURTO}`);
    expect(r.aviso).toMatch(/vence em 2 h/);
  });
});
