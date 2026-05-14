"""
Pipeline principal — coleta, processa e salva no banco.
Executado automaticamente todo domingo às 22h via cron/Task Scheduler.
"""

import asyncio
import json
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from farmacia_monitor.scraper.pharmachatbot import coletar_todas
from farmacia_monitor.processor.score import calcular_score, MetricasSemana
from farmacia_monitor.database.db import (
    init_db, SessionLocal, Farmacia, Coleta, ColetaCanal
)
from farmacia_monitor.cripto import carregar_farmacias as _carregar_enc


def carregar_farmacias() -> list[dict]:
    """Le farmacias do banco (senha descriptografada). Fallback para .enc."""
    try:
        from farmacia_monitor.cripto import _fernet
        db = SessionLocal()
        try:
            farmacias = db.query(Farmacia).filter(
                Farmacia.ativa == True,
                Farmacia.senha_enc.isnot(None),
            ).all()
            if farmacias:
                resultado = []
                for f in farmacias:
                    try:
                        senha = _fernet().decrypt(f.senha_enc.encode()).decode()
                    except Exception:
                        senha = ""
                    resultado.append({
                        "nome":     f.nome,
                        "url_base": f.url_base,
                        "email":    f.email,
                        "senha":    senha,
                        "ativa":    f.ativa,
                    })
                return resultado
        finally:
            db.close()
    except Exception:
        pass

    # Fallback: le do arquivo criptografado (antes da migracao)
    return _carregar_enc(os.path.dirname(__file__))


def _coleta_anterior(db, farmacia_id: int) -> Coleta | None:
    return (
        db.query(Coleta)
        .filter(Coleta.farmacia_id == farmacia_id)
        .order_by(Coleta.data_coleta.desc())
        .first()
    )


def salvar_resultados(dados_coletados):
    init_db()
    db = SessionLocal()
    try:
        for dado in dados_coletados:
            if dado.erro:
                print(f"  [ERRO]  {dado.nome}: {dado.erro}")
                continue

            farmacia = db.query(Farmacia).filter(Farmacia.nome == dado.nome).first()
            if not farmacia:
                print(f"  [AVISO] {dado.nome} nao encontrada no banco.")
                continue

            anterior = _coleta_anterior(db, farmacia.id)
            metricas_anterior = None
            if anterior:
                metricas_anterior = MetricasSemana(
                    clientes_google=int(anterior.clientes_google or 0),
                    clientes_facebook=int(anterior.clientes_facebook or 0),
                    clientes_grupos_oferta=int(anterior.clientes_grupos_oferta or 0),
                    vendas_realizadas=int(anterior.vendas_realizadas or 0),
                    receita_total=float(anterior.receita_total or 0),
                )

            score_info = calcular_score(
                MetricasSemana(
                    clientes_google=dado.clientes_google,
                    clientes_facebook=dado.clientes_facebook,
                    clientes_grupos_oferta=dado.clientes_grupos_oferta,
                    vendas_realizadas=dado.vendas_realizadas,
                    receita_total=dado.receita_total,
                ),
                metricas_anterior,
            )

            coleta = Coleta(
                farmacia_id=farmacia.id,
                periodo_inicio=dado.periodo_inicio,
                periodo_fim=dado.periodo_fim,
                clientes_google=dado.clientes_google,
                clientes_facebook=dado.clientes_facebook,
                clientes_grupos_oferta=dado.clientes_grupos_oferta,
                total_atendimentos=dado.total_atendimentos,
                vendas_realizadas=dado.vendas_realizadas,
                receita_total=dado.receita_total,
                score_criticidade=score_info["score_criticidade"],
                nivel_alerta=score_info["nivel_alerta"],
                variacao_google=score_info["variacao_google"],
                variacao_facebook=score_info["variacao_facebook"],
                variacao_grupos=score_info["variacao_grupos"],
                variacao_vendas=score_info["variacao_vendas"],
                variacao_receita=score_info["variacao_receita"],
            )
            db.add(coleta)
            db.flush()

            # Salva breakdown completo de todos os canais
            for nome_canal, total in dado.canais.items():
                db.add(ColetaCanal(
                    coleta_id=coleta.id,
                    canal=nome_canal,
                    atendimentos=total,
                ))

            alertas = score_info.get("alertas", [])
            alerta_str = " | ".join(alertas) if alertas else "OK"
            print(
                f"  [{score_info['nivel_alerta'].upper():8}] {dado.nome:40} "
                f"Score: {score_info['score_criticidade']:5.1f} | {alerta_str}"
            )

        db.commit()
    finally:
        db.close()


async def pipeline():
    print(f"\n{'='*60}")
    print(f"  Pipeline iniciado: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print(f"{'='*60}\n")

    farmacias = carregar_farmacias()
    print(f"  Farmacias ativas: {len(farmacias)}\n")

    print("  Coletando dados...\n")
    paralelo = int(os.getenv("PARALELO_MAX", "1"))
    resultados = await coletar_todas(farmacias, paralelo=paralelo)

    print("\n  Processando e salvando...\n")
    salvar_resultados(resultados)

    erros  = [r for r in resultados if r.erro]
    sucesso = len(resultados) - len(erros)
    print(f"\n{'='*60}")
    print(f"  Concluido: {sucesso}/{len(resultados)} farmacias coletadas")
    if erros:
        print(f"  Erros: {len(erros)} ({', '.join(e.nome for e in erros)})")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(pipeline())
