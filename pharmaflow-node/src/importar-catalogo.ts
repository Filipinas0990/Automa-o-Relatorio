import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { upsertProduto, contarProdutos } from './catalogo/repository';

/**
 * Importa uma pasta de imagens PNG para o catálogo de produtos.
 *
 * O NOME DO ARQUIVO vira o nome do produto (sem a extensão).
 * Ex.:  "Paracetamol 750mg 20 comprimidos.png"  ->  produto "Paracetamol 750mg 20 comprimidos"
 *
 * Uso:
 *   npm run importar-catalogo -- /caminho/para/pasta-de-imagens
 */

const MIME_POR_EXT: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function importar() {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error('❌ Informe a pasta das imagens.');
    console.error('   Ex: npm run importar-catalogo -- /home/filipe/imagens-produtos');
    process.exit(1);
  }

  let arquivos: string[];
  try {
    arquivos = readdirSync(pasta);
  } catch {
    console.error(`❌ Não consegui ler a pasta: ${pasta}`);
    process.exit(1);
  }

  const imagens = arquivos.filter((f) => MIME_POR_EXT[extname(f).toLowerCase()]);
  if (imagens.length === 0) {
    console.error('❌ Nenhuma imagem (.png/.jpg/.jpeg/.webp) encontrada na pasta.');
    process.exit(1);
  }

  console.log(`📦 ${imagens.length} imagens encontradas. Importando...`);

  let ok = 0;
  let erro = 0;
  for (const arquivo of imagens) {
    const ext   = extname(arquivo).toLowerCase();
    const nome  = basename(arquivo, ext).trim();
    const mime  = MIME_POR_EXT[ext];
    try {
      const b64 = readFileSync(join(pasta, arquivo)).toString('base64');
      await upsertProduto(nome, b64, mime);
      ok++;
      process.stdout.write(`  ✅ ${nome}\n`);
    } catch (e) {
      erro++;
      console.error(`  ❌ Falha em "${nome}":`, (e as Error).message);
    }
  }

  const total = await contarProdutos();
  console.log(`\n✅ Importação concluída: ${ok} ok, ${erro} erro(s).`);
  console.log(`   Catálogo agora tem ${total} produtos.`);
  process.exit(0);
}

importar().catch((err) => {
  console.error('❌ Importação falhou:', err);
  process.exit(1);
});
