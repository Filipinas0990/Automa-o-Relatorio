import './env';
import bcrypt from 'bcrypt';
import { db } from './database/db';
import { gestoresTrafego, farmacias, coletas, coletaCanais } from './database/schema';

const CANAIS = ['Google', 'Facebook', 'Grupos de Oferta', 'WhatsApp', 'Indicação'];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function diasAtras(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0];
}

async function seed() {
  console.log('🌱 Iniciando seed...');

  // Limpa dados anteriores (ordem respeitando foreign keys)
  await db.delete(coletaCanais);
  await db.delete(coletas);
  await db.delete(farmacias);
  await db.delete(gestoresTrafego);
  console.log('🗑️  Dados anteriores removidos');

  // ── Gestores ──────────────────────────────────────────────────────────────
  const senhaHash = await bcrypt.hash('admin123', 10);

  const [gestorAdmin] = await db.insert(gestoresTrafego).values({
    nome:      'Admin Teste',
    email:     'admin@teste.com',
    senhaHash,
    isAdmin:   true,
  }).returning();

  const [gestorJoao] = await db.insert(gestoresTrafego).values({
    nome:      'João Silva',
    email:     'joao@teste.com',
    senhaHash: await bcrypt.hash('senha123', 10),
    isAdmin:   false,
  }).returning();

  console.log(`✅ Gestores criados: ${gestorAdmin.id}, ${gestorJoao.id}`);

  // ── Farmácias ─────────────────────────────────────────────────────────────
  const dadosFarmacias = [
    { nome: 'Farmácia Saúde Total',    cidade: 'São Paulo',     gestorId: gestorAdmin.id, metaReceita: '45000', metaLeadsGoogle: 80, metaLeadsMeta: 50 },
    { nome: 'Drogaria Bem Estar',      cidade: 'Campinas',      gestorId: gestorAdmin.id, metaReceita: '32000', metaLeadsGoogle: 60, metaLeadsMeta: 40 },
    { nome: 'Farmácia Popular Plus',   cidade: 'Ribeirão Preto',gestorId: gestorJoao.id,  metaReceita: '28000', metaLeadsGoogle: 50, metaLeadsMeta: 30 },
    { nome: 'Drogaria Central',        cidade: 'Sorocaba',      gestorId: gestorJoao.id,  metaReceita: '20000', metaLeadsGoogle: 40, metaLeadsMeta: 25 },
    { nome: 'Farmácia Vida & Saúde',   cidade: 'Santos',        gestorId: gestorAdmin.id, metaReceita: '38000', metaLeadsGoogle: 70, metaLeadsMeta: 45 },
  ];

  const farmaciasInseridas = await db.insert(farmacias).values(
    dadosFarmacias.map(f => ({
      nome:            f.nome,
      gestorId:        f.gestorId,
      ativa:           true,
      temChatbot:      true,
      fase:            'ativo' as const,
      cidade:          f.cidade,
      metaReceita:     f.metaReceita,
      metaLeadsGoogle: f.metaLeadsGoogle,
      metaLeadsMeta:   f.metaLeadsMeta,
    }))
  ).returning();

  console.log(`✅ Farmácias criadas: ${farmaciasInseridas.map(f => f.id).join(', ')}`);

  // ── Coletas (últimas 8 semanas, períodos 7/15/30 dias) ───────────────────
  for (const farmacia of farmaciasInseridas) {
    for (let semana = 7; semana >= 0; semana--) {
      const fimDate    = diasAtras(semana * 7);
      const inicio7    = diasAtras(semana * 7 + 7);
      const inicio15   = diasAtras(semana * 7 + 15);
      const inicio30   = diasAtras(semana * 7 + 30);

      const baseReceita   = parseFloat(farmacia.metaReceita ?? '30000');
      const variacao      = (Math.random() * 0.4) - 0.15; // -15% a +25%
      const receitaTotal  = Math.round(baseReceita * (1 + variacao) * 100) / 100;
      const vendas        = rand(80, 250);
      const gLeads        = rand(30, (farmacia.metaLeadsGoogle ?? 60) + 20);
      const fbLeads       = rand(20, (farmacia.metaLeadsMeta   ?? 40) + 15);
      const grupos        = rand(10, 60);
      const totalAtend    = gLeads + fbLeads + grupos + rand(5, 20);

      const atingiuMeta   = receitaTotal >= baseReceita;
      const nivelAlerta   = receitaTotal >= baseReceita * 0.9 ? 'verde'
                          : receitaTotal >= baseReceita * 0.7 ? 'amarelo' : 'vermelho';

      for (const [periodo, inicio] of [[7, inicio7], [15, inicio15], [30, inicio30]] as [number, Date][]) {
        const [coleta] = await db.insert(coletas).values({
          farmaciaId:           farmacia.id,
          periodoInicio:        toDateStr(inicio),
          periodoFim:           toDateStr(fimDate),
          periodoDias:          periodo,
          clientesGoogle:       gLeads,
          clientesFacebook:     fbLeads,
          clientesGruposOferta: grupos,
          totalAtendimentos:    totalAtend,
          vendasRealizadas:     vendas,
          receitaTotal:         String(receitaTotal * (periodo / 7)),
          scoreCriticidade:     String(rand(20, 95)),
          nivelAlerta:          nivelAlerta as 'verde' | 'amarelo' | 'vermelho',
          variacaoGoogle:       String(rand(-20, 30)),
          variacaoFacebook:     String(rand(-15, 25)),
          variacaoGrupos:       String(rand(-10, 20)),
          variacaoVendas:       String(rand(-18, 28)),
          variacaoReceita:      String(Math.round(variacao * 100)),
          atingiuMeta,
          atingiuMetaGoogle:    gLeads   >= (farmacia.metaLeadsGoogle ?? 0),
          atingiuMetaMeta:      fbLeads  >= (farmacia.metaLeadsMeta   ?? 0),
        }).returning();

        // canais
        const totalCanais = gLeads + fbLeads + grupos;
        await db.insert(coletaCanais).values([
          { coletaId: coleta.id, canal: 'Google',          atendimentos: gLeads,  vendas: Math.round(vendas * gLeads / totalCanais),  receitaVendas: String(Math.round(receitaTotal * 0.45)) },
          { coletaId: coleta.id, canal: 'Facebook',        atendimentos: fbLeads, vendas: Math.round(vendas * fbLeads / totalCanais), receitaVendas: String(Math.round(receitaTotal * 0.30)) },
          { coletaId: coleta.id, canal: 'Grupos de Oferta',atendimentos: grupos,  vendas: Math.round(vendas * grupos / totalCanais),  receitaVendas: String(Math.round(receitaTotal * 0.15)) },
          { coletaId: coleta.id, canal: 'Indicação',       atendimentos: rand(5, 15), vendas: rand(3, 10), receitaVendas: String(rand(500, 2000)) },
        ]);
      }
    }
    console.log(`  📊 Coletas inseridas para: ${farmacia.nome}`);
  }

  console.log('\n✅ Seed concluído!');
  console.log('   Login admin: admin@teste.com / admin123');
  console.log('   Login gestor: joao@teste.com / senha123');
  process.exit(0);
}

seed().catch(err => { console.error('❌ Seed falhou:', err); process.exit(1); });
