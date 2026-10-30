import { eq, notInArray, sql } from 'drizzle-orm';
import { contasAnuncioCache, contasAnuncioCacheSync } from '../database/schema';
import type { ContaAnuncio } from '../meta/client';
import type { BancoDeDados } from '../compartilhado/tipos';

/** Cache das contas de anúncio do Meta (migration 0032). */
export class ContaAnuncioCacheRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** As contas salvas no último sync, já na ordem em que a tela mostra. */
  async listar(): Promise<ContaAnuncio[]> {
    const rows = await this.db.select().from(contasAnuncioCache);
    return rows
      .map((r) => ({
        id:             r.id,
        accountId:      r.accountId,
        nome:           r.nome,
        cliente:        r.cliente,
        moeda:          r.moeda,
        status:         r.status,
        ativa:          r.ativa,
        temPagamento:   r.temPagamento,
        formaPagamento: r.formaPagamento,
      }))
      // Ordena aqui, e não no ORDER BY: a collation do banco joga nome acentuado
      // ("Ótica", "Água") para o fim da lista.
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Quando a lista inteira foi sincronizada (null = nunca). */
  async getSync(): Promise<{ sincronizadoEm: Date; erro: string | null } | null> {
    const [row] = await this.db.select().from(contasAnuncioCacheSync)
      .where(eq(contasAnuncioCacheSync.id, 1));
    return row ? { sincronizadoEm: row.sincronizadoEm, erro: row.erro } : null;
  }

  /**
   * Substitui o cache pela lista recém-lida na Meta.
   *
   * Numa transação: some quem saiu do BM, entra/atualiza o resto e o carimbo de
   * sincronização — assim ninguém lê um estado pela metade.
   */
  async salvar(contas: ContaAnuncio[]): Promise<Date> {
    const agora = new Date();

    await this.db.transaction(async (tx) => {
      const ids = contas.map((c) => c.id);
      await tx.delete(contasAnuncioCache).where(
        ids.length > 0 ? notInArray(contasAnuncioCache.id, ids) : undefined,
      );

      if (contas.length > 0) {
        await tx.insert(contasAnuncioCache)
          .values(contas.map((c) => ({
            id:             c.id,
            accountId:      c.accountId,
            nome:           c.nome,
            cliente:        c.cliente,
            moeda:          c.moeda,
            status:         c.status,
            ativa:          c.ativa,
            temPagamento:   c.temPagamento,
            formaPagamento: c.formaPagamento,
            atualizadoEm:   agora,
          })))
          .onConflictDoUpdate({
            target: contasAnuncioCache.id,
            set: {
              accountId:      sql`excluded.account_id`,
              nome:           sql`excluded.nome`,
              cliente:        sql`excluded.cliente`,
              moeda:          sql`excluded.moeda`,
              status:         sql`excluded.status`,
              ativa:          sql`excluded.ativa`,
              temPagamento:   sql`excluded.tem_pagamento`,
              formaPagamento: sql`excluded.forma_pagamento`,
              atualizadoEm:   agora,
            },
          });
      }

      await tx.insert(contasAnuncioCacheSync)
        .values({ id: 1, sincronizadoEm: agora, erro: null })
        .onConflictDoUpdate({
          target: contasAnuncioCacheSync.id,
          set:    { sincronizadoEm: agora, erro: null },
        });
    });

    return agora;
  }

  /**
   * Marca que o sync falhou, sem apagar o cache: é melhor mostrar a lista de 40
   * min atrás do que uma tela vazia porque a Meta estava fora do ar.
   *
   * De propósito só ATUALIZA: sem sync anterior não existe lista antiga para
   * exibir, e criar o registro aqui faria a próxima consulta achar que o cache
   * está fresco e devolver "nenhuma conta" em vez do erro.
   */
  async registrarErro(erro: string): Promise<void> {
    await this.db.update(contasAnuncioCacheSync)
      .set({ erro })
      .where(eq(contasAnuncioCacheSync.id, 1));
  }
}
