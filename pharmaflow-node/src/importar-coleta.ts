import './env';
import { readFileSync } from 'fs';
import { importacaoColetaService, importacaoDiariaService } from './composicao';
import { ehArquivoDiario } from './coleta/ImportacaoDiariaService';
import type { ResumoImportacao } from './coleta/contratos';

/**
 * Importa o arquivo da coleta do PharmaChatbot (gerado pela skill
 * `coletar-pharmachatbot` no Claude Code, com o login do engine-prod).
 *
 * Dois formatos:
 * - diário (`inicio`, `fim`, linhas com `dia`): troca esses dias em
 *   coleta_diaria e recalcula as janelas 7/15/30 — é o formato atual;
 * - antigo (`periodo_fim`, linhas com `dias`/`momento`): grava só as janelas.
 * Rodar de novo com o mesmo período troca os números, não duplica.
 *
 * Uso:
 *   npm run importar-coleta -- /caminho/coleta-2026-10-27.json
 *   (no servidor: docker exec farmacia_api node dist/importar-coleta.js /tmp/coleta.json)
 */
async function importar() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error('❌ Informe o arquivo da coleta.');
    console.error('   Ex: npm run importar-coleta -- /tmp/coleta-2026-10-27.json');
    process.exit(1);
  }

  let conteudo: unknown;
  try {
    conteudo = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (err) {
    console.error(`❌ Não consegui ler o JSON em ${caminho}: ${(err as Error).message}`);
    process.exit(1);
  }

  if (ehArquivoDiario(conteudo)) {
    const r = await importacaoDiariaService.importar(conteudo);
    console.log(`✅ Dias ${r.inicio} a ${r.fim}: ${r.dias_gravados} linhas diárias gravadas para ${r.farmacias} farmácias.`);
    if (r.vinculadas_zeradas.length) {
      console.log(`⚠️  Vinculadas sem nenhum atendimento no intervalo: ${r.vinculadas_zeradas.join(', ')}`);
    }
    if (r.sem_vinculo.length) {
      console.log(`ℹ️  ${r.sem_vinculo.length} empresas com atendimento e sem farmácia vinculada:`);
      for (const e of r.sem_vinculo.slice(0, 30)) console.log(`   ${e.tenant} · company_id ${e.company_id} · ${e.atendimentos} atendimentos`);
    }
    console.log(`✅ Janelas 7/15/30 até ${r.janelas.periodo_fim}: ${r.janelas.coletas_gravadas} coletas recalculadas.`);
    process.exit(0);
  }

  relatarJanelas(await importacaoColetaService.importar(conteudo));
  process.exit(0);
}

function relatarJanelas(r: ResumoImportacao) {
  console.log(`✅ Período até ${r.periodo_fim}: ${r.coletas_gravadas} coletas gravadas para ${r.farmacias} farmácias.`);
  if (r.vinculadas_zeradas.length) {
    console.log(`⚠️  Vinculadas sem nenhum atendimento (gravadas zeradas): ${r.vinculadas_zeradas.join(', ')}`);
  }
  if (r.sem_vinculo.length) {
    console.log(`ℹ️  ${r.sem_vinculo.length} empresas com atendimento e sem farmácia vinculada (30 dias):`);
    for (const e of r.sem_vinculo.slice(0, 30)) console.log(`   ${e.tenant} · company_id ${e.company_id} · ${e.atendimentos} atendimentos`);
  }
}

importar().catch((err) => {
  console.error('❌ Falhou:', (err as Error).message);
  process.exit(1);
});
