"""
Arma el archivo de datos del dashboard (informe/dashboard/datos/base.json).

Junta:
  - las fichas por banco del Boletín Anual (datos/limpios/fichas_anual_2025.csv)
  - los indicadores oficiales del sistema del Boletín Anual (página "PRINCIPALES INDICADORES")
  - todos los boletines mensuales ya extraídos (datos/limpios/mensual/*.json)

Los indicadores por banco NO se guardan aquí: el dashboard los calcula a partir de
las cuentas, para que una corrección o un periodo nuevo se refleje en todo.

Uso (después de extraer_fichas.py y extraer_mensual.py):
    .venv/Scripts/python src/datos_dashboard.py
"""

from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pdfplumber

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extraer_mensual import filas  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
LIMPIOS = RAIZ / "datos" / "limpios"
PDF_ANUAL = RAIZ / "datos" / "crudos" / "Boletin-Anual-de-Estadisticas-del-Sistema-Financiero-Ano-2025.pdf"
DESTINO = RAIZ / "informe" / "dashboard" / "datos" / "base.json"

SECCION = "INSTITUCIONES BANCARIAS"
TOTAL = "TOTAL INSTITUCIONES BANCARIAS"

# Nombre con el que la gente conoce a cada banco en Guatemala
NOMBRES_CORTOS = {
    "EL CRÉDITO HIPOTECARIO NACIONAL DE GUATEMALA": ("chn", "CHN"),
    "BANCO CUSCATLÁN GUATEMALA, S. A.": ("cuscatlan", "Cuscatlán"),
    "BANCO DE LOS TRABAJADORES": ("bantrab", "Bantrab"),
    "BANCO INDUSTRIAL, S. A.": ("bi", "Industrial"),
    "BANCO DE DESARROLLO RURAL, S. A.": ("banrural", "Banrural"),
    "BANCO INTERNACIONAL, S. A.": ("interbanco", "Interbanco"),
    "CITIBANK, N. A. SUCURSAL GUATEMALA": ("citi", "Citibank"),
    "VIVIBANCO, S. A.": ("vivibanco", "Vivibanco"),
    "BANCO FICOHSA GUATEMALA, S. A.": ("ficohsa", "Ficohsa"),
    "BANCO PROMERICA, S. A.": ("promerica", "Promerica"),
    "BANCO DE ANTIGUA, S. A.": ("antigua", "Antigua"),
    "BANCO DE AMÉRICA CENTRAL, S. A.": ("bac", "BAC"),
    "BANCO AGROMERCANTIL DE GUATEMALA, S. A.": ("bam", "BAM"),
    "BANCO G&T CONTINENTAL, S. A.": ("gyt", "G&T Continental"),
    "BANCO AZTECA DE GUATEMALA, S. A.": ("azteca", "Azteca"),
    "BANCO INV, S. A.": ("inv", "INV"),
    "BANCO CREDICORP, S. A.": ("credicorp", "Credicorp"),
    "BANCO NEXA, S. A.": ("nexa", "Nexa"),
    "BANCO MULTIMONEY, S. A.": ("multimoney", "Multimoney"),
}

# Indicadores oficiales del sistema (Boletín Anual, sección bancos)
OFICIALES = {
    "li": ("Liquidez inmediata",),
    "lm": ("Liquidez mediata",),
    "pa": ("Patrimonio con relación a activos",),
    "pcc": ("Patrimonio con relación a cartera",),
    "pca": ("Patrimonio con relación a las captaciones",),
    "iac": ("Adecuación de capital",),
    "come": ("Calce de operaciones ME",),
    "roe": ("(ROE)",),
    "roa": ("(ROA)",),
    "ea": ("Eficiencia sobre activos",),
    "ef": ("Eficiencia (EF)",),
    "cvc": ("(CVC)",),
    "ccr": ("(CCR)",),
}


def nombre_legible(entidad: str) -> str:
    """'BANCO DE LOS TRABAJADORES' -> 'Banco de los Trabajadores'."""
    menores = {"de", "del", "los", "las", "la", "y", "el"}
    palabras = entidad.title().split()
    out = [p.lower() if i and p.lower() in menores else p for i, p in enumerate(palabras)]
    return " ".join(out).replace("G&T", "G&T").replace("N. A.", "N. A.").replace("Inv,", "INV,")


