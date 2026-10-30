export interface DadosLinkAgenda {
  titulo: string;
  descricao?: string | null;
  dataReuniao: Date | string;
  duracaoMinutos?: number | null;
  local?: string | null;
  linkMeet?: string | null;
}

/** Link "Adicionar ao Google Calendar" — abre no navegador, não precisa de OAuth. */
export class LinkAgendaGoogle {
  static gerar(r: DadosLinkAgenda): string {
    const inicio = new Date(r.dataReuniao);
    const fim    = new Date(inicio.getTime() + (r.duracaoMinutos ?? 60) * 60_000);
    const detalhes = [r.descricao, r.linkMeet ? `\nLink da reunião: ${r.linkMeet}` : '']
      .filter(Boolean).join('');
    const p = new URLSearchParams({
      action:   'TEMPLATE',
      text:     r.titulo,
      dates:    `${LinkAgendaGoogle.data(inicio)}/${LinkAgendaGoogle.data(fim)}`,
      details:  detalhes,
      location: r.local ?? '',
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  /** Mesmo link, a partir de uma linha crua do banco (colunas em snake_case). */
  static daLinha(r: {
    titulo: string; descricao?: string | null; data_reuniao: Date | string;
    duracao_minutos?: number | null; local?: string | null; link_meet?: string | null;
  }): string {
    return LinkAgendaGoogle.gerar({
      titulo:         r.titulo,
      descricao:      r.descricao,
      dataReuniao:    r.data_reuniao,
      duracaoMinutos: r.duracao_minutos,
      local:          r.local,
      linkMeet:       r.link_meet,
    });
  }

  /** 20261007T143000Z */
  private static data(d: Date): string {
    return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  }
}
