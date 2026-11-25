/**
 * TRAVA DE ENVIO — quem pode mexer no WhatsApp de verdade.
 *
 * INCIDENTE 24/11/2026: 36 imagens de uma campanha encerrada em 08/11 caíram
 * no grupo da Farmácia Noturna pela conexão da Anielly. O servidor não fez a
 * chamada (banco, API, motor e fila do Redis limpos no horário). Foi uma CÓPIA
 * do PharmaFlow em outro computador: a .env de desenvolvimento apontava para
 * a Evolution de produção, com a mesma chave — e a Evolution não sabe a
 * diferença entre o servidor e um notebook.
 *
 * A regra: só mexe no WhatsApp o processo que tem `WHATSAPP_ENVIO_REAL=true`.
 * É opt-in de propósito: uma .env copiada, antiga ou esquecida cai no modo
 * teste. O valor fica SÓ na .env do servidor.
 *
 * No modo teste o sistema funciona inteiro — telas, agendamento, histórico —
 * mas toda chamada que MUDA algo no WhatsApp é simulada (ver ClienteEvolution):
 * enviar mensagem, conectar, desconectar, criar ou apagar conexão. Consultas
 * (status da conexão, lista de grupos) passam, para a tela continuar útil.
 */

/** Nome da variável — está aqui para o log e a documentação citarem o mesmo. */
export const VARIAVEL_ENVIO_REAL = 'WHATSAPP_ENVIO_REAL';

/** Só "true" liga (sem diferenciar maiúsculas). Ausente ou qualquer outro valor = modo teste. */
export function envioRealLigado(env: Record<string, string | undefined> = process.env): boolean {
  return (env[VARIAVEL_ENVIO_REAL] ?? '').trim().toLowerCase() === 'true';
}

/** O que os clientes HTTP precisam saber para decidir se a chamada sai. */
export interface PoliticaDeEnvio {
  /** true = este processo pode mexer no WhatsApp de verdade. */
  envioReal(): boolean;
}

/** Política de produção: lê o ambiente a cada chamada. */
export class EnvioPorAmbiente implements PoliticaDeEnvio {
  envioReal(): boolean {
    return envioRealLigado();
  }
}

/**
 * Chamadas à Evolution que só LEEM — liberadas mesmo no modo teste.
 *
 * Lista de permissão, e não de bloqueio: rota nova da Evolution que alguém
 * passar a usar fica travada no modo teste até ser conferida e entrar aqui.
 * Errar para o lado de não mandar é o lado seguro.
 */
const CONSULTAS: ReadonlyArray<{ metodo: string; prefixo: string }> = [
  { metodo: 'GET', prefixo: '/instance/connectionState/' },
  { metodo: 'GET', prefixo: '/instance/fetchInstances' },
  { metodo: 'GET', prefixo: '/group/fetchAllGroups/' },
];

export function ehConsulta(metodo: string, caminho: string): boolean {
  const m = metodo.toUpperCase();
  return CONSULTAS.some((c) => c.metodo === m && caminho.startsWith(c.prefixo));
}
