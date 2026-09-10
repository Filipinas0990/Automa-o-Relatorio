import { and, eq, lte, desc, sql, notInArray } from 'drizzle-orm';
import { db } from '../database/db';
import {
  gestorWhatsapp, disparosGrupo, disparosGrupoLog, gruposCache, gruposCacheSync,
  horariosDisparo, farmacias,
} from '../database/schema';
import type {
  GestorWhatsapp, DisparoGrupo, GrupoCache, HorarioDisparo,
} from '../database/schema';

export type InstanciaStatus = 'open' | 'close' | 'connecting';

export const disparosRepository = {

  // ── Instância Evolution do gestor ──────────────────────────────────────────

  async getInstancia(gestorId: number): Promise<GestorWhatsapp | null> {
    const [row] = await db.select().from(gestorWhatsapp)
      .where(eq(gestorWhatsapp.gestorId, gestorId));
    return row ?? null;
  },

  async criarInstancia(data: {
    gestorId:     number;
    instanceName: string;
    status:       InstanciaStatus;
    qrCode:       string | null;
  }): Promise<GestorWhatsapp> {
    const [row] = await db.insert(gestorWhatsapp).values(data).returning();
    return row;
  },

  async atualizarInstancia(
    id:     number,
    campos: Partial<{ status: InstanciaStatus; qrCode: string | null; numeroConectado: string | null }>,
  ): Promise<void> {
    await db.update(gestorWhatsapp)
      .set({ ...campos, atualizadoEm: sql`NOW()` })
      .where(eq(gestorWhatsapp.id, id));
  },

  // ── Disparos ───────────────────────────────────────────────────────────────

  async criarDisparo(data: {
    gestorId:      number;
    instanceName:  string | null;
    titulo:        string;
    mensagem:      string;
    midiasJson:    string | null;
    produtosJson:  string | null;
    farmaciaId:    number | null;
    solicitacaoId: number | null;
    gruposJson:   string;
    quando:       'agora' | 'agendado';
    agendadoPara: Date | null;
    repetir:      'nunca' | 'diario' | 'semanal' | 'mensal';
    horariosJson: string | null;
    repetirAte:   Date | null;
    repetirProdutos: boolean;
    timezone:     string;
    status:       string;
    proximoEnvio: Date | null;
  }): Promise<DisparoGrupo> {
    const [row] = await db.insert(disparosGrupo).values(data).returning();
    return row;
  },

  /**
   * Produtos do último disparo daquele cliente — alimenta o chip "Recentes".
   *
   * Escopado por gestor E por farmácia: sem o gestorId, um gestor veria o que
   * outro anunciou para um cliente que não é dele.
   *
   * Ignora disparo cancelado (não foi ao ar) e os anteriores à migration 0029
   * (produtos_json NULL). Um disparo agendado que ainda não saiu CONTA: para
   * quem está montando a próxima campanha, o que já está na fila é tão
   * relevante quanto o que já foi.
   */
  async ultimosProdutosDaFarmacia(
    gestorId:   number,
    farmaciaId: number,
  ): Promise<{ produtosJson: string; criadoEm: Date | null } | null> {
    const [row] = await db
      .select({ produtosJson: disparosGrupo.produtosJson, criadoEm: disparosGrupo.criadoEm })
      .from(disparosGrupo)
      .where(and(
        eq(disparosGrupo.gestorId, gestorId),
        eq(disparosGrupo.farmaciaId, farmaciaId),
        sql`${disparosGrupo.produtosJson} IS NOT NULL`,
        sql`${disparosGrupo.status} <> 'cancelado'`,
      ))
      .orderBy(desc(disparosGrupo.criadoEm))
      .limit(1);
    return row?.produtosJson ? { produtosJson: row.produtosJson, criadoEm: row.criadoEm } : null;
  },

  /**
   * A quem cada um destes grupos JÁ pertenceu, segundo o histórico de disparos
   * do próprio gestor.
   *
   * INCIDENTE 2026-08-29: a Farma Fátima (cadastrada como "M.R CARDOSO
   * DROGARIA", sem nome de fachada) não casa por nome com o grupo dela, então
   * a pré-seleção não marca nada e o gestor escolhe na mão numa lista com
   * TODOS os grupos. Ele marcou o "Grupo VIP Drogaria mais Saúde" — de outro
   * cliente — em 8 disparos seguidos, e a oferta de um caiu no grupo do outro.
   *
   * Nome não resolve (73 das 86 farmácias estão sem fachada), mas o histórico
   * sim: esse grupo já tinha recebido 4 disparos da Mais Saúde. Quem já usou o
   * grupo é um fato, não um palpite — é isso que o modal mostra antes de
   * confirmar. Disparo cancelado não conta: não foi ao ar.
   */
  async donosDeGrupos(
    gestorId: number,
    jids:     string[],
  ): Promise<{ jid: string; farmaciaId: number; nome: string; nomeFachada: string | null }[]> {
    if (jids.length === 0) return [];

    const lista = sql.join(jids.map((j) => sql`${j}`), sql`, `);

    const resultado = await db.execute<{
      jid: string; farmacia_id: number; nome: string; nome_fachada: string | null;
    }>(sql`
      SELECT el->>'jid'   AS jid,
             d.farmacia_id AS farmacia_id,
             f.nome        AS nome,
             f.nome_fachada AS nome_fachada
      FROM ${disparosGrupo} d
      JOIN ${farmacias} f ON f.id = d.farmacia_id
      CROSS JOIN LATERAL jsonb_array_elements(d.grupos_json::jsonb) el
      WHERE d.gestor_id = ${gestorId}
        AND d.status <> 'cancelado'
        AND el->>'jid' IN (${lista})
      GROUP BY 1, 2, 3, 4
    `);

    return resultado.rows.map((r) => ({
      jid:         r.jid,
      farmaciaId:  Number(r.farmacia_id),
      nome:        r.nome,
      nomeFachada: r.nome_fachada,
    }));
  },

  async getDisparo(id: number): Promise<DisparoGrupo | null> {
    const [row] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
    return row ?? null;
  },

  /** Disparos do gestor, mais recentes primeiro. */
  async listarDisparos(gestorId: number): Promise<DisparoGrupo[]> {
    return db.select().from(disparosGrupo)
      .where(eq(disparosGrupo.gestorId, gestorId))
      .orderBy(desc(disparosGrupo.criadoEm))
      .limit(100);
  },

  /** Agendados cuja hora já chegou — usado pelo scheduler. */
  async buscarDisparosPendentes(agora: Date): Promise<DisparoGrupo[]> {
    return db.select().from(disparosGrupo).where(
      and(
        eq(disparosGrupo.status, 'agendado'),
        lte(disparosGrupo.proximoEnvio, agora),
      ),
    );
  },

  async atualizarDisparo(
    id:     number,
    campos: Partial<{
      status: string; proximoEnvio: Date | null; ultimoEnvio: Date | null; cursorMidia: number;
    }>,
  ): Promise<void> {
    await db.update(disparosGrupo)
      .set({ ...campos, atualizadoEm: sql`NOW()` })
      .where(eq(disparosGrupo.id, id));
  },

  async registrarLog(data: {
    disparoId: number;
    grupoJid:  string;
    grupoNome: string | null;
    status:    'ok' | 'erro';
    erro:      string | null;
  }): Promise<void> {
    await db.insert(disparosGrupoLog).values(data);
  },

  async logsDoDisparo(disparoId: number) {
    return db.select().from(disparosGrupoLog)
      .where(eq(disparosGrupoLog.disparoId, disparoId))
      .orderBy(desc(disparosGrupoLog.enviadoEm));
  },

  // ── Horários pré-definidos (migration 0022) ────────────────────────────────

  async listarHorarios(gestorId: number): Promise<HorarioDisparo[]> {
    return db.select().from(horariosDisparo)
      .where(eq(horariosDisparo.gestorId, gestorId))
      .orderBy(horariosDisparo.horario);
  },

  /** Cria (ou ignora, se aquele horário já estiver na lista). */
  async criarHorario(gestorId: number, horario: string, rotulo: string | null): Promise<void> {
    await db.insert(horariosDisparo)
      .values({ gestorId, horario, rotulo })
      .onConflictDoNothing();
  },

  /** Semeia os horários padrão — só na primeira vez que o gestor abre a lista. */
  async criarHorariosPadrao(gestorId: number, horarios: string[]): Promise<void> {
    if (horarios.length === 0) return;
    await db.insert(horariosDisparo)
      .values(horarios.map((horario) => ({ gestorId, horario, rotulo: null })))
      .onConflictDoNothing();
  },

  /** Remove, mas só se o horário for daquele gestor. */
  async removerHorario(gestorId: number, id: number): Promise<boolean> {
    const removidos = await db.delete(horariosDisparo)
      .where(and(eq(horariosDisparo.id, id), eq(horariosDisparo.gestorId, gestorId)))
      .returning({ id: horariosDisparo.id });
    return removidos.length > 0;
  },

  // ── Disparos travados ──────────────────────────────────────────────────────

  /**
   * Disparos parados em "enviando" há tempo demais. Acontece quando a API cai
   * no meio do envio, ou quando o callback do motor de campanhas nunca chega:
   * sem isso o disparo fica "enviando" para sempre e ninguém percebe que a
   * oferta não foi ao ar.
   */
  async buscarDisparosTravados(limite: Date): Promise<DisparoGrupo[]> {
    return db.select().from(disparosGrupo).where(
      and(
        eq(disparosGrupo.status, 'enviando'),
        lte(disparosGrupo.atualizadoEm, limite),
      ),
    );
  },

  // ── Cache de grupos (migration 0020) ───────────────────────────────────────

  /** Grupos cacheados de uma instância, já em ordem alfabética. */
  async listarGruposCache(instanceName: string): Promise<GrupoCache[]> {
    return db.select().from(gruposCache)
      .where(eq(gruposCache.instanceName, instanceName))
      .orderBy(gruposCache.nome);
  },

  /** Quando esta instância foi sincronizada por inteiro (null = nunca). */
  async getSyncGrupos(instanceName: string): Promise<{ sincronizadoEm: Date; erro: string | null } | null> {
    const [row] = await db.select().from(gruposCacheSync)
      .where(eq(gruposCacheSync.instanceName, instanceName));
    return row ? { sincronizadoEm: row.sincronizadoEm, erro: row.erro } : null;
  },

  /**
   * Substitui o cache da instância pela lista recém-buscada na Evolution.
   * Numa transação: some quem saiu do WhatsApp, entra/atualiza o resto e o
   * carimbo de sincronização — assim ninguém lê um estado pela metade.
   */
  async salvarGruposCache(
    instanceName: string,
    grupos: { jid: string; nome: string; participantes: number | null }[],
  ): Promise<Date> {
    const agora = new Date();

    await db.transaction(async (tx) => {
      const jids = grupos.map((g) => g.jid);
      await tx.delete(gruposCache).where(
        jids.length > 0
          ? and(eq(gruposCache.instanceName, instanceName), notInArray(gruposCache.jid, jids))
          : eq(gruposCache.instanceName, instanceName),
      );

      if (grupos.length > 0) {
        await tx.insert(gruposCache)
          .values(grupos.map((g) => ({ instanceName, ...g, atualizadoEm: agora })))
          .onConflictDoUpdate({
            target: [gruposCache.instanceName, gruposCache.jid],
            set: {
              nome:          sql`excluded.nome`,
              participantes: sql`excluded.participantes`,
              atualizadoEm:  agora,
            },
          });
      }

      await tx.insert(gruposCacheSync)
        .values({ instanceName, sincronizadoEm: agora, erro: null })
        .onConflictDoUpdate({
          target: gruposCacheSync.instanceName,
          set:    { sincronizadoEm: agora, erro: null },
        });
    });

    return agora;
  },

  /**
   * Marca que a sincronização falhou, sem apagar o cache: é melhor mostrar a
   * lista de 40 min atrás do que uma tela vazia porque a Evolution caiu.
   *
   * De propósito só ATUALIZA: se a instância nunca sincronizou, não existe
   * lista antiga para exibir, e criar o registro aqui faria a próxima consulta
   * achar que o cache está fresco e devolver "nenhum grupo" em vez do erro.
   */
  async registrarErroSyncGrupos(instanceName: string, erro: string): Promise<void> {
    await db.update(gruposCacheSync)
      .set({ erro })
      .where(eq(gruposCacheSync.instanceName, instanceName));
  },
};
