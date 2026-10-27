"""
Extractor del Boletín Mensual de Estadísticas de la SIB (sección de bancos).

El boletín mensual solo trae el sistema bancario completo, no cada banco, pero
trae el corte más reciente y series que el anual no tiene: mora por segmento,
crédito por actividad económica, tasas, captaciones y la adecuación de capital
mes a mes.

Cada tabla del boletín tiene la forma "ETIQUETA v1 v2 v3 v4 v5", así que se lee
línea por línea. Los cortes (columnas) se leen de la cabecera de cada página, de
modo que el mismo código sirve para el boletín de cualquier mes.

Uso:
    .venv/Scripts/python src/extraer_mensual.py                  # todos los BM-*.pdf de datos/crudos
    .venv/Scripts/python src/extraer_mensual.py datos/crudos/BM-Bancos-Septiembre-2026.pdf

Salida: datos/limpios/mensual/AAAA-MM.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber

RAIZ = Path(__file__).resolve().parent.parent
CRUDOS = RAIZ / "datos" / "crudos"
SALIDA = RAIZ / "datos" / "limpios" / "mensual"

MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
         "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}
CORTE = re.compile(r"\b(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)-(\d{4})\b")
NUM = r"-?\d[\d,]*(?:\.\d+)?%?"


# ---------------------------------------------------------------- utilidades

def iso(mes: str, anio: str) -> str:
    return f"{anio}-{MESES[mes.lower()]:02d}"


def numero(texto: str) -> float:
    return float(texto.replace(",", "").replace("%", ""))


def reparar(linea: str) -> str:
    """El PDF a veces parte un número: '1 01,834,069' -> '101,834,069', '6 ,341' -> '6,341'."""
    linea = re.sub(r"(?<![\d,.])(\d) (?=\d{1,2},\d{3})", r"\1", linea)
    linea = re.sub(r"(\d) (?=,\d{3})", r"\1", linea)
    return linea


def filas(texto: str, n: int) -> list[tuple[str, list[float]]]:
    """Líneas 'ETIQUETA v1 ... vn' con exactamente n valores al final."""
    patron = re.compile(rf"^(.*?[A-Za-zÁÉÍÓÚáéíóúÑñ)/.][^\d-]*?)\s+((?:{NUM}\s+){{{n - 1}}}{NUM})$")
    out = []
    for linea in texto.splitlines():
        m = patron.match(reparar(linea.strip()))
        if m:
            out.append((m.group(1).strip(), [numero(v) for v in m.group(2).split()]))
    return out


def cortes(texto: str) -> list[str]:
    """Primera línea con 5 cortes ('Dic-2023 Dic-2024 Ago-2025 Dic-2025 Ago-2026')."""
    for linea in texto.splitlines():
        hallados = CORTE.findall(linea)
        if len(hallados) >= 5:
            return [iso(m, a) for m, a in hallados[:5]]
    raise ValueError("no se encontró la fila de cortes")


def buscar_partida(texto: str, palabra: str, n: int = 5) -> list[float] | None:
    """Fila cuya etiqueta ocupa dos líneas y los valores quedan solos en la siguiente:
    'CRÉDITOS HIPOTECARIOS PARA VIVIENDA Y CÉDULAS' / '8.8% 8.7% ...' / 'HIPOTECARIAS'."""
    lineas = [l.strip() for l in texto.splitlines()]
    solo_numeros = re.compile(rf"^(?:{NUM}\s+){{{n - 1}}}{NUM}$")
    for i, linea in enumerate(lineas[:-1]):
        if palabra in linea.upper() and not re.search(r"\d", linea) and solo_numeros.match(lineas[i + 1]):
            return [numero(v) for v in lineas[i + 1].split()]
    return None


def segmentos(texto: str) -> dict[str, list[float] | None]:
    out = {s: buscar(filas(texto, 5), *p) for s, p in SEGMENTOS.items()}
    if out["hipotecario"] is None:
        out["hipotecario"] = buscar_partida(texto, "HIPOTECARIOS")
    return out


def buscar(filas_: list[tuple[str, list[float]]], *palabras: str) -> list[float] | None:
    """Valores de la primera fila cuya etiqueta contiene todas las palabras (sin importar mayúsculas)."""
    for etiqueta, valores in filas_:
        e = etiqueta.upper()
        if all(p.upper() in e for p in palabras):
            return valores
    return None


def pagina_con(pdf, *titulos: str, desde: int = 0) -> str:
    """Texto de la primera página (de bancos) que contiene todos los títulos."""
    for pagina in pdf.pages[desde:]:
        texto = pagina.extract_text() or ""
        if "SOCIEDADES FINANCIERAS" in texto[:200]:
            break  # se acabó la sección de bancos
        if all(t in texto for t in titulos):
            return texto
    raise ValueError(f"no se encontró la página {titulos}")


def tabla(texto: str, etiquetas: dict[str, tuple[str, ...]], n: int = 5) -> dict[str, list[float]]:
    f = filas(texto, n)
    out = {}
    for clave, palabras in etiquetas.items():
        v = buscar(f, *palabras)
        if v is None:
            raise ValueError(f"fila no encontrada: {clave} {palabras}")
        out[clave] = v
    return out


# ---------------------------------------------------------------- tablas

def resumen(pdf) -> dict:
    t = pagina_con(pdf, "PRINCIPALES INDICADORES FINANCIEROS", "Valores en millardos")
    corte_ = CORTE.search(t.split("ÍNDICE DE ADECUACIÓN")[0]) or None
    patrones = {
        "liquidez_inmediata": r"Liquidez inmediata (\d+\.\d)%",
        "liquidez_mediata": r"Liquidez mediata (\d+\.\d)%",
        "patrimonio_activos": r"Patrimonio con relación a activos (\d+\.\d)%",
        "roe": r"\(ROE\) (\d+\.\d)%",
        "roa": r"\(ROA\) (\d+\.\d)%",
        "cartera_vencida": r"cartera de créditos (\d+\.\d)%",
    }
    out = {}
    for clave, p in patrones.items():
        m = re.search(p, t)
        if m:
            out[clave] = float(m.group(1))
    return out


def balance(pdf) -> dict:
    t = pagina_con(pdf, "PASIVO Y CAPITAL", "TOTAL ACTIVO")
    activo = tabla(t, {
        "disponibilidades": ("DISPONIBILIDADES",),
        "inversiones": ("INVERSIONES 1/",),
        "cartera_neta": ("CARTERA DE CRÉDITOS NETA",),
        "otras_inversiones": ("OTRAS INVERSIONES",),
        "inmuebles_muebles": ("INMUEBLES Y MUEBLES",),
        "cargos_diferidos": ("CARGOS DIFERIDOS",),
        "otros_activos": ("OTROS ACTIVOS",),
        "total_activo": ("TOTAL ACTIVO",),
    })
    pasivo = tabla(t, {
        "obligaciones_depositarias": ("OBLIGACIONES DEPOSITARIAS",),
        "creditos_obtenidos": ("CRÉDITOS OBTENIDOS",),
        "obligaciones_financieras": ("OBLIGACIONES FINANCIERAS",),
        "provisiones": ("PROVISIONES",),
        "creditos_diferidos": ("CRÉDITOS DIFERIDOS",),
        "otros_pasivos": ("OTROS PASIVOS",),
        "capital_contable": ("CAPITAL CONTABLE",),
        "total_pasivo_capital": ("TOTAL PASIVO Y CAPITAL",),
    })
    return {"cortes": cortes(t), "unidad": "miles_q", "activo": activo, "pasivo": pasivo}


def resultados(pdf) -> dict:
    t = pagina_con(pdf, "ESTADO DE RESULTADOS", "RESULTADO")
    filas_ = tabla(t, {
        "productos_financieros": ("PRODUCTOS FINANCIEROS",),
        "productos_servicios": ("PRODUCTOS POR SERVICIOS",),
        "productos_extraordinarios": ("PRODUCTOS EXTRAORDINARIOS",),
        "otros_productos": ("PRODUCTOS DE OPERACIÓN",),
        "gastos_financieros": ("GASTOS FINANCIEROS",),
        "otros_gastos": ("GASTOS DE OPERACIÓN",),
        "gastos_administracion": ("GASTOS DE ADMINISTRACIÓN",),
        "resultado": ("RESULTADO",),
    })
    return {"cortes": cortes(t), "unidad": "miles_q", "acumulado": "enero a mes de corte", **filas_}


def serie_mensual(texto: str, columnas: list[str]) -> list[dict]:
    """Filas '30-Sep-2025 v1 v2 v3 v4' de las tablas mensuales."""
    out = []
    patron = re.compile(rf"^\d{{1,2}}-(\w{{3}})-(\d{{4}})\s+((?:{NUM}\s+){{{len(columnas) - 1}}}{NUM})")
    for linea in texto.splitlines():
        m = patron.match(reparar(linea.strip()))
        if m:
            valores = [numero(v) for v in m.group(3).split()]
            out.append({"mes": iso(m.group(1), m.group(2)), **dict(zip(columnas, valores))})
    return out


def capital_y_encaje(pdf) -> dict:
    t = pagina_con(pdf, "POSICIÓN PATRIMONIAL", "POSICIÓN DE ENCAJE")
    bloque_pat, resto = t.split("POSICIÓN DE ENCAJE EN MONEDA NACIONAL", 1)
    bloque_mn, bloque_me = resto.split("POSICIÓN DE ENCAJE EN MONEDA EXTRANJERA", 1)
    return {
        "patrimonio": serie_mensual(bloque_pat, ["computable", "requerido", "posicion", "iac"]),
        "encaje_mn": serie_mensual(bloque_mn, ["obligaciones_encajables", "computable", "requerido", "posicion"]),
        "encaje_me": serie_mensual(bloque_me, ["obligaciones_encajables", "computable", "requerido", "posicion"]),
        "unidades": {"patrimonio": "miles_q", "encaje_mn": "miles_q", "encaje_me": "miles_usd", "iac": "%"},
    }


SEGMENTOS = {
    "empresarial": ("EMPRESARIALES",),
    "productivo": ("PRODUCTIVOS",),
    "hipotecario": ("HIPOTECARIOS",),
    "consumo": ("CONSUMO",),
}


def cartera_segmento(pdf) -> dict:
    t = pagina_con(pdf, "CARTERA DE CRÉDITOS", "SEGMENTO", "TOTALES")
    f = filas(t, 7)
    out = {}
    for seg, palabras in {**SEGMENTOS, "total": ("TOTALES",)}.items():
        v = buscar(f, *palabras)
        out[seg] = {"cantidad_mn": v[0], "saldo_mn": v[1], "cantidad_me": v[2], "saldo_me": v[3],
                    "cantidad": v[4], "saldo": v[5], "participacion": v[6]}
    return {"unidad": "miles_q", "segmentos": out}


def mora_segmento(pdf) -> dict:
    t = pagina_con(pdf, "PORCENTAJE DE MORA POR SEGMENTO")
    mn, me = t.split("EN MONEDA EXTRANJERA", 1)
    return {"cortes": cortes(t), "mn": segmentos(mn), "me": segmentos(me)}


def cartera_actividad(pdf) -> dict:
    t = pagina_con(pdf, "POR ACTIVIDAD ECONÓMICA", "TOTALES", "VARIACIÓN INTERANUAL")
    tabla_, _ = t.split("VARIACIÓN INTERANUAL", 1)
    # se unen las etiquetas largas partidas en dos líneas ("...automotores y" / "motocicletas")
    lineas = tabla_.splitlines()
    out = []
    for i, linea in enumerate(lineas):
        f = filas(linea, 3)
        if f and str(f[0][1][2]).endswith("") and "%" in linea.split()[-1]:
            etiqueta, (cantidad, saldo, part) = f[0]
            if etiqueta.upper().startswith("TOTALES"):
                continue
            siguiente = lineas[i + 1].strip() if i + 1 < len(lineas) else ""
            if siguiente and not re.search(r"\d", siguiente):
                etiqueta = f"{etiqueta} {siguiente}"
            out.append({"actividad": etiqueta, "cantidad": cantidad, "saldo": saldo, "participacion": part})
    return {"unidad": "miles_q", "actividades": out}


def tasas(pdf) -> dict:
    ta = pagina_con(pdf, "TASA DE INTERÉS ACTIVA PROMEDIO PONDERADO")
    total = re.findall(rf"TASA ((?:{NUM}\s+){{4}}{NUM})", ta)
    mn, me = ta.split("POR SEGMENTO", 1)[1].split("EN MONEDA EXTRANJERA", 1)
    tp = pagina_con(pdf, "TASA DE INTERÉS PASIVA PROMEDIO PONDERADO")
    pmn, pme = tp.split("EN MONEDA EXTRANJERA", 1)
    tipos = {"monetarios": ("MONETARIOS",), "ahorro": ("DE AHORRO",), "plazo": ("A PLAZO",)}
    return {
        "cortes": cortes(ta),
        "activa_total": {"mn": [numero(v) for v in total[0].split()], "me": [numero(v) for v in total[1].split()]},
        "activa_segmento": {"mn": segmentos(mn), "me": segmentos(me)},
        "pasiva": {"mn": {k: buscar(filas(pmn, 5), *p) for k, p in tipos.items()},
                   "me": {k: buscar(filas(pme, 5), *p) for k, p in tipos.items()}},
        "nota": "Desde enero 2025 las tasas activas excluyen las líneas de tarjeta de crédito (Ley de Tarjetas de Crédito).",
    }


def captaciones(pdf) -> dict:
    tipos = {"monetarios": ("MONETARIOS",), "ahorro": ("DE AHORRO",), "plazo": ("A PLAZO",), "otras": ("OTRAS CAPTACIONES",)}
    out = {}
    for moneda, titulo in {"mn": "CAPTACIONES EN MONEDA NACIONAL", "me": "CAPTACIONES EN MONEDA EXTRANJERA"}.items():
        t = pagina_con(pdf, titulo)
        out[moneda] = tabla(t.split("DEPÓSITOS MONETARIOS")[0], tipos)
        out["cortes"] = cortes(t)
    out["unidad"] = "millones_q"
    return out


def extraer(pdf_path: Path) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        bal = balance(pdf)
        datos = {
            "fuente": pdf_path.name,
            "corte": bal["cortes"][-1],
            "resumen": resumen(pdf),
            "balance": bal,
            "resultados": resultados(pdf),
            "capital_encaje": capital_y_encaje(pdf),
            "cartera_segmento": cartera_segmento(pdf),
            "mora_segmento": mora_segmento(pdf),
            "cartera_actividad": cartera_actividad(pdf),
            "tasas": tasas(pdf),
            "captaciones": captaciones(pdf),
        }
    return datos


def validar(d: dict) -> list[str]:
    """Cuadres que debe cumplir cualquier boletín."""
    errores = []
    a, p = d["balance"]["activo"], d["balance"]["pasivo"]
    for i, c in enumerate(d["balance"]["cortes"]):
        suma_a = sum(v[i] for k, v in a.items() if k != "total_activo")
        suma_p = sum(v[i] for k, v in p.items() if k != "total_pasivo_capital")
        if abs(suma_a - a["total_activo"][i]) > 3:
            errores.append(f"{c}: rubros del activo no suman el total ({suma_a - a['total_activo'][i]:+,.0f})")
        if abs(suma_p - p["total_pasivo_capital"][i]) > 3:
            errores.append(f"{c}: rubros del pasivo no suman el total ({suma_p - p['total_pasivo_capital'][i]:+,.0f})")
        if abs(a["total_activo"][i] - p["total_pasivo_capital"][i]) > 3:
            errores.append(f"{c}: activo ≠ pasivo + capital")
    r = d["resultados"]
    for i, c in enumerate(r["cortes"]):
        prod = r["productos_financieros"][i] + r["productos_servicios"][i] + r["productos_extraordinarios"][i] + r["otros_productos"][i]
        gast = r["gastos_financieros"][i] + r["otros_gastos"][i] + r["gastos_administracion"][i]
        if abs(prod - gast - r["resultado"][i]) > 3:
            errores.append(f"{c}: productos − gastos ≠ resultado ({prod - gast - r['resultado'][i]:+,.0f})")
    segs = d["cartera_segmento"]["segmentos"]
    total = sum(s["saldo"] for k, s in segs.items() if k != "total")
    if abs(total - segs["total"]["saldo"]) > 3:
        errores.append("cartera por segmento no suma el total")
    for k, s in segs.items():
        if abs(s["saldo_mn"] + s["saldo_me"] - s["saldo"]) > 3:
            errores.append(f"cartera {k}: MN + ME ≠ total")
    for bloque in (d["mora_segmento"]["mn"], d["mora_segmento"]["me"],
                   d["tasas"]["activa_segmento"]["mn"], d["tasas"]["activa_segmento"]["me"]):
        errores += [f"falta la serie del segmento {k}" for k, v in bloque.items() if v is None]
    act = sum(x["saldo"] for x in d["cartera_actividad"]["actividades"]
              if x["actividad"].upper() not in ("CONSUMOS PERSONALES", "VEHÍCULOS", "TARJETAS DE CRÉDITO"))
    if abs(act - segs["total"]["saldo"]) > 3:
        errores.append(f"cartera por actividad no suma el total ({act - segs['total']['saldo']:+,.0f})")
    return errores


def main(argv: list[str]) -> int:
    SALIDA.mkdir(parents=True, exist_ok=True)
    pdfs = [Path(a) for a in argv] or sorted(CRUDOS.glob("BM-*.pdf"))
    codigo = 0
    for pdf_path in pdfs:
        d = extraer(pdf_path)
        errores = validar(d)
        destino = SALIDA / f"{d['corte']}.json"
        destino.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        estado = "cuadra ✔" if not errores else f"{len(errores)} problemas"
        print(f"{pdf_path.name} → {destino.relative_to(RAIZ)}  ({estado})")
        for e in errores:
            print("  ", e)
        codigo = codigo or bool(errores)
    return int(codigo)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
