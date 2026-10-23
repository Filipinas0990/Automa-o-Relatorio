import './env';
import { readFileSync } from 'fs';
import { importacaoColetaService } from './composicao';

/**
 * Importa o arquivo agregado da coleta do PharmaChatbot (gerado pela skill
 * `coletar-pharmachatbot` no Claude Code, com o login do engine-prod) para as
 * tabelas coletas / coleta_canais. Rodar de novo com o mesmo período troca os
 * números, não duplica.
 *
 * Uso:
 *   npm run importar-coleta -- /caminho/coleta-2026-10-22.json
 *   (no servidor: docker exec farmacia_api node dist/importar-coleta.js /tmp/coleta.json)
 */
async function importar() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error('❌ Informe o arquivo da coleta.');
    console.error('   Ex: npm run importar-coleta -- /tmp/coleta-2026-10-22.json');
    process.exit(1);
  }

  let conteudo: unknown;
  try {
    conteudo = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (err) {
    console.error(`❌ Não consegui ler o JSON em ${caminho}: ${(err as Error).message}`);
    process.exit(1);
  }

  const r = await importacaoColetaService.importar(conteudo);
  console.log(`✅ Período até ${r.periodo_fim}: ${r.coletas_gravadas} coletas gravadas para ${r.farmacias} farmácias.`);
  if (r.vinculadas_zeradas.length) {
    console.log(`⚠️  Vinculadas sem nenhum atendimento (gravadas zeradas): ${r.vinculadas_zeradas.join(', ')}`);
  }
  if (r.sem_vinculo.length) {
    console.log(`ℹ️  ${r.sem_vinculo.length} empresas com atendimento e sem farmácia vinculada (30 dias):`);
    for (const e of r.sem_vinculo.slice(0, 30)) console.log(`   ${e.tenant} · company_id ${e.company_id} · ${e.atendimentos} atendimentos`);
  }
  process.exit(0);
}

importar().catch((err) => {
  console.error('❌ Falhou:', (err as Error).message);
  process.exit(1);
});
