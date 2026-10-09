import type { Gestor } from '../database/schema';
import { Mes } from '../compartilhado/Mes';
import type { CoberturaRepository } from './CoberturaRepository';

/** % de farmácias que tiveram reunião, com uma casa decimal. */
function taxa(com: number, total: number): number {
  return total > 0 ? Math.round(com / total * 1000) / 10 : 0;
}

/**
 * Gerenciador de reuniões: quais farmácias tiveram reunião no mês e o
 * histórico de cobertura. Gestor comum vê só as farmácias dele.
 */
export class CoberturaService {
  constructor(private readonly cobertura: CoberturaRepository) {}

  /** KPIs do mês e as farmácias separadas em com/sem reunião. */
  async doMes(quem: Gestor, mesPedido: string | undefined) {
    const mes = Mes.daQuery(mesPedido);
    const [farmacias, reunioes] = await Promise.all([
      this.cobertura.farmacias(quem.isAdmin ? null : quem.id),
      this.cobertura.reunioesDoMes(mes),
    ]);

    const porFarmacia = new Map<number, ReturnType<typeof this.reuniao>[]>();
    for (const r of reunioes) {
      const fid = parseInt(r.farmacia_id);
      if (!porFarmacia.has(fid)) porFarmacia.set(fid, []);
      porFarmacia.get(fid)!.push(this.reuniao(r));
    }

    const comReuniao = [];
    const semReuniao = [];
    for (const f of farmacias) {
      const fid   = parseInt(f.id);
      const lista = porFarmacia.get(fid) ?? [];
      const base = {
        farmacia_id:   fid,
        farmacia_nome: f.nome,
        cidade:        f.cidade      ?? null,
        responsavel:   f.responsavel ?? null,
        telefone:      f.telefone    ?? null,
        gestor_id:     f.gestor_id   ? parseInt(f.gestor_id) : null,
        gestor_nome:   f.gestor_nome ?? null,
        nivel_alerta:  f.nivel_alerta,
      };
      if (!lista.length) { semReuniao.push(base); continue; }
      comReuniao.push({
        ...base,
        total_reunioes: lista.length,
        realizadas:     lista.filter((r) => r.status === 'realizada').length,
        confirmadas:    lista.filter((r) => r.status === 'confirmada').length,
        agendadas:      lista.filter((r) => r.status === 'agendada').length,
        reunioes:       lista,
      });
    }

    return {
      mes,
      total_farmacias_ativas: farmacias.length,
      farmacias_com_reuniao:  comReuniao.length,
      farmacias_sem_reuniao:  semReuniao.length,
      taxa_cobertura:         taxa(comReuniao.length, farmacias.length),
      com_reuniao:            comReuniao,
      sem_reuniao:            semReuniao,
    };
  }

  /** Cobertura mês a mês (1 a 24 meses, padrão 6), incluindo meses sem reunião. */
  async historico(quem: Gestor, mesesPedidos: string | undefined) {
    const nMeses   = Math.min(Math.max(parseInt(mesesPedidos || '6'), 1), 24);
    const gestorId = quem.isAdmin ? null : quem.id;
    const [total, linhas] = await Promise.all([
      this.cobertura.totalFarmacias(gestorId),
      this.cobertura.porMes(nMeses, gestorId),
    ]);

    const meses = new Map<string, {
      mes: string; total_farmacias: number;
      farmacias_com_reuniao: number; farmacias_sem_reuniao: number;
      taxa_cobertura: number; total_reunioes: number;
      realizadas: number; confirmadas: number; agendadas: number;
    }>();
    const agora = new Date();
    for (let i = nMeses - 1; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      meses.set(m, {
        mes: m, total_farmacias: total,
        farmacias_com_reuniao: 0, farmacias_sem_reuniao: total,
        taxa_cobertura: 0, total_reunioes: 0,
        realizadas: 0, confirmadas: 0, agendadas: 0,
      });
    }

    for (const row of linhas) {
      const m = meses.get(row.mes);
      if (!m) continue;
      const com = parseInt(row.farmacias_com_reuniao || 0);
      m.farmacias_com_reuniao = com;
      m.farmacias_sem_reuniao = Math.max(0, total - com);
      m.taxa_cobertura        = taxa(com, total);
      m.total_reunioes        = parseInt(row.total_reunioes || 0);
      m.realizadas            = parseInt(row.realizadas     || 0);
      m.confirmadas           = parseInt(row.confirmadas    || 0);
      m.agendadas             = parseInt(row.agendadas      || 0);
    }

    return { total_farmacias_ativas: total, historico: [...meses.values()] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private reuniao(r: Record<string, any>) {
    return {
      id:              parseInt(r.id),
      titulo:          r.titulo as string,
      data_reuniao:    r.data_reuniao,
      duracao_minutos: parseInt(r.duracao_minutos || 60),
      status:          r.status as string,
      observacoes:     r.observacoes ?? null,
      gestor_id:       r.gestor_id   ? parseInt(r.gestor_id) : null,
      gestor_nome:     r.gestor_nome ?? null,
    };
  }
}