def limpio(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v


def cuentas_por_entidad() -> tuple[list[dict], dict, dict]:
    df = pd.read_csv(LIMPIOS / "fichas_anual_2025.csv")
    df = df[df.seccion == SECCION]
    ancho = df.pivot_table(index=["entidad", "anio"], columns="clave", values="valor_miles_q", aggfunc="first")

    bancos, series = [], {}
    for entidad, g in ancho.groupby(level="entidad"):
        clave = "sistema" if entidad == TOTAL else NOMBRES_CORTOS[entidad][0]
        if clave != "sistema":
            bid, corto = NOMBRES_CORTOS[entidad]
            bancos.append({"id": bid, "nombre": nombre_legible(entidad),
                           "nombre_oficial": entidad, "corto": corto})
        series[clave] = {}
        for (_, anio), fila in g.iterrows():
            valores = {k: limpio(float(v)) for k, v in fila.items() if limpio(v) is not None}
            if valores.get("total_de_activo"):
                series[clave][f"{anio}-12"] = valores
    bancos.sort(key=lambda b: -(series[b["id"]].get("2025-12", {}).get("total_de_activo") or 0))
    return bancos, series, {"unidad": "miles_q", "nota": "Saldos al 31 de diciembre; resultados del año completo."}


def oficiales_anuales() -> dict:
    with pdfplumber.open(PDF_ANUAL) as pdf:
        for pagina in pdf.pages:
            t = pagina.extract_text() or ""
            if "INSTITUCIONES BANCARIAS" in t[:60] and "PRINCIPALES INDICADORES FINANCIEROS" in t:
                anios = re.search(r"INDICADORES ((?:\d{4}\s*){5})", t).group(1).split()
                f = filas(t.split("LIQUIDEZ SOLVENCIA")[0], 5)
                out = {"periodos": [f"{a}-12" for a in anios]}
                for clave, palabras in OFICIALES.items():
                    for etiqueta, valores in f:
                        if all(p.lower() in etiqueta.lower() for p in palabras):
                            out[clave] = valores
                            break
                return out
    raise ValueError("no se encontró la página de indicadores del sistema bancario")


def mensuales() -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((LIMPIOS / "mensual").glob("*.json"))]


def main() -> int:
    bancos, series, nota = cuentas_por_entidad()
    mens = mensuales()
    ultimo = mens[-1] if mens else None
    base = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fuentes": [
            {"id": "sib-anual-2025", "titulo": "Boletín Anual de Estadísticas del Sistema Financiero 2025",
             "emisor": "Superintendencia de Bancos de Guatemala", "cobertura": "2021–2025, por banco y sistema",
             "archivo": PDF_ANUAL.name, "url": "https://www.sib.gob.gt/web/sib/Boletin-Anual-de-Estadisticas"},
            *[{"id": f"sib-mensual-{m['corte']}", "titulo": f"Boletín Mensual de Estadísticas, corte {m['corte']}",
               "emisor": "Superintendencia de Bancos de Guatemala", "cobertura": "Sistema bancario (sin detalle por banco)",
               "archivo": m["fuente"], "url": "https://www.sib.gob.gt/web/sib/Boletn-Mensual-de-Estadisticas"} for m in mens],
        ],
        "bancos": bancos,
        "anual": {**nota, "series": series},
        "oficiales_anual": oficiales_anuales(),
        "mensual": mens,
        "ultimo_corte": ultimo["corte"] if ultimo else None,
    }
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    editorial = DESTINO.parent / "editorial.json"
    if not editorial.exists():
        editorial.write_text(json.dumps({"version": 1, "notas": {}, "notas_banco": {}, "conclusiones": [],
                                         "ajustes": [], "periodos": [], "fuentes": []}, ensure_ascii=False, indent=1),
                             encoding="utf-8")
    print(f"{DESTINO.relative_to(RAIZ)}: {len(bancos)} bancos, {len(mens)} boletín(es) mensual(es), "
          f"{DESTINO.stat().st_size / 1024:.0f} KB")
    print("Indicadores oficiales:", {k: v[-1] for k, v in base["oficiales_anual"].items() if k != "periodos"})
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
