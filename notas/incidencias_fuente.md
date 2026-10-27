# Incidencias encontradas en la fuente

Errores o rarezas del propio PDF de la SIB, no del extractor. Cada uno se verificó a mano.

## Boletín Anual 2025

### Mercom Bank Ltd. (pág. 68 del PDF), sección off-shore

- **Cabecera:** dice `2019, 2021, 2022, 2023, 2024, 2025`. Debería empezar en 2021 (el resto de fichas usa 2021–2025). En el CSV la primera columna sale como `anio = 2019`.
- **Pasivo y capital:** en una columna, la suma de rubros queda **Q777,370 miles** por debajo del total publicado. Ese valor no aparece en ninguna parte de la página: probablemente se omitió una fila (por ejemplo, créditos obtenidos u obligaciones financieras).
- **Total off-shore (pág. 58):** arrastra la misma diferencia, lo que confirma que el error viene de la fuente.
- **Contexto:** según la nota de la página, la entidad se separó del Grupo Financiero Agromercantil y su cartera llega a 0, así que estaba cerrando operaciones.
- **Impacto:** bajo, porque el proyecto se centra en los bancos del sistema y no en el off-shore.

## Indicadores publicados vs. calculados

- **Eficiencia del sistema** (`gastos de administración / margen operacional bruto`): coincide con la SIB en los 5 años (64.2, 59.7, 62.4, 66.5, 68.5 %).
- **Solvencia del sistema** (`capital contable / activo`): coincide con el "patrimonio con relación a activos" de la SIB en 2025 (10.2 %).
- **Eficiencia sin sentido:** si el margen operacional bruto es ≤ 0, el ratio no significa nada y se deja vacío. Caso: Banco Ficohsa 2025, cuya ganancia sale de productos extraordinarios.

- **ROE del sistema:** calculado como `ganancia neta / capital contable de cierre`, sale 3 a 5 puntos por debajo del ROE de la SIB. Con `ganancia neta / (capital contable − resultado del ejercicio)` queda a menos de 1 punto.
- **Lectura:** la SIB probablemente usa el patrimonio sin la utilidad del año y saldos promedio.
- **Pendiente:** confirmar la fórmula con las definiciones del boletín mensual (pág. 9) y documentarla aquí.
