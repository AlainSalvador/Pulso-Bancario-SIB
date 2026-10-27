"""
Extractor de las fichas por entidad del Boletín Anual de la SIB.

Lee las páginas "PRINCIPALES RUBROS DEL BALANCE GENERAL Y DEL ESTADO DE
RESULTADOS" (una por banco o financiera, más una página con el total de cada
sección) y las convierte en una tabla larga:

    seccion | entidad | pagina | bloque | orden | cuenta | clave | anio | valor_miles_q

Por qué por coordenadas y no con texto plano: al pasar el PDF a texto las
columnas se mezclan. Aquí cada número se asigna al año cuya cabecera está
más cerca horizontalmente, y al final se valida que los estados cuadren.

Uso (desde la carpeta del proyecto):
    .venv/Scripts/python src/extraer_fichas.py
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd
import pdfplumber

RAIZ = Path(__file__).resolve().parent.parent
PDF_ANUAL = RAIZ / "datos" / "crudos" / "Boletin-Anual-de-Estadisticas-del-Sistema-Financiero-Ano-2025.pdf"
SALIDA = RAIZ / "datos" / "limpios"

TITULO_FICHA = "PRINCIPALES RUBROS DEL BALANCE GENERAL"
TOLERANCIA_FILA = 3.5  # puntos: palabras con "top" así de cercano forman la misma fila
X_ETIQUETA = 220  # el texto de la etiqueta empieza antes de esta x
X_NUMEROS = 150  # los números empiezan después de esta x (los totales grandes invaden la zona de etiqueta)
FIN_TABLA_POR_DEFECTO = 340  # si no se encuentra el título de la primera gráfica
TOLERANCIA_CUADRE = 3  # miles de quetzales: diferencias por redondeo del boletín

# Descuadres que vienen del propio PDF (verificados a mano). Ver notas/incidencias_fuente.md
ANOMALIAS_FUENTE = {
    "MERCOM BANK LTD.": "la cabecera dice 2019 en vez de 2021 y una columna del pasivo no suma "
                        "(faltan Q777,370 miles en el PDF)",
    "TOTAL ENTIDADES FUERA DE PLAZA O ENTIDADES OFF SHORE": "arrastra el descuadre de Mercom Bank",
}

NUMERO = re.compile(r"^-?[\d,]+(\.\d+)?%?$")
NOTA = re.compile(r"^\d/$")  # marcas de pie de página: 1/, 2/ ...
GUIONES = {"-", "–", "—"}  # celda sin saldo
ITEM_LISTA = re.compile(r"^\d+\. ", flags=re.M)


# ---------------------------------------------------------------- utilidades

def limpiar_etiqueta(texto: str) -> str:
    """'1Disponibilidades' -> 'Disponibilidades', '# 14(-) Gastos' -> '(-) Gastos'."""
    texto = re.sub(r"\s*\(cid:415\)\s*", "ti", texto)  # ligadura "ti" que el PDF no mapea: 'Ac(cid:415)vo'
    texto = texto.replace("#", " ")
    texto = re.sub(r"^\s*\d+\s*(?=[A-ZÁÉÍÓÚ(])", "", texto)
    return re.sub(r"\s+", " ", texto).strip()


# Cuentas conocidas de las fichas. Algunas páginas pegan las palabras ("GananciaNeta"),
# traen glifos sin mapear (cid:…) o errores de origen ("Extraordinaros"), así que se
# comparan en forma compacta (solo letras) y por prefijo.
CUENTAS = [
    "disponibilidades", "inversiones", "cartera_de_creditos", "otros", "total_de_activo",
    "obligaciones_depositarias", "creditos_obtenidos", "obligaciones_financieras", "otros_pasivos",
    "otras_cuentas_acreedoras", "capital_contable", "total_pasivo_y_capital",
    "productos_financieros", "gastos_financieros", "margen_por_inversion",
    "productos_por_servicios", "gastos_por_servicios", "margen_por_servicios",
    "margen_de_otros_productos_y_gastos_de_operacion", "margen_operacional_bruto",
    "gastos_de_administracion", "margen_operacional_neto", "productos_y_gastos_extraordinarios",
    "productos_y_gastos_de_ejercicios_anteriores", "ganancia_bruta", "impuesto_sobre_la_renta",
    "ganancia_neta",
]


def compacta(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(cid:\d+\)", "", t).replace("(-)", "").replace("(perdida)", "")
    return re.sub(r"[^a-z]", "", t)


def clave(texto: str) -> str | None:
    """'Total de Activo' -> 'total_de_activo'. None si no es una cuenta conocida (p. ej. una nota)."""
    c = compacta(texto)
    compactas = {cuenta.replace("_", ""): cuenta for cuenta in CUENTAS}
    if c in compactas:
        return compactas[c]
    if len(c) >= 18:
        for k, cuenta in compactas.items():
            if k.startswith(c[:18]):
                return cuenta
    return None


def a_numero(texto: str) -> float:
    return float(texto.replace(",", "").replace("%", ""))


def agrupar_filas(palabras: list[dict]) -> list[list[dict]]:
    filas: list[list[dict]] = []
    for p in sorted(palabras, key=lambda w: w["top"]):
        if filas and abs(p["top"] - filas[-1][0]["top"]) <= TOLERANCIA_FILA:
            filas[-1].append(p)
        else:
            filas.append([p])
    return [sorted(f, key=lambda w: w["x0"]) for f in filas]


# ---------------------------------------------------------------- estructura del boletín

def es_portada(texto: str) -> bool:
    """Las portadas de sección listan las entidades numeradas: '1. Banco ...', '2. Banco ...'."""
    return len(ITEM_LISTA.findall(texto)) >= 2


def titulo_portada(texto: str) -> str:
    """'INSTITUCIONES\\nBANCARIAS\\n1. ...' -> 'INSTITUCIONES BANCARIAS'."""
    lineas = []
    for linea in texto.splitlines():
        if ITEM_LISTA.match(linea):
            break
        lineas.append(linea.strip())
    return " ".join(lineas)


def cabecera_de_tabla(palabras: list[dict]) -> tuple[dict[str, float], float, float]:
    """
    Ubica la tabla en la página. Devuelve:
      - centros x de las columnas (años y variaciones absoluta/relativa),
      - y donde empieza la tabla (fila de años),
      - y donde termina (título de la primera gráfica, "INVERSIONES").
    La fila de años es la que tiene más años; así no se confunde con "VARIACIÓN 2024-2025".
    """
    # Los años de "VARIACIÓN 2024-2025" están a la derecha de la palabra VARIACIÓN: se descartan.
    x_variacion = min((p["x0"] for p in palabras if p["text"].startswith("VARIACI") and p["top"] < 150), default=1e9)
    anios = sorted((p for p in palabras
                    if re.fullmatch(r"20\d\d", p["text"]) and p["top"] < 150 and p["x0"] < x_variacion - 5),
                   key=lambda w: w["x0"])
    inicio = min(p["top"] for p in anios)

    cols: dict[str, float] = {}
    for p in anios:
        cols.setdefault(p["text"], (p["x0"] + p["x1"]) / 2)
    for p in palabras:
        if abs(p["top"] - inicio) > 15:
            continue
        if p["text"] == "ABSOLUTA":
            cols["var_abs"] = (p["x0"] + p["x1"]) / 2 + 15  # los números de esta columna van corridos a la derecha
        elif p["text"] == "RELATIVA":
            cols["var_rel"] = (p["x0"] + p["x1"]) / 2

    graficas = [p["top"] for p in palabras if p["text"] == "INVERSIONES" and p["top"] > inicio + 100]
    fin = min(graficas) if graficas else FIN_TABLA_POR_DEFECTO
    return cols, inicio, fin


def nombre_entidad(palabras: list[dict]) -> str:
    """El nombre es el texto de letra más grande en la cabecera (el subtítulo es más pequeño)."""
    cabecera = [p for p in palabras if p["top"] < 60]
    if not cabecera:
        return ""
    mayor = max(p["size"] for p in cabecera)
    nombre = sorted((p for p in cabecera if p["size"] >= mayor - 0.3), key=lambda w: (round(w["top"]), w["x0"]))
    return " ".join(p["text"] for p in nombre).strip()


def asignar_columnas(celdas: list[dict], cols: dict[str, float]) -> list[tuple[dict, str]]:
    """
    Cada celda va a la columna más cercana, pero respetando el orden de izquierda a
    derecha: dos celdas nunca caen en la misma columna. Así se corrigen filas que
    el PDF dibuja un poco corridas respecto a la cabecera.
    """
    nombres = sorted(cols, key=cols.get)
    asignadas, siguiente = [], 0
    for celda in sorted(celdas, key=lambda w: w["x0"]):
        centro = (celda["x0"] + celda["x1"]) / 2
        cercana = min(range(len(nombres)), key=lambda i: abs(cols[nombres[i]] - centro))
        i = max(cercana, siguiente)
        if i >= len(nombres):
            break
        asignadas.append((celda, nombres[i]))
        siguiente = i + 1
    return asignadas


# ---------------------------------------------------------------- extracción

def leer_ficha(pagina) -> tuple[str, list[dict]]:
    palabras = pagina.extract_words(extra_attrs=["size"])
    cols, inicio, fin = cabecera_de_tabla(palabras)
    anios = {c for c in cols if c.isdigit()}

    registros, bloque, orden = [], "balance", 0
    for fila in agrupar_filas([p for p in palabras if inicio + 6 < p["top"] < fin]):
        fila = [p for p in fila if not NOTA.match(p["text"])]
        # una celda es un número o un guion ("-" = sin saldo); el guion solo ocupa su lugar
        es_celda = [(bool(NUMERO.match(p["text"])) or p["text"] in GUIONES) and p["x0"] >= X_NUMEROS
                    for p in fila]
        etiqueta = limpiar_etiqueta(" ".join(
            p["text"] for p, n in zip(fila, es_celda) if not n and p["x0"] < X_ETIQUETA))
        celdas = [p for p, n in zip(fila, es_celda) if n]

        if compacta(etiqueta).startswith("balancegeneral"):
            bloque = "balance"
            continue
        if compacta(etiqueta).startswith("estadoderesultados"):
            bloque = "resultados"
            continue
        cuenta = clave(etiqueta)
        if not celdas or cuenta is None:  # cabeceras, notas al pie, filas vacías
            continue

        orden += 1
        for celda, col in asignar_columnas(celdas, cols):
            if col in anios and celda["text"] not in GUIONES:  # las variaciones se recalculan; no se guardan
                registros.append({
                    "bloque": bloque, "orden": orden,
                    "cuenta": etiqueta, "clave": cuenta,
                    "anio": int(col), "valor_miles_q": a_numero(celda["text"]),
                })
    return nombre_entidad(palabras), registros


def extraer(pdf_path: Path = PDF_ANUAL) -> pd.DataFrame:
    filas, seccion = [], None
    with pdfplumber.open(pdf_path) as pdf:
        for i, pagina in enumerate(pdf.pages, start=1):
            texto = pagina.extract_text() or ""
            if es_portada(texto):
                seccion = titulo_portada(texto)
                continue
            if TITULO_FICHA not in texto:
                continue
            entidad, registros = leer_ficha(pagina)
            if entidad.upper() == (seccion or "").upper():
                entidad = "TOTAL " + entidad  # la página agregada de la sección
            for r in registros:
                r.update(seccion=seccion, entidad=entidad, pagina=i)
            filas.extend(registros)
    columnas = ["seccion", "entidad", "pagina", "bloque", "orden", "cuenta", "clave", "anio", "valor_miles_q"]
    return pd.DataFrame(filas)[columnas]


# ---------------------------------------------------------------- validación

def validar(df: pd.DataFrame) -> pd.DataFrame:
    """Controles de cuadre por entidad y año. Cada columna es una diferencia que debería ser ~0."""
    filas = []
    for (seccion, entidad, anio), g in df.groupby(["seccion", "entidad", "anio"]):
        v = g.set_index("clave").valor_miles_q
        bal = g[g.bloque == "balance"]
        if not {"total_de_activo", "total_pasivo_y_capital", "ganancia_neta"} <= set(v.index):
            # entidad que aún no operaba (o ya no) ese año: no hay estado completo que cuadrar
            filas.append({"seccion": seccion, "entidad": entidad, "anio": anio, "incompleto": True})
            continue
        o_activo = bal.loc[bal.clave == "total_de_activo", "orden"].iloc[0]
        o_total = bal.loc[bal.clave == "total_pasivo_y_capital", "orden"].iloc[0]
        rubros_activo = bal[bal.orden < o_activo].valor_miles_q.sum()
        rubros_pasivo = bal[(bal.orden > o_activo) & (bal.orden < o_total)].valor_miles_q.sum()
        filas.append({
            "seccion": seccion, "entidad": entidad, "anio": anio,
            "activo_vs_pasivo_y_capital": v["total_de_activo"] - v["total_pasivo_y_capital"],
            "suma_rubros_activo": rubros_activo - v["total_de_activo"],
            "suma_rubros_pasivo_y_capital": rubros_pasivo - v["total_pasivo_y_capital"],
            "ganancia_neta": v["ganancia_bruta"] - v.get("impuesto_sobre_la_renta", 0) - v["ganancia_neta"],
        })
    controles = pd.DataFrame(filas).set_index(["seccion", "entidad", "anio"])
    controles["incompleto"] = controles["incompleto"].fillna(False).astype(bool)
    diferencias = controles.drop(columns="incompleto").abs().max(axis=1)
    controles["ok"] = controles.incompleto | (diferencias <= TOLERANCIA_CUADRE)
    return controles


def main() -> int:
    SALIDA.mkdir(parents=True, exist_ok=True)
    df = extraer()
    df.to_csv(SALIDA / "fichas_anual_2025.csv", index=False, encoding="utf-8-sig")

    controles = validar(df)
    controles.to_csv(SALIDA / "fichas_anual_2025_controles.csv", encoding="utf-8-sig")

    print(f"Filas extraídas: {len(df):,}")
    print("Entidades por sección:", df.groupby("seccion").entidad.nunique().to_dict())

    malos = controles[~controles.ok]
    conocidos = malos[malos.index.get_level_values("entidad").isin(ANOMALIAS_FUENTE)]
    nuevos = malos.drop(conocidos.index)
    print(f"Validación: {int(controles.ok.sum())} de {len(controles)} entidad-año cuadran ✔")
    for entidad in conocidos.index.get_level_values("entidad").unique():
        print(f"  Anomalía conocida de la fuente — {entidad}: {ANOMALIAS_FUENTE[entidad]}")
    if nuevos.empty:
        return 0
    print(f"  {len(nuevos)} entidad-año NO cuadran y no están explicados. Revisar:")
    print(nuevos.round(0).to_string())
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
