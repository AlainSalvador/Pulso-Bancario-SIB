"""
Indicadores financieros por banco a partir de las fichas del Boletín Anual.

Lee datos/limpios/fichas_anual_2025.csv (generado por extraer_fichas.py) y calcula,
para cada banco y año, los mismos indicadores del ejercicio a mano (notas/glosario.md),
más tamaño y crecimiento.

Salidas:
    datos/limpios/indicadores_bancos.csv   una fila por banco-año
    datos/limpios/ranking_bancos_2025.csv  foto 2025 con posición en cada indicador

Uso:
    .venv/Scripts/python src/indicadores.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
LIMPIOS = RAIZ / "datos" / "limpios"
SECCION = "INSTITUCIONES BANCARIAS"
TOTAL = "TOTAL INSTITUCIONES BANCARIAS"

# nombre -> (fórmula, ¿más alto es mejor?)  Todas con saldos de cierre de año.
INDICADORES = {
    "solvencia":      (lambda t: t.capital_contable / t.total_de_activo, True),
    "liquidez":       (lambda t: t.disponibilidades / t.obligaciones_depositarias, True),
    "roe":            (lambda t: t.ganancia_neta / t.capital_contable, True),
    "roa":            (lambda t: t.ganancia_neta / t.total_de_activo, True),
    # si el margen operacional bruto es <= 0 el banco pierde dinero antes de gastos: el ratio no tiene sentido
    "eficiencia":     (lambda t: (t.gastos_de_administracion / t.margen_operacional_bruto)
                       .where(t.margen_operacional_bruto > 0), False),
    "intermediacion": (lambda t: t.cartera_de_creditos / t.obligaciones_depositarias, None),  # ni bueno ni malo: modelo de negocio
}


def cargar_cuentas() -> pd.DataFrame:
    """Tabla ancha: una fila por (entidad, año), una columna por cuenta."""
    df = pd.read_csv(LIMPIOS / "fichas_anual_2025.csv")
    df = df[df.seccion == SECCION]
    return df.pivot_table(index=["entidad", "anio"], columns="clave", values="valor_miles_q", aggfunc="first")


def calcular(t: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=t.index)
    for nombre, (formula, _) in INDICADORES.items():
        out[nombre] = formula(t)

    out["activo_miles_q"] = t.total_de_activo
    activo_sistema = t.xs(TOTAL, level="entidad").total_de_activo
    out["participacion"] = t.total_de_activo / activo_sistema.reindex(t.index.get_level_values("anio")).values

    por_banco = t.total_de_activo.groupby(level="entidad")
    out["crec_activo"] = por_banco.pct_change()
    out["crec_cartera"] = t.cartera_de_creditos.groupby(level="entidad").pct_change()
    out["crec_depositos"] = t.obligaciones_depositarias.groupby(level="entidad").pct_change()
    return out


def ranking(ind: pd.DataFrame, anio: int) -> pd.DataFrame:
    """Foto de un año: valor y posición (1 = mejor) en cada indicador, sin el total del sistema."""
    foto = ind.xs(anio, level="anio").drop(index=TOTAL)
    foto = foto[foto.activo_miles_q > 0].sort_values("activo_miles_q", ascending=False)
    for nombre, (_, mayor_es_mejor) in INDICADORES.items():
        if mayor_es_mejor is not None:
            foto[f"pos_{nombre}"] = foto[nombre].rank(ascending=not mayor_es_mejor, method="min").astype("Int64")
    return foto


def main() -> int:
    ind = calcular(cargar_cuentas())
    ind.to_csv(LIMPIOS / "indicadores_bancos.csv", encoding="utf-8-sig")
    rk = ranking(ind, 2025)
    rk.to_csv(LIMPIOS / "ranking_bancos_2025.csv", encoding="utf-8-sig")

    pct = ["solvencia", "liquidez", "roe", "roa", "eficiencia", "intermediacion", "participacion"]
    vista = rk[pct].mul(100).round(1)
    vista.loc["— SISTEMA —"] = ind.loc[(TOTAL, 2025), pct].mul(100).round(1)
    print("Indicadores 2025 (%), bancos ordenados por tamaño:\n")
    print(vista.to_string())
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    pd.set_option("display.width", 200)
    sys.exit(main())
