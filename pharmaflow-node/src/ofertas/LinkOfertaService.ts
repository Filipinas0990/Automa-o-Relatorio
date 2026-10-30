import crypto from 'crypto';
import type { Farmacia, Gestor } from '../database/schema';
import { NaoEncontrado, Proibido } from '../compartilhado/erros';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { LinkOfertaRepository, LinkResolvido } from './LinkOfertaRepository';

export type LinkAberto = LinkResolvido & { farmacia: Farmacia | null };

/** Token do link público — aleatório, longo o bastante para não ser adivinhado. */
function tokenAleatorio(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * O link público de ofertas de cada cliente: cria, troca e abre.
 * Quem tem o link não faz login — o token é a credencial.
 */
export class LinkOfertaService {
  constructor(
    private readonly links: LinkOfertaRepository,
    private readonly farmacias: FarmaciaRepository,
    /** Endereço do front onde o dono abre o link (sem a barra final). */
    private readonly urlBase: string,
    private readonly gerarToken: () => string = tokenAleatorio,
  ) {}

  url(token: string): string {
    return `${this.urlBase.replace(/\/$/, '')}/ofertas/${token}`;
  }

  /**
   * Resolve o token e, quando o link é de um cliente, a farmácia dele.
   * A farmácia é revalidada a cada acesso: se ela for desativada ou passar
   * para outro gestor, o link para de funcionar. Null = não abre.
   */
  async abrir(token: string): Promise<LinkAberto | null> {
    const link = await this.links.porToken(token);
    if (!link) return null;
    if (link.farmaciaId === null) return { ...link, farmacia: null };

    const farmacia = await this.farmacias.buscarAtiva(link.farmaciaId);
    if (!farmacia) return null;
    if (!link.gestor.isAdmin && farmacia.gestorId !== link.gestor.id) return null;
    return { ...link, farmacia };
  }

  /**
   * URL do link de cada farmácia informada, criando as que ainda não existem.
   * A carteira chama com todos os clientes: assim o gestor vê o "Copiar"
   * pronto em cada linha, sem um request por cliente.
   */
  async daCarteira(gestorId: number, farmaciaIds: number[]): Promise<Map<number, string>> {
    let tokens = await this.tokensPorFarmacia(gestorId);

    const faltando = farmaciaIds.filter((id) => !tokens.has(id));
    if (faltando.length > 0) {
      await this.links.criar(faltando.map((farmaciaId) => ({ gestorId, farmaciaId, token: this.gerarToken() })));
      // Relê em vez de assumir os tokens que geramos: se outra aba criou os
      // links primeiro, o insert virou no-op e valem os tokens dela.
      tokens = await this.tokensPorFarmacia(gestorId);
    }

    return new Map(
      farmaciaIds.filter((id) => tokens.has(id)).map((id) => [id, this.url(tokens.get(id) as string)]),
    );
  }

  /** `regenerar`, conferindo antes que a farmácia está ativa e é da carteira de quem pede. */
  async regenerarPara(quem: Gestor, farmaciaId: number): Promise<{ token: string; url: string }> {
    const farmacia = await this.farmacias.buscarAtiva(farmaciaId);
    if (!farmacia) throw new NaoEncontrado('Farmácia não encontrada');
    if (!quem.isAdmin && farmacia.gestorId !== quem.id) throw new Proibido('Esta farmácia não é da sua carteira');
    return this.regenerar(quem.id, farmaciaId);
  }

  /** Troca o token de um cliente — usado quando o link vaza ou o dono some. */
  async regenerar(gestorId: number, farmaciaId: number): Promise<{ token: string; url: string }> {
    const trocado = await this.links.trocarToken(gestorId, farmaciaId, this.gerarToken());
    if (trocado) return { token: trocado.token, url: this.url(trocado.token) };

    // Cliente que ainda não tinha link: criar já entrega um token novo.
    const url = (await this.daCarteira(gestorId, [farmaciaId])).get(farmaciaId);
    if (!url) throw new Error('Não foi possível gerar o link deste cliente.');
    return { token: url.split('/').pop() as string, url };
  }

  private async tokensPorFarmacia(gestorId: number): Promise<Map<number, string>> {
    const links = await this.links.porFarmacia(gestorId);
    return new Map(links.map((l) => [l.farmaciaId as number, l.token]));
  }
}
