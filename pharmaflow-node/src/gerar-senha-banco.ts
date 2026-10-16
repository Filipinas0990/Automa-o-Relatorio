import { gerarHashSenhaBanco } from './catalogo/SenhaBancoImagens';

/**
 * Gera a linha do .env com a senha do Banco de Imagens.
 *
 * A senha em si não vai para lugar nenhum: só o hash fica no .env do servidor.
 * Para trocar a senha, rode de novo, troque a linha e reinicie o backend.
 *
 * Uso:
 *   npm run senha-banco -- 'minha senha'
 *   node dist/gerar-senha-banco.js 'minha senha'     (no servidor, depois do tsc)
 */
async function main() {
  const senha = process.argv[2];
  if (!senha || senha.length < 8) {
    console.error('❌ Informe a senha (mínimo 8 caracteres).');
    console.error("   Ex: npm run senha-banco -- 'minha senha forte'");
    process.exit(1);
  }
  console.log('Cole esta linha no .env da raiz do projeto e reinicie o backend:\n');
  console.log(`BANCO_IMAGENS_SENHA_HASH=${await gerarHashSenhaBanco(senha)}`);
}

main();
