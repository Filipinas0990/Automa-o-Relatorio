/** Período livre do painel (mês fechado, de/até) — regra pura, sem banco. */
import { describe, it, expect } from 'vitest';
import { diasNoIntervalo, intervaloAnterior, lerIntervalo } from '../src/farmacias/periodo';
import { RequisicaoInvalida } from '../src/compartilhado/erros';

describe('Período livre', () => {
  it('sem inicio e fim a tela segue nas janelas 7/15/30', () => {
    expect(lerIntervalo()).toBeNull();
  });

  it('mês fechado compara com o mês anterior inteiro', () => {
    expect(intervaloAnterior({ inicio: '2026-09-01', fim: '2026-09-30' }))
      .toEqual({ inicio: '2026-08-01', fim: '2026-08-31' });
    expect(intervaloAnterior({ inicio: '2026-03-01', fim: '2026-03-31' }))
      .toEqual({ inicio: '2026-02-01', fim: '2026-02-28' });
  });

  it('de/até compara com os mesmos N dias logo antes', () => {
    expect(diasNoIntervalo({ inicio: '2026-10-10', fim: '2026-10-19' })).toBe(10);
    expect(intervaloAnterior({ inicio: '2026-10-10', fim: '2026-10-19' }))
      .toEqual({ inicio: '2026-09-30', fim: '2026-10-09' });
    // mês pela metade não é mês fechado
    expect(intervaloAnterior({ inicio: '2026-09-01', fim: '2026-09-15' }))
      .toEqual({ inicio: '2026-08-17', fim: '2026-08-31' });
  });

  it('recusa data inválida, invertida ou período longo demais', () => {
    expect(() => lerIntervalo('2026-09-01')).toThrow(RequisicaoInvalida);
    expect(() => lerIntervalo('01/09/2026', '2026-09-30')).toThrow(RequisicaoInvalida);
    expect(() => lerIntervalo('2026-09-30', '2026-09-01')).toThrow(/depois/);
    expect(() => lerIntervalo('2026-06-01', '2026-10-27')).toThrow(/93 dias/);
    expect(lerIntervalo('2026-08-01', '2026-10-31')).toEqual({ inicio: '2026-08-01', fim: '2026-10-31' });
  });
});
