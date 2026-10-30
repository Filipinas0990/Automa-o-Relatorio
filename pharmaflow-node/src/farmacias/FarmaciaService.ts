import { Conflito, NaoEncontrado, RequisicaoInvalida } from '../compartilhado/erros';
import { nomeVisivel } from '../database/schema';
import type { Farmacia, FarmaciaRepository, NovaFarmacia } from './FarmaciaRepository';

/** Corpo do cadastro/edição como o front manda (snake_case). */
export interface DadosFarmacia {
  nome?: string;
  nome_fachada?: string | null;
  gestor_id?: number;
  ativa?: boolean;
  tem_chatbot?: boolean;
  fase?: string;
  telefone?: string;
  responsavel?: string;
  cidade?: string;
  observacoes?: string;
  meta_vendas?: number;
  meta_receita?: string;
  meta_leads_google?: number;
  meta_leads_meta?: number;
  /** Conta de anúncios do Meta ("act_123" ou só "123"). null/"" desvincula. */
  meta_ad_account_id?: string | null;
}

type Campo = [keyof DadosFarmacia, keyof NovaFarmacia];

const CAMPOS_META: Campo[] = [
  ['meta_vendas',       'metaVendas'],
  ['meta_receita',      'metaReceita'],
  ['meta_leads_google', 'metaLeadsGoogle'],
  ['meta_leads_meta',   'metaLeadsMeta'],
];

/** Campos que a edição copia como vieram. `nome_fachada` tem tratamento próprio. */
const CAMPOS_EDITAVEIS: Campo[] = [
  ['nome',        'nome'],
  ['gestor_id',   'gestorId'],
  ['ativa',       'ativa'],
  ['tem_chatbot', 'temChatbot'],
  ['fase',        'fase'],
  ['telefone',    'telefone'],
  ['responsavel', 'responsavel'],
  ['cidade',      'cidade'],
  ['observacoes', 'observacoes'],
  ...CAMPOS_META,
];

/** Regras do cadastro de farmácias. */
export class FarmaciaService {
  constructor(private readonly farmacias: FarmaciaRepository) {}

  async criar(d: DadosFarmacia): Promise<Farmacia> {
    if (!d.nome) throw new RequisicaoInvalida('Campo "nome" (razão social) é obrigatório.');
    // Obrigatório no cadastro novo: é o nome que vai para o criativo do grupo.
    // Os cadastros antigos ficam com null até alguém editá-los (migration 0025).
    if (!d.nome_fachada?.trim()) throw new RequisicaoInvalida('Campo "nome_fachada" é obrigatório.');
    const contaMeta = await this.contaMetaLivre(d.meta_ad_account_id, null);

    return this.farmacias.criar({
      nome:        d.nome,
      nomeFachada: d.nome_fachada.trim(),
      metaAdAccountId: contaMeta ?? null,
      fase:        d.fase === 'entrada' ? 'entrada' : 'ativo',
      gestorId:    d.gestor_id || null,
      temChatbot:  d.tem_chatbot !== false,
      telefone:    d.telefone    ?? null,
      responsavel: d.responsavel ?? null,
      cidade:      d.cidade      ?? null,
      observacoes: d.observacoes ?? null,
    });
  }

  /** Só muda os campos enviados. */
  async atualizar(id: number, d: DadosFarmacia): Promise<Farmacia> {
    await this.exigir(id);
    const mudancas = this.copiar(d, CAMPOS_EDITAVEIS);
    if (d.nome_fachada !== undefined) mudancas.nomeFachada = d.nome_fachada?.trim() || null;
    if (d.meta_ad_account_id !== undefined) mudancas.metaAdAccountId = await this.contaMetaLivre(d.meta_ad_account_id, id);
    await this.farmacias.atualizar(id, mudancas);
    return this.exigir(id);
  }

  async atualizarMetas(id: number, d: DadosFarmacia): Promise<Farmacia> {
    await this.exigir(id);
    await this.farmacias.atualizar(id, this.copiar(d, CAMPOS_META));
    return this.exigir(id);
  }

  /** Desativa, não apaga: coletas, disparos e histórico continuam apontando para ela. */
  async desativar(id: number): Promise<void> {
    await this.exigir(id);
    await this.farmacias.desativar(id);
  }

  /** Promove cliente de entrada para ativo. */
  async ativar(id: number, d: DadosFarmacia): Promise<Farmacia> {
    const atual = await this.exigir(id);
    if (atual.fase !== 'entrada') throw new RequisicaoInvalida('Farmácia já está ativa.');

    await this.farmacias.atualizar(id, {
      fase:     'ativo',
      gestorId: d.gestor_id !== undefined ? d.gestor_id : atual.gestorId,
    });
    return this.exigir(id);
  }

  /**
   * Conta de anúncios no formato "act_123", ou null para desvincular. Recusa
   * conta que já é de outra farmácia: cada conta tem um dono só.
   */
  private async contaMetaLivre(valor: string | null | undefined, farmaciaId: number | null): Promise<string | null> {
    const limpo = (valor ?? '').trim();
    if (!limpo) return null;
    const numero = limpo.replace(/^act_/i, '');
    if (!/^\d{5,30}$/.test(numero)) {
      throw new RequisicaoInvalida('Conta de anúncios inválida: use o ID da conta (ex.: act_123456789).');
    }
    const conta = `act_${numero}`;
    const dono  = await this.farmacias.buscarPorContaMeta(conta);
    if (dono && dono.id !== farmaciaId) {
      throw new Conflito(`Essa conta de anúncios já é da farmácia "${nomeVisivel(dono)}".`);
    }
    return conta;
  }

  private async exigir(id: number): Promise<Farmacia> {
    const f = await this.farmacias.buscarPorId(id);
    if (!f) throw new NaoEncontrado('Farmácia não encontrada');
    return f;
  }

  private copiar(d: DadosFarmacia, campos: Campo[]): Partial<NovaFarmacia> {
    const saida: Record<string, unknown> = {};
    for (const [daApi, daTabela] of campos) {
      if (d[daApi] !== undefined) saida[daTabela] = d[daApi];
    }
    return saida as Partial<NovaFarmacia>;
  }
}
