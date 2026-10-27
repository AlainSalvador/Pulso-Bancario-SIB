# Pulso Bancario GT

Análisis del sistema bancario de Guatemala con datos públicos de la Superintendencia de Bancos (SIB) y del Banco de Guatemala.

**Preguntas guía**
1. ¿Qué tan sano está el sistema bancario y qué bancos mejoraron o empeoraron entre 2021 y 2025?
2. ¿Las remesas mueven los depósitos?
3. ¿Quién se queda con el margen entre tasa activa y pasiva?

## Estructura

```
SIB/
├── datos/
│   ├── crudos/      PDFs originales de la SIB (no se modifican)
│   └── limpios/     tablas extraídas en CSV (se regeneran con el código)
├── src/
│   ├── extraer_fichas.py    fichas por banco del boletín anual → CSV
│   ├── extraer_mensual.py   boletín mensual (sistema) → datos/limpios/mensual/AAAA-MM.json
│   ├── indicadores.py       indicadores por banco → CSV
│   └── datos_dashboard.py   arma informe/dashboard/datos/base.json
├── informe/
│   └── dashboard/   el tablero "Pulso Bancario GT" (index.html, app.js, app.css, datos/)
├── notas/           glosario, incidencias de la fuente, apuntes
└── _cv/             (archivos del CV, no son parte del proyecto)
```

## Dashboard

Publicado en claude.ai: https://claude.ai/artifact/97GgwJSj2tHcGjjUYhCUBE

- `datos/base.json`: lo que sale de los PDFs de la SIB. Se regenera con los scripts y no se edita a mano.
- `datos/editorial.json`: tus notas, conclusiones, correcciones y periodos agregados desde el propio tablero (botón **Editar** → **Guardar cambios**).

Para verlo en tu computadora:

```bash
.venv/Scripts/python informe/dashboard/servir.py
```

y abre http://localhost:8765. Fuera de claude.ai lo que edites se guarda en el navegador; descárgalo desde "Fuentes y método".

### Cuando la SIB publique un boletín nuevo

1. Guarda el PDF en `datos/crudos/` (el mensual con nombre `BM-…pdf`).
2. Corre, en orden:

```bash
.venv/Scripts/python src/extraer_mensual.py
.venv/Scripts/python src/extraer_fichas.py
.venv/Scripts/python src/datos_dashboard.py
```

3. Republica el tablero (pídeselo a Claude, o publica `informe/dashboard/` de nuevo). Tus notas en `editorial.json` se conservan.

Si solo tienes unos pocos números (por ejemplo, el detalle de un banco en la web de la SIB), agrégalos directo en el tablero: **Editar** → "Agregar datos de un periodo nuevo".

## Cómo correrlo

Una sola vez, para crear el entorno:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

Cada vez que haya un boletín nuevo en `datos/crudos/`:

```bash
.venv/Scripts/python src/extraer_fichas.py
```

## Qué produce

| Archivo | Contenido |
|---|---|
| `datos/limpios/fichas_anual_2025.csv` | Tabla larga: `seccion, entidad, pagina, bloque, orden, cuenta, clave, anio, valor_miles_q`. Cubre bancos, financieras, entidades off-shore y emisoras de tarjetas (incluye una fila `TOTAL ...` por sección). |
| `datos/limpios/fichas_anual_2025_controles.csv` | Un control de cuadre por entidad y año. Cada columna es una diferencia que debería ser ~0. |

Valores en **miles de quetzales**, moneda nacional y extranjera sumadas, al 31 de diciembre de cada año.

## Validación

Para cada entidad y año el extractor comprueba que:

- Total de activo = Total pasivo y capital
- La suma de los rubros del activo = Total de activo
- La suma de los rubros del pasivo y capital = Total pasivo y capital
- Ganancia bruta − ISR = Ganancia neta

Tolerancia: 3 mil quetzales por redondeos. Resultado actual: **186 de 188 cuadran**. Los 2 restantes son un error del propio PDF, documentado en [notas/incidencias_fuente.md](notas/incidencias_fuente.md).

## Siguientes pasos

- [x] Ejercicio a mano: indicadores de Banco Industrial 2024–2025 ([notas/glosario.md](notas/glosario.md))
- [x] `src/indicadores.py`: solvencia, liquidez, ROE, ROA, eficiencia, intermediación, participación y crecimiento para todos los bancos → `datos/limpios/indicadores_bancos.csv` y `ranking_bancos_2025.csv`
- [x] Cruzar con la SIB: eficiencia y solvencia del sistema coinciden en los 5 años; ROE/ROA difieren por fórmula (ver incidencias)
- [ ] Morosidad por banco (detalle por entidad en la web de la SIB)
- [ ] Tasas, remesas y tipo de cambio del Banguat
- [ ] Dashboard en Power BI e informe ejecutivo de una página

## Fuentes

- SIB, Boletín Anual de Estadísticas del Sistema Financiero 2025
- SIB, Boletín Mensual de Estadísticas del Sistema Financiero, agosto 2026

Las cifras de la SIB no están auditadas; su exactitud es responsabilidad de las entidades que las reportan (nota del propio boletín).
