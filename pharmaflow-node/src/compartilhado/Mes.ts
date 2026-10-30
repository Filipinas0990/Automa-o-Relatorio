import { RequisicaoInvalida } from './erros';

/** Mês no formato `AAAA-MM`, como as telas mandam na query. */
export class Mes {
  private static readonly FORMATO = /^\d{4}-\d{2}$/;

  /** O mês pedido, ou `padrao` se não veio. Formato errado vira 400. */
  static daQuery(mes: string | undefined, padrao = Mes.atual()): string {
    const valor = mes || padrao;
    if (!Mes.FORMATO.test(valor)) throw new RequisicaoInvalida('Formato inválido. Use YYYY-MM.');
    return valor;
  }

  /** Mês corrente no fuso do servidor. */
  static atual(): string {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  }
}
