// Facebook (Meta Ads) por gestor.
//
// Cada gestor conecta o próprio Facebook e passa a publicar com o token dele
// (./tokenGestor.ts). O token é de usuário: troca-se o de curta duração pelo
// de ~60 dias e guarda-se CRIPTOGRAFADO. Vencido, o gestor reconecta — e
// enquanto isso o sistema usa o token geral do servidor.
//
// No app do Meta (developers.facebook.com → Login do Facebook → Configurações)
// o META_REDIRECT_URI precisa estar em "URIs de redirecionamento do OAuth válidos".

import type { Gestor } from '../database/schema';
import { ErroAplicacao, Indisponivel, RequisicaoInvalida } from '../compartilhado/erros';
import { logger } from '../logger';
import type { StateOAuth } from '../auth/StateOAuth';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { ClienteGraphMeta } from './ClienteGraphMeta';

export interface ConfigMeta {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Resultado do callback, vai para a tela como `?meta=<status>`. */
export type StatusConexaoMeta = 'ok' | 'erro' | 'cancelado' | 'permissoes';

/** O que o sistema precisa para listar contas/páginas e publicar. */
const ESCOPOS = [
  'ads_management', 'ads_read', 'business_management',
  'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'instagram_basic',
];
/** Sem estes não dá para publicar: se o gestor desmarcar, a conexão não vale. */
const ESCOPOS_OBRIGATORIOS = ['ads_management', 'pages_manage_ads', 'pages_show_list'];

/** Sem expires_in o Meta não informou prazo: assume os 60 dias usuais. */
const VALIDADE_PADRAO_SEG = 60 * 86_400;

interface DebugToken {
  is_valid?: boolean;
  type?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
}

export class ConexaoMetaService {
  constructor(
    private readonly config: ConfigMeta,
    private readonly graph: ClienteGraphMeta,
    private readonly state: StateOAuth,
    private readonly gestores: GestorRepository,
    private readonly cifrar: (texto: string) => string,
  ) {}

  get configurado(): boolean {
    return !!(this.config.appId && this.config.appSecret);
  }

  urlDeAutorizacao(gestorId: number): string {
    if (!this.configurado) {
      throw new Indisponivel('Login do Facebook não configurado no servidor (META_APP_ID/META_APP_SECRET).');
    }
    const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', this.state.criar(gestorId));
    url.searchParams.set('scope', ESCOPOS.join(','));
    url.searchParams.set('response_type', 'code');
    // Reabre a tela de permissões: quem desmarcou algo da outra vez consegue marcar.
    url.searchParams.set('auth_type', 'rerequest');
    return url.toString();
  }

  /** Volta do Facebook: troca o código pelo token de ~60 dias e guarda. */
  async conectarPorCodigo(q: { code?: string; state?: string; error?: string }): Promise<StatusConexaoMeta> {
    if (q.error || !q.code || !q.state) return q.error === 'access_denied' ? 'cancelado' : 'erro';
    const gestorId = this.state.ler(q.state);
    if (!gestorId) return 'erro';

    try {
      const { appId, appSecret, redirectUri } = this.config;
      const curto = await this.graph.get<{ access_token: string }>('/oauth/access_token', {
        client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code: q.code,
      });
      const longo = await this.graph.get<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret,
        fb_exchange_token: curto.access_token,
      });

      // O gestor pode ter desmarcado permissões na tela do Facebook
      const perms = await this.graph.get<{ data: Array<{ permission: string; status: string }> }>(
        '/me/permissions', { access_token: longo.access_token },
      );
      const concedidas = new Set(perms.data.filter((p) => p.status === 'granted').map((p) => p.permission));
      if (ESCOPOS_OBRIGATORIOS.some((e) => !concedidas.has(e))) return 'permissoes';

      const eu = await this.quemE(longo.access_token);
      await this.gravar(gestorId, longo.access_token, new Date(Date.now() + (longo.expires_in ?? VALIDADE_PADRAO_SEG) * 1000), eu);
      logger.info({ gestorId, metaUsuario: eu.id }, 'Facebook conectado pelo gestor');
      return 'ok';
    } catch (err) {
      logger.error({ gestorId, err: (err as Error).message }, 'Falha ao conectar Facebook do gestor');
      return 'erro';
    }
  }

  /**
   * Alternativa ao botão: o gestor cola um token que ele mesmo gerou no Facebook
   * (de qualquer app). Validado antes de guardar — válido, com as permissões
   * de publicar, e com a validade real informada pelo Meta.
   */
  async conectarPorToken(gestorId: number, bruto: string): Promise<{ nome: string; expira_em: string | null }> {
    const token = bruto.trim();
    if (!/^EA[A-Za-z0-9]{40,}$/.test(token)) {
      throw new RequisicaoInvalida('Isso não parece um token do Facebook (começa com "EA").');
    }
    try {
      // debug_token consultado com o próprio token: funciona para token de qualquer app.
      const d = (await this.graph.get<{ data?: DebugToken }>('/debug_token', { input_token: token, access_token: token })).data ?? {};
      if (!d.is_valid) throw new RequisicaoInvalida('Token inválido ou expirado. Gere um novo no Facebook.');

      const faltando = ESCOPOS_OBRIGATORIOS.filter((e) => !(d.scopes ?? []).includes(e));
      if (faltando.length) {
        throw new RequisicaoInvalida(`Faltam permissões no token: ${faltando.join(', ')}. Gere de novo marcando todas.`);
      }

      const eu = await this.quemE(token);
      // expires_at = 0 → não vence (usuário do sistema); vale então o prazo de acesso a dados, se houver.
      const vence = d.expires_at ? d.expires_at : (d.data_access_expires_at ?? 0);
      const expira = vence ? new Date(vence * 1000) : null;
      await this.gravar(gestorId, token, expira, eu);

      logger.info({ gestorId, metaUsuario: eu.id, tipo: d.type }, 'Token do Facebook colado pelo gestor');
      return { nome: eu.name, expira_em: expira ? expira.toISOString() : null };
    } catch (err) {
      if (err instanceof ErroAplicacao) throw err;
      throw new RequisicaoInvalida(`Não consegui validar o token no Facebook: ${(err as Error).message}`);
    }
  }

  status(g: Gestor) {
    const expira = g.metaTokenExpiraEm ? new Date(g.metaTokenExpiraEm) : null;
    const valido = !!g.metaAccessToken && (!expira || expira.getTime() > Date.now());
    return {
      configurado:    this.configurado,
      conectado:      valido,
      expirado:       !!g.metaAccessToken && !valido,
      nome:           g.metaUsuarioNome ?? null,
      expira_em:      expira ? expira.toISOString() : null,
      dias_restantes: expira ? Math.max(0, Math.floor((expira.getTime() - Date.now()) / 86_400_000)) : null,
    };
  }

  async desconectar(gestorId: number): Promise<void> {
    await this.gestores.atualizar(gestorId, {
      metaAccessToken: null, metaTokenExpiraEm: null, metaUsuarioId: null, metaUsuarioNome: null,
    });
  }

  private quemE(token: string) {
    return this.graph.get<{ id: string; name: string }>('/me', { fields: 'id,name', access_token: token });
  }

  private gravar(gestorId: number, token: string, expira: Date | null, eu: { id: string; name: string }) {
    return this.gestores.atualizar(gestorId, {
      metaAccessToken:   this.cifrar(token),
      metaTokenExpiraEm: expira,
      metaUsuarioId:     eu.id,
      metaUsuarioNome:   eu.name.slice(0, 120),
    });
  }
}
