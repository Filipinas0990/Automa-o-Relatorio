import crypto from 'crypto';
import { ofertasRepository } from './repository';

/** Token do link público — aleatório, longo o bastante para não ser adivinhado. */
export function gerarToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * URL que o gestor copia e manda para o dono da farmácia.
 *
 * `OFERTAS_URL_BASE` existe para testar local sem mexer no `FRONTEND_URL`, que
 * também é usado nos links de produção. Em produção basta não definir a
 * variável — aí cai no FRONTEND_URL normalmente.
 */
export function montarUrl(token: string): string {
  const base = (
    process.env.OFERTAS_URL_BASE
    || process.env.FRONTEND_URL
    || 'http://localhost:5173'
  ).replace(/\/$/, '');
  return `${base}/ofertas/${token}`;
}

export const ofertasService = {

  /**
   * URL do link de cada farmácia informada, criando as que ainda não existem.
   *
   * É chamado pela carteira, que já lista todos os clientes: assim o gestor vê
   * o botão "Copiar" pronto em cada linha, sem um request por cliente.
   */
  async linksDaCarteira(
    gestorId:    number,
    farmaciaIds: number[],
  ): Promise<Map<number, string>> {
    const existentes = await ofertasRepository.linksPorFarmacia(gestorId);
    const porFarmacia = new Map<number, string>(
      existentes.map((l) => [l.farmaciaId as number, l.token]),
    );

    const faltando = farmaciaIds.filter((id) => !porFarmacia.has(id));
    if (faltando.length > 0) {
      await ofertasRepository.criarLinks(
        faltando.map((farmaciaId) => ({ gestorId, farmaciaId, token: gerarToken() })),
      );
      // Relê em vez de assumir os tokens que geramos: se outra aba criou os
      // links primeiro, o insert virou no-op e valem os tokens dela.
      const atualizados = await ofertasRepository.linksPorFarmacia(gestorId);
      porFarmacia.clear();
      for (const l of atualizados) porFarmacia.set(l.farmaciaId as number, l.token);
    }

    return new Map(
      farmaciaIds
        .filter((id) => porFarmacia.has(id))
        .map((id) => [id, montarUrl(porFarmacia.get(id) as string)]),
    );
  },

  /** Troca o token de um cliente — o link antigo para de funcionar na hora. */
  async regenerarLink(gestorId: number, farmaciaId: number) {
    const trocado = await ofertasRepository.trocarToken(gestorId, farmaciaId, gerarToken());
    if (trocado) return { token: trocado.token, url: montarUrl(trocado.token) };

    // Cliente que ainda não tinha link: criar já entrega um token novo.
    const links = await this.linksDaCarteira(gestorId, [farmaciaId]);
    const url = links.get(farmaciaId);
    if (!url) throw new Error('Não foi possível gerar o link deste cliente.');
    return { token: url.split('/').pop() as string, url };
  },
};
