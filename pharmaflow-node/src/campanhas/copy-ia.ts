// Copy padrão da campanha — SEM IA. Montada a partir dos produtos selecionados.
// Usada apenas quando o gestor não escreveu a copy manualmente no wizard.

export interface CopyGerada {
  textoPrincipal: string;
  titulo: string;
  descricao: string;
}

export function gerarCopyPadrao(dados: {
  produtos: string[];
  farmacia?: string;
}): CopyGerada {
  const produtos = dados.produtos.length ? dados.produtos.join(', ') : 'produtos em oferta';
  const nome = dados.farmacia?.trim() || 'nossa farmácia';
  return {
    textoPrincipal:
      `🔥 Ofertas especiais em ${produtos}!\n\n` +
      `Aproveite os preços da ${nome} e cuide da sua saúde.\n` +
      `Chame no WhatsApp e garanta o seu! 💬`,
    titulo:    'Ofertas na sua farmácia',
    descricao: 'Preços que cabem no seu bolso.',
  };
}
