import { google, type calendar_v3 } from 'googleapis';

export interface ConfigGoogle {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const ESCOPOS = ['https://www.googleapis.com/auth/calendar.events'];

/** Fala com o OAuth do Google: autorização, troca do código e cliente do Calendar. */
export class ClienteGoogleOAuth {
  constructor(private readonly config: ConfigGoogle) {}

  /** Sem GOOGLE_CLIENT_ID a integração fica desligada. */
  get configurado(): boolean {
    return !!this.config.clientId;
  }

  /** `offline` + `consent` para o Google mandar o refresh_token. */
  urlDeAutorizacao(state: string): string {
    return this.oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ESCOPOS, state });
  }

  /**
   * Troca o código do callback pelo refresh_token. Null quando o usuário já
   * tinha autorizado antes — o Google não reenvia o refresh_token.
   */
  async refreshTokenDoCodigo(code: string): Promise<string | null> {
    const { tokens } = await this.oauth().getToken(code);
    return tokens.refresh_token ?? null;
  }

  calendario(refreshToken: string): calendar_v3.Calendar {
    const auth = this.oauth();
    auth.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth });
  }

  private oauth() {
    return new google.auth.OAuth2(this.config.clientId, this.config.clientSecret, this.config.redirectUri);
  }
}
