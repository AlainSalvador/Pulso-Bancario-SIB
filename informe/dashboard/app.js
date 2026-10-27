/* Pulso Bancario GT
 * Lee datos/base.json (lo que sale de los boletines de la SIB, generado por src/datos_dashboard.py)
 * y datos/editorial.json (notas, conclusiones, correcciones y periodos agregados a mano).
 * Los indicadores por banco se calculan aquí, así una corrección se refleja en todo el tablero.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ formato
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const nf = (d) => new Intl.NumberFormat("es-GT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const F = [nf(0), nf(1), nf(2)];
  const ok = (v) => v != null && Number.isFinite(v);
  const fNum = (v, d = 1) => (ok(v) ? F[d].format(v) : "—");
  const fPct = (v, d = 1) => (ok(v) ? F[d].format(v) + "%" : "—");
  const fRatio = (v, d = 1) => (ok(v) ? F[d].format(v * 100) + "%" : "—");
  const fVar = (v) => (ok(v) ? (v > 0 ? "+" : "") + F[1].format(v * 100) + "%" : "—");
  const fPP = (v) => (ok(v) ? (v > 0 ? "+" : "") + F[1].format(v) + " pp" : "—");
  const fMillardos = (miles) => (ok(miles) ? F[1].format(miles / 1e6) : "—");
  const fMillones = (miles) => (ok(miles) ? F[0].format(miles / 1e3) : "—");
  const fQ = (miles) => {
    if (!ok(miles)) return "—";
    const a = Math.abs(miles);
    if (a >= 1e6) return "Q" + F[1].format(miles / 1e6) + " millardos";
    if (a >= 1e3) return "Q" + F[1].format(miles / 1e3) + " millones";
    return "Q" + F[0].format(miles) + " mil";
  };
  const fPer = (p) => `${MESES[+p.slice(5) - 1]} ${p.slice(0, 4)}`;
  const fPerCorto = (p) => (p.endsWith("-12") ? p.slice(0, 4) : `${MESES[+p.slice(5) - 1]} ${p.slice(2, 4)}`);
  const fPerLargo = (p) => {
    const [a, m] = p.split("-").map(Number);
    return `${new Date(a, m, 0).getDate()} de ${MESES_LARGOS[m - 1]} de ${a}`;
  };
  const fechaDe = (p) => new Date(+p.slice(0, 4), +p.slice(5) - 1, 15);
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const parrafos = (t) => esc(t).split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const div = (a, b) => (ok(a) && ok(b) && b !== 0 ? a / b : null);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const anioAntes = (p) => `${+p.slice(0, 4) - 1}-${p.slice(5)}`;

  // ------------------------------------------------------------------ catálogos
  const CUENTAS_BAL = [
    ["disponibilidades", "Disponibilidades"], ["inversiones", "Inversiones"], ["cartera_de_creditos", "Cartera de créditos"],
    ["otros", "Otros activos"], ["total_de_activo", "Total de activo"], ["obligaciones_depositarias", "Obligaciones depositarias"],
    ["creditos_obtenidos", "Créditos obtenidos"], ["obligaciones_financieras", "Obligaciones financieras"],
    ["otros_pasivos", "Otros pasivos"], ["otras_cuentas_acreedoras", "Otras cuentas acreedoras"],
    ["capital_contable", "Capital contable"], ["total_pasivo_y_capital", "Total pasivo y capital"],
  ];
  const CUENTAS_RES = [
    ["productos_financieros", "Productos financieros"], ["gastos_financieros", "(−) Gastos financieros"],
    ["margen_por_inversion", "Margen por inversión"], ["productos_por_servicios", "Productos por servicios"],
    ["gastos_por_servicios", "(−) Gastos por servicios"], ["margen_por_servicios", "Margen por servicios"],
    ["margen_de_otros_productos_y_gastos_de_operacion", "Otros productos y gastos de operación"],
    ["margen_operacional_bruto", "Margen operacional bruto"], ["gastos_de_administracion", "(−) Gastos de administración"],
    ["margen_operacional_neto", "Margen operacional neto"], ["productos_y_gastos_extraordinarios", "Productos y gastos extraordinarios"],
    ["productos_y_gastos_de_ejercicios_anteriores", "Ejercicios anteriores"], ["ganancia_bruta", "Ganancia bruta"],
    ["impuesto_sobre_la_renta", "(−) Impuesto sobre la renta"], ["ganancia_neta", "Ganancia neta"],
  ];
  const TOTALES = new Set(["total_de_activo", "total_pasivo_y_capital", "margen_operacional_bruto", "margen_operacional_neto", "ganancia_neta"]);
  const OFICIALES = [
    ["iac", "Adecuación de capital"], ["li", "Liquidez inmediata"], ["lm", "Liquidez mediata"], ["pa", "Patrimonio / activos"],
    ["roe", "ROE"], ["roa", "ROA"], ["ef", "Eficiencia"], ["cvc", "Cartera vencida / bruta"], ["ccr", "Cobertura de cartera en riesgo"],
  ];
  const ETIQUETA = Object.fromEntries([...CUENTAS_BAL, ...CUENTAS_RES, ...OFICIALES]);
  const SEGMENTOS = [["empresarial", "Empresarial"], ["productivo", "Productivo"], ["hipotecario", "Hipotecario para vivienda"], ["consumo", "Consumo"]];
  const SERIE = ["--s1", "--s2", "--s3", "--s4", "--s5"];

  // Criterios del tablero para etiquetar las señales (no son normas de la SIB).
  const UMBRALES = {
    iac: { nombre: "Adecuación de capital", mayorMejor: true, cortes: [[14, "bien", "Holgada"], [12, "atencion", "Adecuada"], [-Infinity, "serio", "Ajustada"]], ref: 10, refEtq: "Mínimo legal 10%" },
    cvc: { nombre: "Morosidad", mayorMejor: false, cortes: [[1.5, "bien", "Baja"], [3, "atencion", "Moderada"], [Infinity, "critico", "Alta"]] },
    ccr: { nombre: "Cobertura con reservas", mayorMejor: true, cortes: [[150, "bien", "Amplia"], [100, "atencion", "Suficiente"], [-Infinity, "critico", "Insuficiente"]], ref: 100, refEtq: "100%" },
    roe: { nombre: "Rentabilidad (ROE)", mayorMejor: true, cortes: [[15, "bien", "Alta"], [10, "atencion", "Media"], [-Infinity, "serio", "Baja"]] },
    li: { nombre: "Liquidez inmediata", mayorMejor: true, cortes: [[15, "bien", "Holgada"], [10, "atencion", "Adecuada"], [-Infinity, "serio", "Ajustada"]] },
    ef: { nombre: "Eficiencia", mayorMejor: false, cortes: [[60, "bien", "Eficiente"], [70, "atencion", "Media"], [Infinity, "serio", "Costosa"]] },
  };
  function estadoDe(clave, v) {
    const u = UMBRALES[clave];
    for (const [lim, estado, etq] of u.cortes) {
      if (u.mayorMejor ? v >= lim : v <= lim) return { estado, etq };
    }
    return { estado: "info", etq: "—" };
  }

  const PISTAS = {
    salud: "¿El sistema está más o menos sólido que hace dos años? ¿Qué indicador te preocupa y por qué?",
    credito: "¿Hacia dónde se está yendo el crédito y qué riesgo trae ese cambio?",
    depositos: "¿Qué dice la mezcla de depósitos sobre el comportamiento del público?",
    bancos: "¿Qué bancos destacan, para bien o para mal, y qué explica la diferencia?",
  };

  // ------------------------------------------------------------------ estado
  const E = {
    base: null, ed: null, m: null,
    modo: "lectura",       // lectura | artifact | local
    art: null, dl: null,
    pendientes: 0,
    periodo: null, banco: null,
    orden: { col: "activo", dir: -1 },
    tablas: {}, tablaVista: new Set(),
  };
  const editando = () => document.body.classList.contains("editando");

  const EDITORIAL_VACIO = () => ({ version: 1, notas: {}, notas_banco: {}, conclusiones: [], ajustes: [], periodos: [], fuentes: [] });
  const normalizar = (e) => ({ ...EDITORIAL_VACIO(), ...(e || {}) });

  async function json(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  // ------------------------------------------------------------------ modelo
  const MAPA_BALANCE = {
    disponibilidades: "disponibilidades", inversiones: "inversiones", cartera_neta: "cartera_de_creditos",
    total_activo: "total_de_activo", obligaciones_depositarias: "obligaciones_depositarias",
    creditos_obtenidos: "creditos_obtenidos", obligaciones_financieras: "obligaciones_financieras", capital_contable: "capital_contable",
  };
  const MAPA_RESUMEN = { liquidez_inmediata: "li", liquidez_mediata: "lm", patrimonio_activos: "pa", roe: "roe", roa: "roa", cartera_vencida: "cvc" };

  function recalcular() {
    const b = E.base, ed = E.ed;
    const S = {};
    for (const [ent, pers] of Object.entries(b.anual.series)) {
      S[ent] = {};
      for (const [p, c] of Object.entries(pers)) S[ent][p] = { ...c };
    }
    const OF = {};
    const oa = b.oficiales_anual;
    oa.periodos.forEach((p, i) => {
      OF[p] = {};
      for (const k of Object.keys(oa)) if (k !== "periodos") OF[p][k] = oa[k][i];
    });
    const IAC = [];
    for (const mm of b.mensual) {
      const bal = mm.balance;
      bal.cortes.forEach((c, i) => {
        const o = (S.sistema[c] ||= {});
        for (const [k, dest] of Object.entries(MAPA_BALANCE)) {
          const v = (bal.activo[k] || bal.pasivo[k])?.[i];
          if (ok(v) && !ok(o[dest])) o[dest] = v;
        }
      });
      mm.resultados.cortes.forEach((c, i) => {
        const o = S.sistema[c];
        if (o && !ok(o.ganancia_neta)) o.ganancia_neta = mm.resultados.resultado[i];
      });
      OF[mm.corte] = { ...(OF[mm.corte] || {}) };
      for (const [k, d] of Object.entries(MAPA_RESUMEN)) if (ok(mm.resumen[k])) OF[mm.corte][d] = mm.resumen[k];
      for (const f of mm.capital_encaje.patrimonio) {
        if (!IAC.some((x) => x.mes === f.mes)) IAC.push({ mes: f.mes, iac: f.iac });
        (OF[f.mes] ||= {});
        if (!ok(OF[f.mes].iac)) OF[f.mes].iac = f.iac;
      }
    }
    const BASE = structuredClone(S);
    for (const p of ed.periodos) {
      const o = ((S[p.entidad] ||= {})[p.periodo] ||= {});
      Object.assign(o, p.cuentas || {});
      if (p.entidad === "sistema" && p.oficiales) {
        OF[p.periodo] = { ...(OF[p.periodo] || {}), ...p.oficiales };
        if (ok(p.oficiales.iac) && !IAC.some((x) => x.mes === p.periodo)) IAC.push({ mes: p.periodo, iac: p.oficiales.iac, agregado: true });
      }
    }
    for (const a of ed.ajustes) {
      const o = S[a.entidad]?.[a.periodo];
      if (o) o[a.campo] = a.valor;
    }
    IAC.sort((x, y) => x.mes.localeCompare(y.mes));
    const perBancos = [...new Set(b.bancos.flatMap((x) => Object.keys(S[x.id] || {}).filter((p) => ok(S[x.id][p].total_de_activo))))].sort();
    const perSistema = Object.keys(S.sistema).filter((p) => ok(S.sistema[p].total_de_activo)).sort();
    const perOF = Object.keys(OF).sort();
    E.m = { S, BASE, OF, IAC, perBancos, perSistema, perOF };
    if (!E.periodo || !perBancos.includes(E.periodo)) {
      E.periodo = [...perBancos].reverse().find((p) => p.endsWith("-12")) || perBancos.at(-1);
    }
  }

  function ind(ent, per) {
    const c = E.m.S[ent]?.[per];
    if (!c || !ok(c.total_de_activo)) return null;
    const f = 12 / +per.slice(5);
    const sis = E.m.S.sistema?.[per];
    const prev = E.m.S[ent]?.[anioAntes(per)];
    const crec = (k) => (prev && ok(prev[k]) && prev[k] > 0 && ok(c[k]) ? c[k] / prev[k] - 1 : null);
    return {
      activo: c.total_de_activo, cartera: c.cartera_de_creditos, depositos: c.obligaciones_depositarias, capital: c.capital_contable,
      ganancia: c.ganancia_neta,
      solvencia: div(c.capital_contable, c.total_de_activo),
      liquidez: div(c.disponibilidades, c.obligaciones_depositarias),
      roe: ok(c.ganancia_neta) ? div(c.ganancia_neta * f, c.capital_contable) : null,
      roa: ok(c.ganancia_neta) ? div(c.ganancia_neta * f, c.total_de_activo) : null,
      eficiencia: c.margen_operacional_bruto > 0 ? div(c.gastos_de_administracion, c.margen_operacional_bruto) : null,
      intermediacion: div(c.cartera_de_creditos, c.obligaciones_depositarias),
      participacion: ent === "sistema" ? 1 : div(c.total_de_activo, sis?.total_de_activo),
      crec_cartera: crec("cartera_de_creditos"), crec_depositos: crec("obligaciones_depositarias"), crec_activo: crec("total_de_activo"),
      margen_bruto: c.margen_operacional_bruto, extraordinarios: c.productos_y_gastos_extraordinarios, ganancia_bruta: c.ganancia_bruta,
    };
  }

  function banderas(ent, per) {
    const i = ind(ent, per), s = ind("sistema", per);
    if (!i) return [];
    const out = [];
    if (ok(i.margen_bruto) && i.margen_bruto <= 0) out.push(["critico", "Margen operacional negativo"]);
    if (ok(i.ganancia) && i.ganancia < 0) out.push(["critico", "Pérdida en el periodo"]);
    if (ok(i.extraordinarios) && ok(i.ganancia_bruta) && i.ganancia_bruta > 0 && i.extraordinarios > i.ganancia_bruta)
      out.push(["serio", "La ganancia depende de ingresos extraordinarios"]);
    if (ok(i.margen_bruto) && i.margen_bruto > 0 && ok(i.eficiencia) && i.eficiencia > 1) out.push(["serio", "Los gastos superan el margen"]);
    if (s && ok(i.solvencia) && ok(s.solvencia) && i.solvencia < s.solvencia * 0.85) out.push(["atencion", "Capital propio bajo frente al sistema"]);
    if (s && ok(i.crec_cartera) && ok(s.crec_cartera) && i.crec_cartera > s.crec_cartera + 0.15) out.push(["atencion", "Cartera crece mucho más que el sistema"]);
    if (ok(i.intermediacion) && i.intermediacion < 0.2) out.push(["info", "Presta poco de lo que capta"]);
    return out;
  }

  const serieSistema = (k) => E.m.perSistema.map((p) => ({ p, v: E.m.S.sistema[p][k] })).filter((d) => ok(d.v));
  const serieOficial = (k) => E.m.perOF.map((p) => ({ p, v: E.m.OF[p][k] })).filter((d) => ok(d.v));
  const ultimoMensual = () => E.base.mensual.at(-1);

  // ------------------------------------------------------------------ tooltip
  const tip = () => $("#tooltip");
  function mostrarTip(html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, top) + "px";
  }
  const ocultarTip = () => { tip().hidden = true; };
  const filaTip = (color, etq, valor) => `<div class="fila"><span>${color ? `<i style="background:${color}"></i>` : ""}${esc(etq)}</span><span class="num">${valor}</span></div>`;

  function toast(msg, ms = 3600) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ gráficas
  function leyenda(series, tipo = "linea") {
    if (series.length < 2) return "";
    const cls = tipo === "bloque" ? "bloque-l" : tipo === "punto" ? "punto" : "";
    return `<div class="leyenda">${series.map((s) => `<span><i class="${cls}" style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;
  }

  /** Líneas sobre el tiempo. series: [{id, label, color, datos:[{p, v}]}] */
  function lineas(el, cfg) {
    const series = cfg.series.map((s) => ({ ...s, datos: s.datos.filter((d) => ok(d.v)) })).filter((s) => s.datos.length);
    el.innerHTML = cfg.compacto ? "" : leyenda(series);
    if (!series.length) { el.insertAdjacentHTML("beforeend", `<p class="nota-chica">Sin datos.</p>`); return; }
    const W = Math.max(el.clientWidth, 240), H = cfg.alto || 220;
    const conEjeY = !cfg.compacto || cfg.ejeY;
    const m = cfg.compacto ? { t: 10, r: 44, b: 18, l: cfg.ejeY ? 36 : 6 } : { t: 14, r: cfg.margenDer ?? 58, b: 26, l: 46 };
    const todos = series.flatMap((s) => s.datos);
    const xs = [...new Set(todos.map((d) => d.p))].sort();
    const x = xs.length > 1
      ? d3.scaleTime().domain(d3.extent(xs, fechaDe)).range([m.l, W - m.r])
      : d3.scaleTime().domain([d3.timeMonth.offset(fechaDe(xs[0]), -1), d3.timeMonth.offset(fechaDe(xs[0]), 1)]).range([m.l, W - m.r]);
    const vals = [...todos.map((d) => d.v), ...(cfg.refs || []).map((r) => r.v)];
    let [y0, y1] = cfg.dominioY || d3.extent(vals);
    const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.14;
    if (!cfg.dominioY) { y0 -= pad; y1 += pad; if (cfg.desdeCero) y0 = Math.min(0, y0); }
    const y = d3.scaleLinear().domain([y0, y1]).nice(4).range([H - m.b, m.t]);
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H).attr("role", "img")
      .attr("aria-label", cfg.titulo || series.map((s) => s.label).join(", "));
    const fmt = cfg.fmt || ((v) => fNum(v));

    if (conEjeY) {
      const nt = cfg.compacto ? 3 : 4;
      svg.append("g").attr("class", "rejilla").attr("transform", `translate(${m.l},0)`)
        .call(d3.axisLeft(y).ticks(nt).tickSize(-(W - m.l - m.r)).tickFormat(""));
      svg.append("g").attr("class", "eje").attr("transform", `translate(${m.l},0)`)
        .call(d3.axisLeft(y).ticks(nt).tickSize(0).tickPadding(cfg.compacto ? 5 : 8).tickFormat((v) => (cfg.fmtEje || fmt)(v))).call((g) => g.select(".domain").remove());
    }
    // etiquetas del eje x elegidas desde el final, sin que dos queden a menos de una distancia mínima
    const sep = cfg.compacto ? 44 : 56;
    const xsEtq = [];
    for (let i = xs.length - 1; i >= 0; i--) {
      const px = x(fechaDe(xs[i]));
      if (!xsEtq.length || x(fechaDe(xsEtq.at(-1))) - px >= sep) xsEtq.push(xs[i]);
    }
    const gx = svg.append("g").attr("class", "eje");
    gx.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", H - m.b).attr("y2", H - m.b);
    gx.selectAll("text").data(xsEtq).join("text").attr("x", (p) => x(fechaDe(p))).attr("y", H - m.b + (cfg.compacto ? 13 : 17))
      .attr("text-anchor", "middle").text((p) => fPerCorto(p));

    for (const r of cfg.refs || []) {
      svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(r.v)).attr("y2", y(r.v)).attr("stroke", css("--critico")).attr("stroke-opacity", 0.55);
      svg.append("text").attr("class", "etq-ref").attr("x", m.l + 4).attr("y", y(r.v) - 4).text(r.label);
    }
    for (const mk of cfg.marcas || []) {
      const xm = x(fechaDe(mk.p));
      if (xm < m.l || xm > W - m.r) continue;
      svg.append("line").attr("x1", xm).attr("x2", xm).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--atencion")).attr("stroke-width", 1.5);
      svg.append("text").attr("class", "etq-ref").attr("x", xm + 4).attr("y", m.t + 9).text(mk.label);
    }

    const linea = d3.line().x((d) => x(fechaDe(d.p))).y((d) => y(d.v)).curve(d3.curveMonotoneX);
    if (series.length === 1 && !cfg.sinArea) {
      const area = d3.area().x((d) => x(fechaDe(d.p))).y0(H - m.b).y1((d) => y(d.v)).curve(d3.curveMonotoneX);
      svg.append("path").attr("d", area(series[0].datos)).attr("fill", series[0].color).attr("fill-opacity", 0.1);
    }
    for (const s of series) {
      svg.append("path").attr("d", linea(s.datos)).attr("fill", "none").attr("stroke", s.color)
        .attr("stroke-width", s.ancho || 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
    }
    // etiquetas finales sin choques: si dos quedan a menos de 12px, la leyenda las nombra
    const finales = series.map((s) => ({ s, d: s.datos.at(-1) })).map((o) => ({ ...o, yy: y(o.d.v) })).sort((a, b) => a.yy - b.yy);
    finales.forEach((o, i) => {
      svg.append("circle").attr("cx", x(fechaDe(o.d.p))).attr("cy", o.yy).attr("r", 4).attr("fill", o.s.color).attr("class", "anillo");
      const choca = (i > 0 && o.yy - finales[i - 1].yy < 12) || (i < finales.length - 1 && finales[i + 1].yy - o.yy < 12);
      if (cfg.etiquetasFin !== false && (!choca || series.length === 1)) {
        svg.append("text").attr("class", "etq-valor").attr("x", x(fechaDe(o.d.p)) + 8).attr("y", o.yy + 4).text(fmt(o.d.v));
      }
    });

    // capa de lectura: cruz + tooltip
    const cruz = svg.append("line").attr("class", "cruz").attr("y1", m.t).attr("y2", H - m.b).attr("opacity", 0);
    const puntos = svg.append("g");
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b)
      .attr("fill", "transparent")
      .on("pointermove", (ev) => {
        const [px] = d3.pointer(ev);
        const fecha = x.invert(px);
        const p = xs.reduce((a, b) => (Math.abs(fechaDe(b) - fecha) < Math.abs(fechaDe(a) - fecha) ? b : a));
        const xp = x(fechaDe(p));
        cruz.attr("x1", xp).attr("x2", xp).attr("opacity", 1);
        const en = series.map((s) => ({ s, d: s.datos.find((d) => d.p === p) })).filter((o) => o.d);
        puntos.selectAll("circle").data(en).join("circle").attr("cx", xp).attr("cy", (o) => y(o.d.v)).attr("r", 4)
          .attr("fill", (o) => o.s.color).attr("class", "anillo");
        mostrarTip(`<h5>${fPer(p)}</h5>${en.map((o) => filaTip(o.s.color, o.s.label, fmt(o.d.v))).join("")}`, ev.clientX, ev.clientY);
      })
      .on("pointerleave", () => { cruz.attr("opacity", 0); puntos.selectAll("*").remove(); ocultarTip(); });

    return {
      cols: ["Periodo", ...series.map((s) => s.label)],
      filas: xs.map((p) => [fPer(p), ...series.map((s) => { const d = s.datos.find((d) => d.p === p); return d ? fmt(d.v) : "—"; })]),
    };
  }

  /** Barras horizontales en HTML. filas: [{label, v, texto, sub, partes?:[{v,color,label}]}] */
  function barras(el, filas, cfg = {}) {
    const max = cfg.max || d3.max(filas, (f) => f.v) || 1;
    el.innerHTML = (cfg.leyenda ? leyenda(cfg.leyenda, "bloque") : "") + `<div class="barras">${filas.map((f, i) => `
      <div class="barra-fila" data-i="${i}">
        <div class="barra-etq"><span>${esc(f.label)}</span><span class="num">${f.texto}</span></div>
        <div class="barra-pista" style="width:${Math.max(2, (f.v / max) * 100)}%">${(f.partes || [{ v: f.v, color: cfg.color || css("--s1") }])
          .map((p) => `<span style="width:${(p.v / f.v) * 100}%;background:${p.color}"></span>`).join("")}</div>
        ${f.sub ? `<div class="barra-sub">${f.sub}</div>` : ""}
      </div>`).join("")}</div>`;
    // la pista es el ancho relativo; el color va en los segmentos
    $$(".barra-pista", el).forEach((p) => { p.style.background = "transparent"; });
  }

  /** Columnas apiladas por periodo. series: [{id, label, color, valores:[...]}] alineados con cortes */
  function columnas(el, cortes, series, cfg = {}) {
    el.innerHTML = leyenda(series, "bloque");
    const W = Math.max(el.clientWidth, 260), H = cfg.alto || 240;
    const m = { t: 22, r: 8, b: 26, l: 52 };
    const totales = cortes.map((_, i) => d3.sum(series, (s) => s.valores[i] || 0));
    const x = d3.scaleBand().domain(cortes).range([m.l, W - m.r]).padding(0.35);
    const y = d3.scaleLinear().domain([0, d3.max(totales)]).nice(4).range([H - m.b, m.t]);
    const fmt = cfg.fmt || ((v) => fNum(v, 0));
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H).attr("role", "img").attr("aria-label", cfg.titulo || "");
    svg.append("g").attr("class", "rejilla").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "eje").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8).tickFormat(cfg.fmtEje || fmt)).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "eje").selectAll("text").data(cortes).join("text")
      .attr("x", (c) => x(c) + x.bandwidth() / 2).attr("y", H - m.b + 17).attr("text-anchor", "middle").text((c) => fPerCorto(c));
    const ancho = Math.min(24, x.bandwidth());
    cortes.forEach((c, i) => {
      let acum = 0;
      const cx = x(c) + (x.bandwidth() - ancho) / 2;
      const visibles = series.filter((s) => (s.valores[i] || 0) > 0);
      visibles.forEach((s, j) => {
        const v = s.valores[i];
        const y0 = y(acum), y1 = y(acum + v);
        acum += v;
        const alto = Math.max(0, y0 - y1 - 2);
        const ultimo = j === visibles.length - 1;
        const r = ultimo ? Math.min(4, alto) : 0;
        const top = y1 + 2, bottom = top + alto;
        const d = `M${cx},${bottom}V${top + r}Q${cx},${top} ${cx + r},${top}H${cx + ancho - r}Q${cx + ancho},${top} ${cx + ancho},${top + r}V${bottom}Z`;
        svg.append("path").attr("d", d).attr("fill", s.color)
          .on("pointermove", (ev) => mostrarTip(`<h5>${fPer(c)}</h5>${filaTip(s.color, s.label, fmt(v))}${filaTip("", "Total", fmt(totales[i]))}`, ev.clientX, ev.clientY))
          .on("pointerleave", ocultarTip);
      });
      svg.append("text").attr("class", "etq-valor").attr("x", x(c) + x.bandwidth() / 2).attr("y", y(totales[i]) - 6).attr("text-anchor", "middle").text(fmt(totales[i]));
    });
    return {
      cols: ["Periodo", ...series.map((s) => s.label), "Total"],
      filas: cortes.map((c, i) => [fPer(c), ...series.map((s) => fmt(s.valores[i])), fmt(totales[i])]),
    };
  }

  /** Dispersión crecimiento de cartera vs ROE, burbuja = activo */
  function dispersion(el, puntos, ref, cfg) {
    el.innerHTML = "";
    if (!puntos.length) { el.innerHTML = `<p class="nota-chica">No hay crecimiento interanual para este periodo: falta el año anterior.</p>`; return { cols: [], filas: [] }; }
    const W = Math.max(el.clientWidth, 280), H = cfg.alto || 330;
    const m = { t: 16, r: 18, b: 36, l: 48 };
    const xsv = puntos.map((d) => d.x).sort(d3.ascending), ysv = puntos.map((d) => d.y).sort(d3.ascending);
    const rango = (arr, extra) => {
      const lo = d3.quantile(arr, 0.06), hi = d3.quantile(arr, 0.94);
      const pad = (hi - lo) * 0.25 || 0.05;
      return [Math.min(lo - pad, ...extra), Math.max(hi + pad, ...extra)];
    };
    const x = d3.scaleLinear().domain(rango(xsv, [ref.x ?? 0, 0])).nice().range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain(rango(ysv, [ref.y ?? 0, 0])).nice().range([H - m.b, m.t]);
    const r = d3.scaleSqrt().domain([0, d3.max(puntos, (d) => d.activo)]).range([3, Math.min(26, W / 28)]);
    const [x0, x1] = x.domain(), [y0, y1] = y.domain();
    const cx = (v) => x(Math.max(x0, Math.min(x1, v))), cy = (v) => y(Math.max(y0, Math.min(y1, v)));
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H).attr("role", "img")
      .attr("aria-label", "Crecimiento de cartera contra ROE por banco");
    svg.append("g").attr("class", "rejilla").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "eje").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat((v) => F[0].format(v * 100) + "%")).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "eje").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 90))).tickSize(0).tickPadding(10).tickFormat((v) => F[0].format(v * 100) + "%"))
      .call((g) => g.select(".domain").attr("stroke", css("--eje")));
    svg.append("text").attr("class", "etq-eje").attr("x", W - m.r).attr("y", H - 4).attr("text-anchor", "end").text("Crecimiento de cartera →");
    svg.append("text").attr("class", "etq-eje").attr("x", m.l + 4).attr("y", m.t + 2).text("↑ ROE");
    if (ok(ref.x)) {
      svg.append("line").attr("x1", x(ref.x)).attr("x2", x(ref.x)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--sistema"));
      svg.append("text").attr("class", "etq-ref").attr("x", x(ref.x) + 4).attr("y", H - m.b - 6).text("sistema");
    }
    if (ok(ref.y)) {
      svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(ref.y)).attr("y2", y(ref.y)).attr("stroke", css("--sistema"));
      svg.append("text").attr("class", "etq-ref").attr("x", W - m.r - 4).attr("y", y(ref.y) - 5).attr("text-anchor", "end").text("ROE del sistema");
    }
    const orden = [...puntos].sort((a, b) => b.activo - a.activo);
    const top = new Set(orden.slice(0, 5).map((d) => d.id));
    const g = svg.append("g");
    g.selectAll("circle").data(orden).join("circle")
      .attr("cx", (d) => cx(d.x)).attr("cy", (d) => cy(d.y)).attr("r", (d) => r(d.activo))
      .attr("fill", (d) => (d.id === E.banco ? css("--acento") : top.has(d.id) ? css("--s1") : css("--sistema")))
      .attr("fill-opacity", (d) => (d.id === E.banco ? 0.9 : top.has(d.id) ? 0.55 : 0.35))
      .attr("class", "anillo");
    // etiquetas: a la derecha, izquierda, arriba o abajo de la burbuja, la primera posición que no choque
    const cajas = [];
    const choca = (b) => cajas.some((c) => b.x < c.x + c.w && b.x + b.w > c.x && b.y < c.y + c.h && b.y + b.h > c.y)
      || b.x < m.l || b.x + b.w > W - m.r || b.y < m.t || b.y + b.h > H - m.b;
    const etiquetados = orden.filter((d) => top.has(d.id) || d.id === E.banco);
    if (E.banco) etiquetados.sort((a, b) => (b.id === E.banco) - (a.id === E.banco));
    for (const d of etiquetados) {
      const w = d.corto.length * 6.6 + 4, h = 14, px = cx(d.x), py = cy(d.y), rr = r(d.activo);
      const opciones = [
        { x: px + rr + 4, y: py - h / 2, anchor: "start" }, { x: px - rr - 4 - w, y: py - h / 2, anchor: "end" },
        { x: px - w / 2, y: py - rr - h - 2, anchor: "middle" }, { x: px - w / 2, y: py + rr + 2, anchor: "middle" },
      ];
      const o = opciones.find((b) => !choca({ ...b, w, h }));
      if (!o) continue;
      cajas.push({ ...o, w, h });
      const tx = o.anchor === "start" ? o.x : o.anchor === "end" ? o.x + w : o.x + w / 2;
      g.append("text").attr("class", "etq-serie").attr("x", tx).attr("y", o.y + 11).attr("text-anchor", o.anchor)
        .style("font-weight", d.id === E.banco ? 600 : null).text(d.corto);
    }
    const delaunay = d3.Delaunay.from(puntos, (d) => cx(d.x), (d) => cy(d.y));
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("pointermove", (ev) => {
        const [px, py] = d3.pointer(ev);
        const d = puntos[delaunay.find(px, py)];
        mostrarTip(`<h5>${esc(d.nombre)}</h5>${filaTip("", "Crecimiento de cartera", fVar(d.x))}${filaTip("", "ROE", fRatio(d.y))}${filaTip("", "Activo", fQ(d.activo))}`, ev.clientX, ev.clientY);
      })
      .on("pointerleave", ocultarTip)
      .on("click", (ev) => { const [px, py] = d3.pointer(ev); abrirBanco(puntos[delaunay.find(px, py)].id); });
    return {
      cols: ["Banco", "Crecimiento de cartera", "ROE", "Activo (Q millones)"],
      filas: orden.map((d) => [d.nombre, fVar(d.x), fRatio(d.y), fMillones(d.activo)]),
    };
  }

  /** Cascada del estado de resultados en barras horizontales */
  function cascada(el, pasos) {
    el.innerHTML = leyenda([{ label: "Suma", color: css("--pos") }, { label: "Resta", color: css("--neg") }, { label: "Subtotal", color: css("--sistema") }], "bloque");
    const W = Math.max(el.clientWidth, 280);
    const etqW = Math.min(210, W * 0.42), fila = 24, H = pasos.length * fila + 26;
    let acum = 0;
    const barras_ = pasos.map((p) => {
      if (p.tipo === "total") { const b = { ...p, a: 0, b: p.v }; acum = p.v; return b; }
      const b = { ...p, a: acum, b: acum + p.v }; acum += p.v; return b;
    });
    const ext = d3.extent(barras_.flatMap((b) => [b.a, b.b, 0]));
    const x = d3.scaleLinear().domain(ext).nice().range([etqW + 6, W - 64]);
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H).attr("role", "img").attr("aria-label", "Cascada de resultados");
    svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", H - 20).attr("stroke", css("--eje"));
    barras_.forEach((b, i) => {
      const yy = i * fila + 4;
      const color = b.tipo === "total" ? css("--sistema") : b.v >= 0 ? css("--pos") : css("--neg");
      const x0 = x(Math.min(b.a, b.b)), w = Math.max(1.5, Math.abs(x(b.b) - x(b.a)));
      svg.append("text").attr("class", b.tipo === "total" ? "etq-valor" : "etq-serie").attr("x", 0).attr("y", yy + 12).text(b.label);
      svg.append("rect").attr("x", x0).attr("y", yy + 2).attr("width", w).attr("height", fila - 10).attr("rx", 3).attr("fill", color)
        .on("pointermove", (ev) => mostrarTip(`<h5>${esc(b.label)}</h5>${filaTip(color, b.tipo === "total" ? "Subtotal" : "Monto", fQ(b.v))}`, ev.clientX, ev.clientY))
        .on("pointerleave", ocultarTip);
      svg.append("text").attr("class", "etq-valor").attr("x", Math.max(x(b.a), x(b.b)) + 6).attr("y", yy + 12).text(fMillones(b.v));
    });
    svg.append("text").attr("class", "etq-ref").attr("x", W - 4).attr("y", H - 4).attr("text-anchor", "end").text("Q millones");
  }

  function sparkline(valores, w = 76, h = 22, color = css("--acento")) {
    const v = valores.filter((d) => ok(d.v));
    if (v.length < 2) return "";
    const x = d3.scaleLinear().domain([0, v.length - 1]).range([2, w - 4]);
    const [a, b] = d3.extent(v, (d) => d.v);
    const y = d3.scaleLinear().domain(a === b ? [a - 1, b + 1] : [a, b]).range([h - 3, 3]);
    const d = d3.line().x((_, i) => x(i)).y((p) => y(p.v)).curve(d3.curveMonotoneX)(v);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/><circle cx="${x(v.length - 1)}" cy="${y(v.at(-1).v)}" r="2.6" fill="${color}"/></svg>`;
  }

  function tablaSimple(cols, filas) {
    return `<div class="tabla-simple-env"><table class="tabla-simple"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function registrarTabla(id, datos) {
    E.tablas[id] = datos;
    const card = document.getElementById(id);
    if (!card) return;
    const vista = E.tablaVista.has(id);
    $$(".grafica, .multiples", card).forEach((g) => { g.hidden = vista; });
    let t = $(".vista-tabla", card);
    if (vista) {
      if (!t) { t = document.createElement("div"); t.className = "vista-tabla"; card.appendChild(t); }
      t.innerHTML = tablaSimple(datos.cols, datos.filas);
    } else if (t) t.remove();
    const btn = $(".btn-tabla", card);
    if (btn) { btn.setAttribute("aria-pressed", String(vista)); btn.textContent = vista ? "Gráfica" : "Tabla"; }
  }

  // ------------------------------------------------------------------ secciones
  function renderMeta() {
    const b = E.base;
    $("#m-corte").textContent = b.ultimo_corte ? fPerLargo(b.ultimo_corte) : "—";
    $("#m-corte-banco").textContent = E.m.perBancos.length ? fPerLargo(E.m.perBancos.at(-1)) : "—";
    const g = new Date(b.generado);
    $("#m-generado").textContent = `${g.getDate()} ${MESES[g.getMonth()]} ${g.getFullYear()}`;
    const rango = `${fPerCorto(E.m.perOF[0])} – ${fPer(E.m.perOF.at(-1))}`;
    $("#salud-ceja").textContent = `Indicadores oficiales SIB · ${rango}`;
    if (b.ultimo_corte) {
      $("#credito-ceja").textContent = `Cartera del sistema · corte ${fPer(b.ultimo_corte)}`;
      $("#depositos-ceja").textContent = `Captaciones del sistema · ${fPerCorto(ultimoMensual().captaciones.cortes[0])} – ${fPer(b.ultimo_corte)}`;
    }
  }

  function variacion(serie) {
    const u = serie.at(-1);
    if (!u) return null;
    const antes = serie.find((d) => d.p === anioAntes(u.p));
    if (antes) return { v: u.v / antes.v - 1, contra: "en 12 meses" };
    const prev = serie.at(-2);
    return prev ? { v: u.v / prev.v - 1, contra: `vs ${fPer(prev.p)}` } : null;
  }
  function cambioPP(serie) {
    const u = serie.at(-1);
    if (!u) return null;
    // contra el mismo mes del año anterior; si no existe, contra el último cierre de diciembre
    const dic = u.p.endsWith("-12") ? `${+u.p.slice(0, 4) - 1}-12` : `${+u.p.slice(0, 4) - 1}-12`;
    const antes = serie.find((d) => d.p === anioAntes(u.p)) || serie.find((d) => d.p === dic) || serie.at(-2);
    return antes ? { v: u.v - antes.v, contra: `vs ${fPer(antes.p)}` } : null;
  }

  function renderKPIs() {
    const tiles = [];
    const kQ = (etq, clave) => {
      const s = serieSistema(clave), u = s.at(-1), va = variacion(s);
      return { etq, valor: fMillardos(u?.v), unidad: "millardos", prefijo: "Q", delta: va && { txt: `${fVar(va.v)} ${va.contra}`, bueno: va.v >= 0 }, serie: s, per: u?.p };
    };
    tiles.push(kQ("Activos del sistema", "total_de_activo"));
    tiles.push(kQ("Cartera de créditos", "cartera_de_creditos"));
    tiles.push(kQ("Depósitos del público", "obligaciones_depositarias"));
    const kO = (etq, clave, mayorMejor, serieAlt) => {
      const s = serieAlt || serieOficial(clave), u = s.at(-1), c = cambioPP(s);
      return { etq, valor: fNum(u?.v), unidad: "%", delta: c && { txt: `${fPP(c.v)} ${c.contra}`, bueno: mayorMejor ? c.v >= 0 : c.v <= 0 }, serie: s, per: u?.p };
    };
    tiles.push(kO("Adecuación de capital", "iac", true, mezclarIAC()));
    tiles.push(kO("Morosidad", "cvc", false));
    tiles.push(kO("ROE del sistema", "roe", true));
    $("#kpis").innerHTML = tiles.map((t, i) => `
      <article class="kpi glass" data-i="${i}">
        <span class="kpi-etq">${esc(t.etq)}</span>
        <span class="kpi-val">${t.prefijo || ""}${t.valor}<small>${t.unidad === "%" ? "%" : t.unidad}</small></span>
        <span class="kpi-delta">${t.delta ? `<span class="${t.delta.bueno ? "sube" : "baja"}">${t.delta.txt.split(" ")[0]}</span> ${esc(t.delta.txt.split(" ").slice(1).join(" "))}` : "&nbsp;"}</span>
        <svg aria-hidden="true"></svg>
      </article>`).join("");
    $$(".kpi").forEach((el, i) => {
      const t = tiles[i], svgEl = $("svg", el), w = svgEl.clientWidth || 160, h = 34;
      const v = t.serie.filter((d) => ok(d.v));
      if (v.length < 2) return;
      const x = d3.scaleTime().domain(d3.extent(v, (d) => fechaDe(d.p))).range([2, w - 4]);
      const y = d3.scaleLinear().domain(d3.extent(v, (d) => d.v)).range([h - 3, 4]);
      const s = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
      s.append("path").attr("d", d3.area().x((d) => x(fechaDe(d.p))).y0(h).y1((d) => y(d.v)).curve(d3.curveMonotoneX)(v)).attr("fill", css("--acento")).attr("fill-opacity", 0.1);
      s.append("path").attr("d", d3.line().x((d) => x(fechaDe(d.p))).y((d) => y(d.v)).curve(d3.curveMonotoneX)(v)).attr("fill", "none").attr("stroke", css("--acento")).attr("stroke-width", 1.8);
      s.append("circle").attr("cx", x(fechaDe(v.at(-1).p))).attr("cy", y(v.at(-1).v)).attr("r", 3.2).attr("fill", css("--acento"));
      el.addEventListener("pointermove", (ev) => mostrarTip(`<h5>${esc(t.etq)}</h5>${v.slice(-6).map((d) => filaTip("", fPer(d.p), t.unidad === "%" ? fPct(d.v) : "Q" + fMillardos(d.v))).join("")}`, ev.clientX, ev.clientY));
      el.addEventListener("pointerleave", ocultarTip);
    });
  }

  function renderSalud() {
    const claves = ["iac", "cvc", "ccr", "roe", "li", "ef"];
    $("#senales").innerHTML = claves.map((k) => `<article class="senal" id="senal-${k}"></article>`).join("");
    for (const k of claves) {
      const u = UMBRALES[k];
      const s = k === "iac" ? mezclarIAC() : serieOficial(k);
      const el = $(`#senal-${k}`);
      const ult = s.at(-1), pri = s[0];
      if (!ult) { el.innerHTML = `<span class="senal-nombre">${u.nombre}</span><p class="nota-chica">Sin datos.</p>`; continue; }
      const est = estadoDe(k, ult.v);
      const minimo = s.reduce((a, b) => (b.v < a.v ? b : a)), maximo = s.reduce((a, b) => (b.v > a.v ? b : a));
      el.innerHTML = `
        <div class="senal-cab"><span class="senal-nombre">${u.nombre}</span><span class="chip" data-estado="${est.estado}"><i></i>${est.etq}</span></div>
        <span class="senal-val">${fPct(ult.v)}<small>${fPer(ult.p)}</small></span>
        <div class="senal-g"></div>
        <span class="senal-pie">${fPP(ult.v - pri.v)} desde ${fPerCorto(pri.p)} · mín. ${fPct(minimo.v)} (${fPerCorto(minimo.p)}) · máx. ${fPct(maximo.v)}</span>`;
      lineas($(".senal-g", el), {
        compacto: true, alto: 64, fmt: (v) => fPct(v), etiquetasFin: false,
        series: [{ id: k, label: u.nombre, color: css("--acento"), datos: s }],
        refs: u.ref ? [{ v: u.ref, label: u.refEtq }] : [],
      });
    }
    const d = lineas($("#g-iac"), {
      alto: 230, fmt: (v) => fPct(v), dominioY: [8, Math.max(18, d3.max(E.m.IAC, (x) => x.iac) + 1)],
      series: [{ id: "iac", label: "Adecuación de capital", color: css("--acento"), datos: E.m.IAC.map((x) => ({ p: x.mes, v: x.iac })) }],
      refs: [{ v: 10, label: "Mínimo legal 10%" }], titulo: "Adecuación de capital mensual",
    });
    registrarTabla("card-iac", d);
    renderHallazgos();
  }
  // serie de IAC: cierres anuales oficiales + meses del boletín mensual
  function mezclarIAC() {
    const mapa = new Map(serieOficial("iac").map((d) => [d.p, d.v]));
    for (const x of E.m.IAC) mapa.set(x.mes, x.iac);
    return [...mapa].map(([p, v]) => ({ p, v })).sort((a, b) => a.p.localeCompare(b.p));
  }

  function renderHallazgos() {
    const items = [];
    const mm = ultimoMensual();
    if (mm) {
      const bal = mm.balance, i1 = bal.cortes.length - 1, i0 = bal.cortes.indexOf(anioAntes(bal.cortes[i1]));
      if (i0 >= 0) {
        const g = (k) => (bal.activo[k] || bal.pasivo[k])[i1] / (bal.activo[k] || bal.pasivo[k])[i0] - 1;
        const ga = g("total_activo"), gc = g("cartera_neta"), gi = g("inversiones"), gd = g("obligaciones_depositarias");
        let t = `En los doce meses a ${fPer(bal.cortes[i1])} los activos del sistema crecieron <b>${fVar(ga)}</b>. La cartera de créditos creció <b>${fVar(gc)}</b> y las inversiones <b>${fVar(gi)}</b>.`;
        if (gi > gc + 0.05) t += " Los bancos están colocando más dinero en títulos e inversiones que en préstamos.";
        items.push(t);
        if (gd > gc) items.push(`Los depósitos crecieron <b>${fVar(gd)}</b>, más rápido que el crédito: el sistema capta más de lo que presta, y ese excedente se va a inversiones y liquidez.`);
      }
    }
    const cvc = serieOficial("cvc"), ccr = serieOficial("ccr");
    if (cvc.length > 2) {
      const min = cvc.reduce((a, b) => (b.v < a.v ? b : a)), u = cvc.at(-1);
      let t = `La morosidad pasó de <b>${fPct(min.v)}</b> en ${fPerCorto(min.p)} a <b>${fPct(u.v)}</b> en ${fPer(u.p)}.`;
      if (ccr.length > 2) {
        const mx = ccr.reduce((a, b) => (b.v > a.v ? b : a)), uc = ccr.at(-1);
        if (mx.v - uc.v > 20) t += ` En el mismo lapso la cobertura con reservas bajó de <b>${fPct(mx.v)}</b> a <b>${fPct(uc.v)}</b> (${fPer(uc.p)}): hay más cartera vencida y proporcionalmente menos colchón para absorberla.`;
      }
      items.push(t);
    }
    if (mm) {
      const seg = mm.cartera_segmento.segmentos, mora = mm.mora_segmento.mn;
      const mc = mora.consumo?.at(-1), me = mora.empresarial?.at(-1);
      if (ok(mc) && ok(me)) items.push(`El consumo es el <b>${fPct(seg.consumo.participacion)}</b> de la cartera y su mora en quetzales es de <b>${fPct(mc)}</b>, ${F[1].format(mc / me)} veces la del crédito empresarial (<b>${fPct(me)}</b>).`);
      const iac = E.m.IAC.at(-1);
      if (iac) {
        const hace = E.m.IAC.find((x) => x.mes === anioAntes(iac.mes)) || E.m.IAC[0];
        items.push(`La adecuación de capital está en <b>${fPct(iac.iac)}</b>, ${F[1].format(iac.iac - 10)} puntos sobre el mínimo legal de 10%${hace && hace.mes !== iac.mes ? ` (${fPP(iac.iac - hace.iac)} desde ${fPer(hace.mes)})` : ""}.`);
      }
      const cap = mm.captaciones, i = cap.cortes.length - 1;
      const sum = (o) => Object.values(o).reduce((a, v) => a + v[i], 0);
      const depME = sum(cap.me), depTot = depME + sum(cap.mn);
      const cartME = seg.total.saldo_me, cartTot = seg.total.saldo;
      items.push(`El <b>${fRatio(cartME / cartTot)}</b> del crédito está en dólares, contra <b>${fRatio(depME / depTot)}</b> de los depósitos. El crédito en dólares supera a los depósitos en dólares por ${fQ(cartME - depME * 1000)}.`);
    }
    const p = E.periodo, pb = E.base.bancos.map((b) => ({ b, i: ind(b.id, p) })).filter((x) => x.i);
    if (pb.length) {
      const orden = [...pb].sort((a, b) => b.i.activo - a.i.activo);
      const top3 = d3.sum(orden.slice(0, 3), (x) => x.i.participacion);
      const hhi = d3.sum(pb, (x) => (x.i.participacion * 100) ** 2);
      items.push(`En ${fPerCorto(p)} los tres bancos más grandes (${orden.slice(0, 3).map((x) => x.b.corto).join(", ")}) concentran <b>${fRatio(top3)}</b> del activo; el índice Herfindahl-Hirschman es <b>${F[0].format(hhi)}</b>.`);
      const perdida = pb.filter((x) => ok(x.i.ganancia) && x.i.ganancia < 0).map((x) => x.b.corto);
      const negativo = pb.filter((x) => ok(x.i.margen_bruto) && x.i.margen_bruto <= 0).map((x) => x.b.corto);
      if (perdida.length || negativo.length) {
        let t = `En ${fPerCorto(p)}`;
        if (perdida.length) t += ` ${perdida.length === 1 ? "un banco cerró" : `<b>${perdida.length}</b> bancos cerraron`} con pérdida (${perdida.join(", ")})`;
        if (negativo.length) t += `${perdida.length ? " y" : ""} ${negativo.length === 1 ? "uno tuvo" : `<b>${negativo.length}</b> tuvieron`} margen operacional negativo (${negativo.join(", ")})`;
        items.push(t + ".");
      }
    }
    $("#hallazgos").innerHTML = items.map((t, i) => `<li data-n="${i + 1}"><span>${t}</span></li>`).join("");
  }

  function renderCredito() {
    const mm = ultimoMensual();
    if (!mm) return;
    const act = mm.cartera_actividad.actividades;
    const subConsumo = act.filter((a) => ["CONSUMOS PERSONALES", "TARJETAS DE CRÉDITO", "VEHÍCULOS"].includes(a.actividad.toUpperCase()));
    const filas = act.filter((a) => !subConsumo.includes(a)).map((a) => {
      const consumo = a.actividad.toUpperCase().startsWith("CONSUMO, VEH");
      const label = consumo ? "Consumo, vehículos y tarjetas" : a.actividad.replace(/ 1\/$/, "").replace(/;.*$/, "").replace(/, gas, vapor y aire acondicionado/, ", gas y vapor").replace(/, ganadería, silvicultura y pesca/, ", ganadería y pesca");
      return {
        label, v: a.participacion, texto: `${fPct(a.participacion)} · ${fQ(a.saldo)}`,
        sub: consumo ? subConsumo.map((s) => `${s.actividad.charAt(0) + s.actividad.slice(1).toLowerCase()} ${fPct(s.participacion)}`).join(" · ") : "",
        otras: /^Otras/.test(label),
      };
    }).sort((a, b) => (a.otras - b.otras) || b.v - a.v);
    barras($("#g-actividad"), filas);
    registrarTabla("card-actividad", { cols: ["Actividad", "Participación", "Saldo"], filas: filas.map((f) => [f.label, fPct(f.v), f.texto.split(" · ")[1]]) });

    const seg = mm.cartera_segmento.segmentos;
    const cMN = css("--s1"), cME = css("--s2");
    const filasSeg = SEGMENTOS.map(([k, n]) => {
      const s = seg[k];
      return { label: n, v: s.saldo, texto: `${fQ(s.saldo)} · ${fPct(s.participacion)}`,
        sub: `Quetzales ${fRatio(s.saldo_mn / s.saldo)} · dólares ${fRatio(s.saldo_me / s.saldo)} · ${F[0].format(s.cantidad)} créditos`,
        partes: [{ v: s.saldo_mn, color: cMN }, { v: s.saldo_me, color: cME }] };
    }).sort((a, b) => b.v - a.v);
    barras($("#g-segmento"), filasSeg, { leyenda: [{ label: "Moneda nacional", color: cMN }, { label: "Moneda extranjera", color: cME }] });
    registrarTabla("card-segmento", {
      cols: ["Segmento", "Moneda nacional", "Moneda extranjera", "Total", "Participación", "Créditos"],
      filas: SEGMENTOS.map(([k, n]) => [n, fQ(seg[k].saldo_mn), fQ(seg[k].saldo_me), fQ(seg[k].saldo), fPct(seg[k].participacion), F[0].format(seg[k].cantidad)]),
    });

    const mora = mm.mora_segmento, cortes = mora.cortes;
    const maxMora = d3.max(SEGMENTOS.flatMap(([k]) => [...(mora.mn[k] || []), ...(mora.me[k] || [])]));
    const cont = $("#g-mora");
    cont.innerHTML = `<div style="grid-column:1/-1">${leyenda([{ label: "Moneda nacional", color: cMN }, { label: "Moneda extranjera", color: cME }])}</div>` +
      SEGMENTOS.map(([k, n]) => `<div class="multiple"><h4>${n}</h4><div class="mg" id="mora-${k}"></div></div>`).join("");
    const filasMora = [];
    for (const [k, n] of SEGMENTOS) {
      lineas($(`#mora-${k}`), {
        compacto: true, ejeY: true, alto: 104, fmt: (v) => fPct(v), fmtEje: (v) => F[0].format(v) + "%", dominioY: [0, Math.ceil(maxMora + 0.5)],
        series: [
          { id: "mn", label: "Moneda nacional", color: cMN, datos: cortes.map((p, i) => ({ p, v: mora.mn[k]?.[i] })) },
          { id: "me", label: "Moneda extranjera", color: cME, datos: cortes.map((p, i) => ({ p, v: mora.me[k]?.[i] })) },
        ],
      });
      filasMora.push([`${n} (MN)`, ...cortes.map((_, i) => fPct(mora.mn[k]?.[i]))], [`${n} (ME)`, ...cortes.map((_, i) => fPct(mora.me[k]?.[i]))]);
    }
    registrarTabla("card-mora", { cols: ["Segmento", ...cortes.map(fPer)], filas: filasMora });

    const tasas = mm.tasas;
    const d = lineas($("#g-tasas"), {
      alto: 230, fmt: (v) => fPct(v), desdeCero: true,
      series: SEGMENTOS.map(([k, n], i) => ({ id: k, label: n, color: css(SERIE[i]), datos: tasas.cortes.map((p, j) => ({ p, v: tasas.activa_segmento.mn[k]?.[j] })) })),
      marcas: tasas.cortes.some((c) => c < "2025-01") && tasas.cortes.some((c) => c > "2025-01") ? [{ p: "2025-01", label: "cambio de método" }] : [],
      titulo: "Tasa activa por segmento",
    });
    registrarTabla("card-tasas", d);
    $("#aviso-tasas").textContent = "La caída de la tasa de consumo en 2025 es metodológica: desde enero de 2025 la SIB deja fuera las líneas de tarjeta de crédito (Ley de Tarjetas de Crédito). No significa que el crédito al consumo se abaratara en esa magnitud.";
  }

  function renderDepositos() {
    const mm = ultimoMensual();
    if (!mm) return;
    const cap = mm.captaciones;
    const tipos = [["monetarios", "Monetarios"], ["ahorro", "Ahorro"], ["plazo", "A plazo"], ["otras", "Otras"]];
    const series = tipos.map(([k, n], i) => ({ id: k, label: n, color: css(SERIE[i]), valores: cap.cortes.map((_, j) => cap.mn[k][j] + cap.me[k][j]) }));
    // la tabla del boletín viene en millones; se muestra en millardos
    const d = columnas($("#g-captaciones"), cap.cortes, series, { alto: 250, fmt: (v) => F[1].format(v / 1000), fmtEje: (v) => F[0].format(v / 1000), titulo: "Captaciones por tipo" });
    registrarTabla("card-captaciones", d);

    const t = mm.tasas;
    const tiposP = [["monetarios", "Monetarios"], ["ahorro", "Ahorro"], ["plazo", "A plazo"]];
    const d2 = lineas($("#g-pasivas"), {
      alto: 200, fmt: (v) => fPct(v), desdeCero: true,
      series: tiposP.map(([k, n], i) => ({ id: k, label: n, color: css(SERIE[i]), datos: t.cortes.map((p, j) => ({ p, v: t.pasiva.mn[k]?.[j] })) })),
    });
    registrarTabla("card-pasivas", d2);

    const i = cap.cortes.length - 1;
    const sum = (o) => Object.values(o).reduce((a, v) => a + v[i], 0);
    const me = sum(cap.me), tot = me + sum(cap.mn);
    const seg = mm.cartera_segmento.segmentos.total;
    $("#dolarizacion").innerHTML = `
      <div class="mini-kpi"><b>${fRatio(me / tot)}</b><span>de los depósitos está en dólares</span></div>
      <div class="mini-kpi"><b>${fRatio(seg.saldo_me / seg.saldo)}</b><span>del crédito está en dólares</span></div>
      <div class="mini-kpi"><b>${fPct(t.pasiva.mn.plazo.at(-1))} / ${fPct(t.pasiva.me.plazo.at(-1))}</b><span>tasa a plazo en quetzales / en dólares</span></div>`;
  }

  // ------------------------------------------------------------------ bancos
  const COLS = [
    { k: "banco", t: "Banco" },
    { k: "activo", t: "Activo Q mill.", f: (i) => fMillones(i.activo) },
    { k: "participacion", t: "Particip.", f: (i) => `<span class="part"><em style="width:${Math.max(2, i.participacion * 120)}px"></em>${fRatio(i.participacion)}</span>` },
    { k: "crec_cartera", t: "Crec. cartera", f: (i) => fVar(i.crec_cartera) },
    { k: "solvencia", t: "Solvencia", f: (i) => fRatio(i.solvencia) },
    { k: "liquidez", t: "Liquidez", f: (i) => fRatio(i.liquidez) },
    { k: "roe", t: "ROE", f: (i) => `<span class="${i.roe < 0 ? "peor" : ""}">${fRatio(i.roe)}</span>` },
    { k: "roa", t: "ROA", f: (i) => fRatio(i.roa, 2) },
    { k: "eficiencia", t: "Eficiencia", f: (i) => `<span class="${i.eficiencia > 1 ? "peor" : ""}">${i.eficiencia == null && ok(i.margen_bruto) ? "n. a." : fRatio(i.eficiencia)}</span>` },
    { k: "intermediacion", t: "Cartera / dep.", f: (i) => fRatio(i.intermediacion) },
    { k: "spark", t: "ROE, 5 años" },
  ];

  function renderSelectorPeriodo() {
    const cont = $("#sel-periodo");
    const pers = E.m.perBancos;
    cont.innerHTML = `<span class="indicador" aria-hidden="true"></span>` + pers.map((p) =>
      `<button type="button" role="radio" aria-checked="${p === E.periodo}" data-p="${p}">${fPerCorto(p)}</button>`).join("");
    moverIndicador();
    $$("button", cont).forEach((b) => b.addEventListener("click", () => { E.periodo = b.dataset.p; renderBancos(); renderHallazgos(); }));
    cont.addEventListener("keydown", (ev) => {
      if (!["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      const i = pers.indexOf(E.periodo) + (ev.key === "ArrowRight" ? 1 : -1);
      if (pers[i]) { E.periodo = pers[i]; renderBancos(); renderHallazgos(); $(`button[data-p="${pers[i]}"]`, cont)?.focus(); }
    });
  }
  function moverIndicador() {
    const cont = $("#sel-periodo"), activo = $(`button[aria-checked="true"]`, cont), ind_ = $(".indicador", cont);
    if (!activo || !ind_) return;
    ind_.style.left = activo.offsetLeft + "px";
    ind_.style.width = activo.offsetWidth + "px";
  }

  function renderBancos() {
    const p = E.periodo;
    $$("#sel-periodo button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.p === p)));
    moverIndicador();
    const filas = E.base.bancos.map((b) => ({ b, i: ind(b.id, p) })).filter((x) => x.i);
    const { col, dir } = E.orden;
    const val = (x) => (col === "banco" ? x.b.corto : x.i[col]);
    filas.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (col === "banco") return dir * va.localeCompare(vb);
      return (ok(va) ? 0 : 1) - (ok(vb) ? 0 : 1) || dir * ((va ?? 0) - (vb ?? 0));
    });
    const thead = $("#tabla-bancos thead"), tbody = $("#tabla-bancos tbody");
    thead.innerHTML = `<tr>${COLS.map((c) => c.k === "spark" ? `<th>${c.t}</th>` :
      `<th ${c.k === col ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-k="${c.k}">${c.t}</button></th>`).join("")}</tr>`;
    const sis = ind("sistema", p);
    const perAnuales = E.m.perBancos.filter((x) => x.endsWith("-12"));
    const filaHtml = (x, esSistema) => {
      const i = x.i, id = esSistema ? "sistema" : x.b.id;
      const ban = esSistema ? [] : banderas(id, p);
      return `<tr class="${esSistema ? "sistema" : ""}" ${esSistema ? "" : `tabindex="0" data-id="${id}"`}>
        ${COLS.map((c) => {
          if (c.k === "banco") return `<td class="banco"><b>${esc(esSistema ? "Sistema bancario" : x.b.corto)}</b><span>${esSistema ? "Total de las entidades" : esc(x.b.nombre)}</span></td>`;
          if (c.k === "spark") return `<td>${sparkline(perAnuales.map((q) => ({ v: ind(id, q)?.roe })), 76, 22, esSistema ? css("--sistema") : css("--acento"))}${ban.length ? `<span class="marca-celda" title="${esc(ban.map((b) => b[1]).join(" · "))}">${ban.map((b) => `<i style="background:var(--${{ critico: "critico", serio: "serio", atencion: "atencion", info: "sistema" }[b[0]]})"></i>`).join("")}</span>` : ""}</td>`;
          return `<td>${c.f(i)}</td>`;
        }).join("")}
      </tr>`;
    };
    tbody.innerHTML = (sis ? filaHtml({ i: sis }, true) : "") + filas.map((x) => filaHtml(x, false)).join("");
    $$("button[data-k]", thead).forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k;
      E.orden = { col: k, dir: E.orden.col === k ? -E.orden.dir : (k === "banco" ? 1 : -1) };
      renderBancos();
    }));
    $$("tr[data-id]", tbody).forEach((tr) => {
      tr.addEventListener("click", () => abrirBanco(tr.dataset.id));
      tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrirBanco(tr.dataset.id); } });
    });

    // dispersión
    const puntos = filas.filter((x) => ok(x.i.crec_cartera) && ok(x.i.roe)).map((x) => ({
      id: x.b.id, corto: x.b.corto, nombre: x.b.nombre, x: x.i.crec_cartera, y: x.i.roe, activo: x.i.activo,
    }));
    registrarTabla("card-dispersion", dispersion($("#g-dispersion"), puntos, { x: sis?.crec_cartera, y: sis?.roe }, { alto: 340 }));

    // concentración
    const anuales = E.m.perBancos.filter((q) => q.endsWith("-12") || q === p);
    const ultimo = anuales.at(-1);
    const top5 = E.base.bancos.slice(0, 5);
    const dc = lineas($("#g-concentracion"), {
      alto: 250, fmt: (v) => fRatio(v), fmtEje: (v) => F[0].format(v * 100) + "%", margenDer: 52,
      series: top5.map((b, i) => ({ id: b.id, label: b.corto, color: css(SERIE[i]), datos: anuales.map((q) => ({ p: q, v: ind(b.id, q)?.participacion })) })),
    });
    registrarTabla("card-concentracion", dc);
    const hhi = (q) => d3.sum(E.base.bancos, (b) => ((ind(b.id, q)?.participacion || 0) * 100) ** 2);
    const top3 = (q) => d3.sum(E.base.bancos.map((b) => ind(b.id, q)?.participacion || 0).sort(d3.descending).slice(0, 3));
    $("#hhi").innerHTML = `
      <div class="mini-kpi"><b>${F[0].format(hhi(p))}</b><span>índice Herfindahl-Hirschman, ${fPerCorto(p)} (${anuales[0] !== p ? `${F[0].format(hhi(anuales[0]))} en ${fPerCorto(anuales[0])}` : "—"})</span></div>
      <div class="mini-kpi"><b>${fRatio(top3(p))}</b><span>del activo en los 3 bancos más grandes</span></div>
      <div class="mini-kpi"><b>${E.base.bancos.filter((b) => ind(b.id, ultimo)).length}</b><span>bancos con datos en ${fPerCorto(ultimo)}</span></div>`;
  }

  // ------------------------------------------------------------------ detalle del banco
  let focoAntes = null;
  function abrirBanco(id) {
    const b = E.base.bancos.find((x) => x.id === id);
    if (!b) return;
    E.banco = id;
    focoAntes = document.activeElement;
    $("#velo").hidden = false;
    $("#hoja").hidden = false;
    renderHoja();
    $("#hoja-cerrar").focus();
    renderBancosPuntos();
  }
  function cerrarBanco() {
    E.banco = null;
    $("#velo").hidden = true;
    $("#hoja").hidden = true;
    ocultarTip();
    renderBancosPuntos();
    focoAntes?.focus?.();
  }
  function renderBancosPuntos() {
    const sis = ind("sistema", E.periodo);
    const filas = E.base.bancos.map((b) => ({ b, i: ind(b.id, E.periodo) })).filter((x) => x.i && ok(x.i.crec_cartera) && ok(x.i.roe));
    dispersion($("#g-dispersion"), filas.map((x) => ({ id: x.b.id, corto: x.b.corto, nombre: x.b.nombre, x: x.i.crec_cartera, y: x.i.roe, activo: x.i.activo })), { x: sis?.crec_cartera, y: sis?.roe }, { alto: 340 });
  }

  function renderHoja() {
    const id = E.banco;
    if (!id) return;
    const b = E.base.bancos.find((x) => x.id === id);
    const p = E.m.S[id]?.[E.periodo] ? E.periodo : Object.keys(E.m.S[id]).sort().at(-1);
    const i = ind(id, p), s = ind("sistema", p);
    $("#hoja-titulo").textContent = b.nombre;
    $("#hoja-ceja").textContent = `${b.corto} · ${fPer(p)}`;
    const pers = Object.keys(E.m.S[id]).filter((q) => ok(E.m.S[id][q].total_de_activo)).sort();
    const comp = (v, sv, f) => (ok(v) && ok(sv) ? `sistema ${f(sv)}` : "");
    const cuerpo = $("#hoja-cuerpo");
    const ban = banderas(id, p);
    cuerpo.innerHTML = `
      <div class="hoja-kpis">
        <div><b>${fQ(i.activo).replace(" millardos", "")}</b><span>${fQ(i.activo).includes("millardos") ? "millardos de activo" : "de activo"}</span></div>
        <div><b>${fRatio(i.participacion)}</b><span>del activo del sistema</span></div>
        <div><b>${fRatio(i.roe)}</b><span>ROE · ${comp(i.roe, s?.roe, fRatio)}</span></div>
        <div><b>${fRatio(i.solvencia)}</b><span>solvencia · ${comp(i.solvencia, s?.solvencia, fRatio)}</span></div>
      </div>
      ${ban.length ? `<div class="banderas">${ban.map(([e, t]) => `<span class="chip" data-estado="${e}"><i></i>${esc(t)}</span>`).join("")}</div>` : ""}
      <article class="tarjeta" id="hoja-ind"><header class="tarjeta-cab"><div><h3>Indicadores frente al sistema</h3><p class="nota-chica">Misma fórmula para el banco y para el total del sistema.</p></div><button class="btn-tabla" type="button" data-tabla="hoja-ind">Tabla</button></header>
        <div class="multiples" id="hoja-mult"></div></article>
      <article class="tarjeta"><header class="tarjeta-cab"><div><h3>Composición del balance, ${fPer(p)}</h3></div></header><div id="hoja-comp"></div></article>
      <article class="tarjeta"><header class="tarjeta-cab"><div><h3>De los ingresos a la ganancia, ${fPer(p)}</h3><p class="nota-chica">Estado de resultados del periodo.</p></div></header><div class="grafica" id="hoja-cascada"></div></article>
      <article class="tarjeta"><header class="tarjeta-cab"><div><h3>Cuentas</h3><p class="nota-chica">Miles de quetzales, tal como las publica la SIB. ${editando() ? "Edita una celda para corregir un valor; queda registrado en Fuentes." : ""}</p></div></header>
        <div class="tabla-datos-env" id="hoja-datos"></div></article>
      <div class="nota" data-nota-banco="${id}"></div>`;

    const KS = [["roe", "ROE", (v) => fRatio(v)], ["roa", "ROA", (v) => fRatio(v, 2)], ["solvencia", "Solvencia", (v) => fRatio(v)],
      ["liquidez", "Liquidez", (v) => fRatio(v)], ["eficiencia", "Eficiencia", (v) => fRatio(v)], ["intermediacion", "Cartera / depósitos", (v) => fRatio(v)]];
    const mult = $("#hoja-mult");
    mult.innerHTML = `<div style="grid-column:1/-1">${leyenda([{ label: b.corto, color: css("--acento") }, { label: "Sistema", color: css("--sistema") }])}</div>` +
      KS.map(([k, n]) => `<div class="multiple"><h4>${n}</h4><div id="hm-${k}"></div></div>`).join("");
    const filasT = [];
    for (const [k, n, f] of KS) {
      const datosB = pers.map((q) => ({ p: q, v: ind(id, q)?.[k] })), datosS = pers.map((q) => ({ p: q, v: ind("sistema", q)?.[k] }));
      lineas($(`#hm-${k}`), {
        compacto: true, ejeY: true, alto: 104, fmt: f, fmtEje: (v) => F[0].format(v * 100) + "%", sinArea: true,
        series: [{ id: "s", label: "Sistema", color: css("--sistema"), datos: datosS, ancho: 1.5 }, { id: "b", label: b.corto, color: css("--acento"), datos: datosB }],
      });
      filasT.push([n, ...pers.map((q) => f(ind(id, q)?.[k]))], [`${n} (sistema)`, ...pers.map((q) => f(ind("sistema", q)?.[k]))]);
    }
    E.tablas["hoja-ind"] = { cols: ["Indicador", ...pers.map(fPer)], filas: filasT };
    registrarTabla("hoja-ind", E.tablas["hoja-ind"]);

    const c = E.m.S[id][p];
    const partesA = [["disponibilidades", "Disponibilidades"], ["inversiones", "Inversiones"], ["cartera_de_creditos", "Cartera"], ["otros", "Otros"]];
    const otrosPas = (c.otros_pasivos || 0) + (c.otras_cuentas_acreedoras || 0);
    const partesP = [["obligaciones_depositarias", "Depósitos", c.obligaciones_depositarias], ["fondeo", "Créditos y oblig. financieras", (c.creditos_obtenidos || 0) + (c.obligaciones_financieras || 0)], ["otros", "Otros pasivos", otrosPas], ["capital_contable", "Capital", c.capital_contable]];
    const barraComp = (titulo, partes, total) => `
      <div class="barras" style="margin-bottom:12px"><div class="barra-fila"><div class="barra-etq"><span>${titulo}</span><span class="num">${fQ(total)}</span></div>
      <div class="barra-pista" style="width:100%;height:14px;background:transparent">${partes.map((x, j) => `<span style="width:${Math.max(0, (x[2] / total) * 100)}%;background:${css(SERIE[j])}"></span>`).join("")}</div>
      <div class="leyenda" style="margin-top:6px">${partes.map((x, j) => `<span><i class="bloque-l" style="background:${css(SERIE[j])}"></i>${x[1]} ${fRatio(x[2] / total)}</span>`).join("")}</div></div></div>`;
    $("#hoja-comp").innerHTML =
      barraComp("Activo", partesA.map(([k, n]) => [k, n, c[k] || 0]), c.total_de_activo) +
      barraComp("Pasivo y capital", partesP, c.total_pasivo_y_capital || c.total_de_activo);

    const g = (k) => c[k] || 0;
    if (ok(c.margen_por_inversion) && ok(c.ganancia_neta)) {
      cascada($("#hoja-cascada"), [
        { label: "Margen por inversión", v: g("margen_por_inversion") },
        { label: "Margen por servicios", v: g("margen_por_servicios") },
        { label: "Otros productos y gastos", v: g("margen_de_otros_productos_y_gastos_de_operacion") },
        { label: "Margen operacional bruto", v: g("margen_operacional_bruto"), tipo: "total" },
        { label: "Gastos de administración", v: -g("gastos_de_administracion") },
        { label: "Margen operacional neto", v: g("margen_operacional_neto"), tipo: "total" },
        { label: "Extraordinarios y ej. anteriores", v: g("productos_y_gastos_extraordinarios") + g("productos_y_gastos_de_ejercicios_anteriores") },
        { label: "Impuesto sobre la renta", v: -g("impuesto_sobre_la_renta") },
        { label: "Ganancia neta", v: g("ganancia_neta"), tipo: "total" },
      ]);
    } else {
      $("#hoja-cascada").innerHTML = `<p class="nota-chica">Este periodo no trae el estado de resultados completo.</p>`;
    }
    renderTablaCuentas(id, pers);
    renderNotaBanco(id);
  }

  function renderTablaCuentas(id, pers) {
    const cont = $("#hoja-datos");
    const ed = editando();
    const editado = (q, k) => E.ed.ajustes.find((a) => a.entidad === id && a.periodo === q && a.campo === k);
    const fila = ([k, n]) => `<tr class="${TOTALES.has(k) ? "total" : ""}"><td>${n}</td>${pers.map((q) => {
      const v = E.m.S[id][q]?.[k], aj = editado(q, k);
      if (ed) return `<td class="${aj ? "editado" : ""}"><input id="c-${id}-${q}-${k}" data-p="${q}" data-k="${k}" inputmode="decimal" value="${ok(v) ? v : ""}" aria-label="${esc(n)} ${fPer(q)}"></td>`;
      return `<td class="${aj ? "editado" : ""}" ${aj ? `title="Corregido a mano. Valor de la SIB: ${fNum(aj.original, 0)}"` : ""}>${fNum(v, 0)}</td>`;
    }).join("")}</tr>`;
    cont.innerHTML = `<table class="tabla-datos"><thead><tr><th>Cuenta</th>${pers.map((q) => `<th>${fPer(q)}</th>`).join("")}</tr></thead>
      <tbody><tr><td colspan="${pers.length + 1}" style="font-family:var(--f-dato);font-size:11px;color:var(--tinta-3)">BALANCE GENERAL</td></tr>${CUENTAS_BAL.map(fila).join("")}
      <tr><td colspan="${pers.length + 1}" style="font-family:var(--f-dato);font-size:11px;color:var(--tinta-3)">ESTADO DE RESULTADOS</td></tr>${CUENTAS_RES.map(fila).join("")}</tbody></table>`;
    if (!ed) return;
    $$("input", cont).forEach((inp) => inp.addEventListener("change", () => {
      const q = inp.dataset.p, k = inp.dataset.k;
      const txt = inp.value.replace(/,/g, "").trim();
      const original = E.m.BASE[id]?.[q]?.[k] ?? (E.ed.periodos.find((x) => x.entidad === id && x.periodo === q)?.cuentas?.[k]);
      const i = E.ed.ajustes.findIndex((a) => a.entidad === id && a.periodo === q && a.campo === k);
      if (txt === "") { if (i >= 0) E.ed.ajustes.splice(i, 1); }
      else {
        const v = Number(txt);
        if (!Number.isFinite(v)) { toast("Escribe un número (miles de quetzales, sin símbolos)."); return; }
        if (ok(original) && v === original) { if (i >= 0) E.ed.ajustes.splice(i, 1); }
        else {
          const reg = { entidad: id, periodo: q, campo: k, valor: v, original: original ?? null, fecha: hoyISO() };
          if (i >= 0) E.ed.ajustes[i] = reg; else E.ed.ajustes.push(reg);
        }
      }
      marcarCambio(true);
    }));
  }

  function renderNotaBanco(id) {
    const el = $(`[data-nota-banco="${id}"]`);
    if (!el) return;
    const txt = E.ed.notas_banco[id] || "";
    if (editando()) {
      el.innerHTML = `<div class="nota-cab"><h3>Lectura del analista sobre este banco</h3></div><textarea id="nota-banco-${id}" rows="4" placeholder="Qué explica sus números y cómo se compara con sus pares."></textarea>`;
      const ta = $("textarea", el);
      ta.value = txt;
      ta.addEventListener("input", () => { E.ed.notas_banco[id] = ta.value; marcarCambio(); });
    } else if (txt.trim()) {
      el.innerHTML = `<div class="nota-cab"><h3>Lectura del analista</h3></div><div class="nota-texto">${parrafos(txt)}</div>`;
    } else el.innerHTML = "";
  }

  // ------------------------------------------------------------------ notas y conclusiones
  function renderNotas() {
    $$(".nota[data-nota]").forEach((el) => {
      const k = el.dataset.nota, txt = E.ed.notas[k] || "";
      if (editando()) {
        el.innerHTML = `<div class="nota-cab"><h3>Lectura del analista</h3><span class="nota-chica">Visible para todos cuando guardes</span></div><textarea id="nota-${k}" rows="4"></textarea>`;
        const ta = $("textarea", el);
        ta.placeholder = PISTAS[k] || "";
        ta.value = txt;
        ta.addEventListener("input", () => { E.ed.notas[k] = ta.value; marcarCambio(); });
      } else if (txt.trim()) {
        el.innerHTML = `<div class="nota-cab"><h3>Lectura del analista</h3></div><div class="nota-texto">${parrafos(txt)}</div>`;
      } else el.innerHTML = "";
    });
  }

  const TEMAS = { salud: "Salud del sistema", credito: "Crédito", depositos: "Depósitos", bancos: "Bancos", general: "General" };
  function renderConclusiones() {
    const ed = editando();
    $("#form-conclusion").hidden = !ed;
    const lista = [...E.ed.conclusiones].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const ol = $("#lista-conclusiones");
    if (!lista.length) {
      ol.innerHTML = `<li class="vacio">${ed ? "Todavía no hay conclusiones. Escribe la primera con el formulario: un título que se pueda leer solo y un desarrollo con las cifras que lo respaldan." : "Aún no hay conclusiones publicadas."}</li>`;
      return;
    }
    ol.innerHTML = lista.map((c) => `
      <li class="conclusion" data-id="${esc(c.id)}">
        <div class="conclusion-meta"><span>${esc(c.fecha || "")}</span><span class="chip" data-estado="info"><i></i>${esc(TEMAS[c.seccion] || "General")}</span></div>
        <h3>${esc(c.titulo)}</h3>
        <div class="nota-texto" style="border:0;padding:0">${parrafos(c.texto)}</div>
        ${ed ? `<button class="btn btn-ghost btn-borrar" type="button" data-borrar="${esc(c.id)}">Eliminar</button>` : ""}
      </li>`).join("");
    $$("[data-borrar]", ol).forEach((btn) => btn.addEventListener("click", () => {
      if (btn.dataset.confirmar !== "1") {
        btn.dataset.confirmar = "1";
        btn.textContent = "Confirmar eliminación";
        setTimeout(() => { if (btn.isConnected) { btn.dataset.confirmar = ""; btn.textContent = "Eliminar"; } }, 4000);
        return;
      }
      E.ed.conclusiones = E.ed.conclusiones.filter((c) => c.id !== btn.dataset.borrar);
      marcarCambio();
      renderConclusiones();
    }));
  }

  // ------------------------------------------------------------------ fuentes, método, datos agregados
  function renderFuentes() {
    const todas = [...E.base.fuentes, ...E.ed.fuentes.map((f) => ({ ...f, agregada: true }))];
    $("#lista-fuentes").innerHTML = todas.map((f) => `
      <li><b>${esc(f.titulo)}</b><span>${esc(f.emisor || "Agregada a mano")} · ${esc(f.cobertura || "")}${f.archivo ? ` · <span class="mono">${esc(f.archivo)}</span>` : ""}</span>
      ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url.replace(/^https?:\/\//, ""))}</a>` : ""}</li>`).join("");
    const met = [
      ["Solvencia", "<code>capital contable / activo</code>"],
      ["Liquidez", "<code>disponibilidades / obligaciones depositarias</code>"],
      ["ROE · ROA", "<code>ganancia neta / capital</code> y <code>/ activo</code>, con saldos de cierre. En cortes que no son diciembre, la ganancia acumulada se anualiza (× 12 / meses)."],
      ["Eficiencia", "<code>gastos de administración / margen operacional bruto</code>. Si el margen es cero o negativo, no aplica."],
      ["Cartera / depósitos", "<code>cartera de créditos / obligaciones depositarias</code>. Por debajo de 20% el banco presta poco de lo que capta."],
      ["Crecimiento", "Variación contra el mismo mes del año anterior."],
      ["Concentración", "Índice Herfindahl-Hirschman: suma de los cuadrados de las participaciones en el activo (0 a 10,000)."],
      ["Indicadores oficiales", "La sección Salud usa los indicadores que publica la SIB. Pueden diferir de los calculados aquí porque la SIB usa saldos promedio y patrimonio sin la utilidad del año."],
      ["Etiquetas de salud", Object.values(UMBRALES).map((u) => `${u.nombre}: ${u.cortes.filter((c) => Number.isFinite(c[0])).map((c) => `${u.mayorMejor ? "≥" : "≤"} ${c[0]} ${c[2].toLowerCase()}`).join(", ")}`).join("; ") + ". Son criterios del tablero, no normas."],
    ];
    $("#metodo").innerHTML = met.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("");
    renderCambios();
    renderDescargas();
  }

  function renderCambios() {
    const ed = editando();
    const items = [
      ...E.ed.ajustes.map((a, i) => ({ html: `<span><b>${esc(nombreEntidad(a.entidad))}</b> · ${fPer(a.periodo)} · ${esc(ETIQUETA[a.campo] || a.campo)}: <span class="num">${fNum(a.original, 0)} → ${fNum(a.valor, 0)}</span></span>`, accion: ed ? `<button class="btn btn-ghost" type="button" data-revertir="${i}">Revertir</button>` : `<span class="nota-chica">${esc(a.fecha || "")}</span>` })),
      ...E.ed.periodos.map((p, i) => ({ html: `<span><b>${esc(nombreEntidad(p.entidad))}</b> · ${fPer(p.periodo)} · ${Object.keys(p.cuentas || {}).length + Object.keys(p.oficiales || {}).length} valores agregados${p.fuente ? ` · ${esc(p.fuente)}` : ""}</span>`, accion: ed ? `<button class="btn btn-ghost" type="button" data-quitar="${i}">Quitar</button>` : `<span class="nota-chica">${esc(p.fecha || "")}</span>` })),
    ];
    $("#card-cambios").hidden = !items.length;
    $("#lista-cambios").innerHTML = items.map((x) => `<li>${x.html}${x.accion}</li>`).join("");
    $$("[data-revertir]").forEach((b) => b.addEventListener("click", () => { E.ed.ajustes.splice(+b.dataset.revertir, 1); marcarCambio(true); }));
    $$("[data-quitar]").forEach((b) => b.addEventListener("click", () => { E.ed.periodos.splice(+b.dataset.quitar, 1); marcarCambio(true); }));
  }
  const nombreEntidad = (id) => (id === "sistema" ? "Sistema bancario" : E.base.bancos.find((b) => b.id === id)?.corto || id);

  function renderEditorDatos() {
    $("#editor-datos").hidden = !editando();
    if (!editando()) return;
    const sel = $("#per-entidad");
    if (!sel.options.length) {
      sel.innerHTML = `<option value="sistema">Sistema bancario</option>` + E.base.bancos.map((b) => `<option value="${b.id}">${esc(b.corto)}</option>`).join("");
      sel.addEventListener("change", camposPeriodo);
      $("#per-mes").addEventListener("change", camposPeriodo);
    }
    camposPeriodo();
  }
  function camposPeriodo() {
    const ent = $("#per-entidad").value, per = $("#per-mes").value;
    const previo = E.ed.periodos.find((p) => p.entidad === ent && p.periodo === per);
    const campo = (k, n, val) => `<div class="campo"><label for="pc-${k}">${n}</label><input id="pc-${k}" data-campo="${k}" inputmode="decimal" value="${ok(val) ? val : ""}"></div>`;
    let html = `<h4>Balance (miles de Q)</h4>` + CUENTAS_BAL.map(([k, n]) => campo(k, n, previo?.cuentas?.[k])).join("") +
      `<h4>Resultados acumulados del año (miles de Q)</h4>` + CUENTAS_RES.map(([k, n]) => campo(k, n, previo?.cuentas?.[k])).join("");
    if (ent === "sistema") html += `<h4>Indicadores oficiales SIB (%)</h4>` + OFICIALES.map(([k, n]) => campo("of-" + k, n, previo?.oficiales?.[k])).join("");
    $("#per-campos").innerHTML = html;
  }

  function agregarPeriodo(ent, per, cuentas, oficiales, fuente) {
    let p = E.ed.periodos.find((x) => x.entidad === ent && x.periodo === per);
    if (!p) { p = { entidad: ent, periodo: per, cuentas: {}, oficiales: {}, fuente: "", fecha: hoyISO() }; E.ed.periodos.push(p); }
    Object.assign(p.cuentas, cuentas);
    Object.assign(p.oficiales, oficiales);
    if (fuente) {
      p.fuente = fuente;
      if (!E.ed.fuentes.some((f) => f.titulo === fuente)) E.ed.fuentes.push({ titulo: fuente, cobertura: `Agregada a mano · ${fPer(per)}`, fecha: hoyISO() });
    }
    p.fecha = hoyISO();
    return p;
  }

  function enviarPeriodo(ev) {
    ev.preventDefault();
    const estado = $("#per-estado");
    const csv = $("#per-csv").value.trim();
    let n = 0;
    const errores = [];
    const validos = new Set([...CUENTAS_BAL, ...CUENTAS_RES].map((c) => c[0]));
    const ofic = new Set(OFICIALES.map((c) => c[0]));
    const entidades = new Set(["sistema", ...E.base.bancos.map((b) => b.id)]);
    const fuente = $("#per-fuente").value.trim();
    if (csv) {
      csv.split(/\r?\n/).forEach((linea, i) => {
        if (!linea.trim()) return;
        const [ent, per, campo, valor] = linea.split(",").map((x) => x.trim());
        const v = Number(valor);
        if (!entidades.has(ent)) return errores.push(`fila ${i + 1}: entidad "${ent}" no existe`);
        if (!/^\d{4}-\d{2}$/.test(per || "")) return errores.push(`fila ${i + 1}: periodo debe ser AAAA-MM`);
        if (!Number.isFinite(v)) return errores.push(`fila ${i + 1}: valor no numérico`);
        if (validos.has(campo)) agregarPeriodo(ent, per, { [campo]: v }, {}, fuente);
        else if (ofic.has(campo) && ent === "sistema") agregarPeriodo(ent, per, {}, { [campo]: v }, fuente);
        else return errores.push(`fila ${i + 1}: campo "${campo}" no reconocido`);
        n++;
      });
      $("#per-csv-estado").textContent = errores.length ? `No se cargaron ${errores.length} filas: ${errores.slice(0, 3).join("; ")}` : "";
    }
    const ent = $("#per-entidad").value, per = $("#per-mes").value;
    if (per) {
      const cuentas = {}, oficiales = {};
      $$("#per-campos input").forEach((inp) => {
        const t = inp.value.replace(/,/g, "").trim();
        if (!t) return;
        const v = Number(t);
        if (!Number.isFinite(v)) { errores.push(`${inp.previousElementSibling.textContent}: no es un número`); return; }
        if (inp.dataset.campo.startsWith("of-")) oficiales[inp.dataset.campo.slice(3)] = v; else cuentas[inp.dataset.campo] = v;
      });
      const total = Object.keys(cuentas).length + Object.keys(oficiales).length;
      if (total) {
        const ya = E.m.S[ent]?.[per];
        if (ent !== "sistema" && !ok(cuentas.total_de_activo) && !ok(ya?.total_de_activo)) errores.push("Para que el banco aparezca en el periodo hace falta al menos el total de activo.");
        agregarPeriodo(ent, per, cuentas, oficiales, fuente);
        n += total;
      }
    }
    if (!n) { estado.textContent = errores[0] || "No hay valores que agregar."; return; }
    estado.textContent = `Se agregaron ${n} valores.${errores.length ? " " + errores[0] : ""} Recuerda guardar.`;
    $("#per-csv").value = "";
    marcarCambio(true);
  }

  function renderDescargas() {
    const cont = $("#descargas");
    const puede = E.dl || E.modo === "local" || !window.claude;
    if (!puede) { cont.innerHTML = ""; return; }
    cont.innerHTML = `
      <button class="btn" type="button" id="dl-csv">Descargar indicadores (CSV)</button>
      <button class="btn btn-ghost" type="button" id="dl-json">Descargar notas y correcciones (JSON)</button>`;
    $("#dl-csv").addEventListener("click", () => descargar("pulso-bancario-indicadores.csv", csvIndicadores()));
    $("#dl-json").addEventListener("click", () => descargar("editorial.json", JSON.stringify(E.ed, null, 1)));
  }
  function csvIndicadores() {
    const ks = ["activo", "participacion", "solvencia", "liquidez", "roe", "roa", "eficiencia", "intermediacion", "crec_cartera", "crec_depositos"];
    const filas = [["entidad", "periodo", ...ks].join(",")];
    for (const id of ["sistema", ...E.base.bancos.map((b) => b.id)]) {
      for (const p of Object.keys(E.m.S[id] || {}).sort()) {
        const i = ind(id, p);
        if (i) filas.push([id, p, ...ks.map((k) => (ok(i[k]) ? +i[k].toFixed(6) : ""))].join(","));
      }
    }
    return filas.join("\n");
  }
  async function descargar(nombre, contenido) {
    if (E.dl) {
      try { await E.dl.save({ filename: nombre, data: contenido }); toast("Archivo listo."); }
      catch (e) { if (e?.code !== "declined") toast("No se pudo descargar en esta vista."); }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([contenido], { type: "text/plain" }));
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ edición y guardado
  function marcarCambio(recalc = false) {
    E.pendientes++;
    actualizarGuardar();
    if (E.modo === "local") { try { localStorage.setItem("pbgt-editorial", JSON.stringify(E.ed)); } catch { /* sin almacenamiento */ } }
    if (recalc) { recalcular(); renderDatos(); }
  }
  function actualizarGuardar() {
    const btn = $("#btn-guardar");
    btn.hidden = !(E.modo === "artifact" && E.pendientes > 0);
    btn.textContent = `Guardar cambios (${E.pendientes})`;
  }
  function mostrarModo() {
    const chip = $("#modo"), btn = $("#btn-editar");
    const puede = E.modo === "artifact" || E.modo === "local";
    btn.hidden = !puede;
    chip.hidden = !puede;
    chip.textContent = E.modo === "local" ? "Copia local" : "Puedes editar";
    chip.classList.toggle("editando", editando());
    actualizarGuardar();
  }
  function alternarEdicion() {
    const on = !editando();
    document.body.classList.toggle("editando", on);
    $("#btn-editar").setAttribute("aria-pressed", String(on));
    $("#btn-editar").textContent = on ? "Terminar edición" : "Editar";
    mostrarModo();
    renderNotas(); renderConclusiones(); renderEditorDatos(); renderCambios();
    if (E.banco) renderHoja();
  }

  async function guardar() {
    if (E.modo !== "artifact" || !E.art) return;
    const btn = $("#btn-guardar");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    const contenido = JSON.stringify(E.ed, null, 1);
    try { sessionStorage.setItem("pbgt-borrador", contenido); } catch { /* sin almacenamiento */ }
    try {
      await E.art.publish({ "datos/editorial.json": { content: contenido, contentType: "application/json" } });
      E.pendientes = 0;
      try { sessionStorage.removeItem("pbgt-borrador"); } catch { /* sin almacenamiento */ }
      toast("Cambios guardados. Quien abra el tablero ya los ve.");
    } catch (e) {
      const c = e?.code;
      if (c === "conflict") toast("Se guardó otra versión antes que esta. La página se recargará y tus cambios se recuperan del borrador.", 6000);
      else if (c === "not_writer" || c === "not_granted" || c === "not_declared") { E.modo = "lectura"; document.body.classList.remove("editando"); mostrarModo(); toast("Esta vista es de solo lectura."); }
      else if (c === "capability_disabled" || c === "capability_removed") toast("Guardar no está disponible aquí. Tus cambios siguen en la página; descárgalos desde Fuentes.", 6000);
      else if (c === "rate_limited") toast("Demasiados guardados seguidos. Espera unos segundos.");
      else toast("No se pudo guardar: " + (e?.message || "error desconocido"), 6000);
    } finally {
      btn.disabled = false;
      actualizarGuardar();
    }
  }

  async function detectarCapacidades() {
    if (!window.claude?.use) {
      E.modo = "local";
      mostrarModo();
      renderDescargas();
      return;
    }
    const [art, user, dl] = await Promise.all([claude.use("artifact"), claude.use("user"), claude.use("downloads")]);
    E.art = art; E.dl = dl;
    let puede = false;
    if (art && user) { try { puede = await user.canEdit(); } catch { puede = false; } }
    E.modo = puede ? "artifact" : "lectura";
    if (puede) {
      let borrador = null;
      try { borrador = sessionStorage.getItem("pbgt-borrador"); } catch { /* sin almacenamiento */ }
      if (borrador && borrador !== JSON.stringify(E.ed, null, 1)) {
        try { E.ed = normalizar(JSON.parse(borrador)); E.pendientes = 1; recalcular(); renderTodo(); toast("Se recuperaron cambios que no se habían guardado."); } catch { /* borrador dañado */ }
      }
    }
    mostrarModo();
    renderDescargas();
  }

  // ------------------------------------------------------------------ armado general
  function renderDatos() {
    renderMeta(); renderKPIs(); renderSalud(); renderCredito(); renderDepositos();
    renderSelectorPeriodo(); renderBancos(); renderFuentes(); renderEditorDatos();
    if (E.banco) renderHoja();
  }
  function renderTodo() { renderDatos(); renderNotas(); renderConclusiones(); }

  function conectarUI() {
    $("#btn-editar").addEventListener("click", alternarEdicion);
    $("#btn-guardar").addEventListener("click", guardar);
    $("#hoja-cerrar").addEventListener("click", cerrarBanco);
    $("#velo").addEventListener("click", cerrarBanco);
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#hoja").hidden) cerrarBanco(); });
    document.addEventListener("click", (ev) => {
      const b = ev.target.closest(".btn-tabla");
      if (!b) return;
      const id = b.dataset.tabla;
      if (E.tablaVista.has(id)) E.tablaVista.delete(id); else E.tablaVista.add(id);
      if (E.tablas[id]) registrarTabla(id, E.tablas[id]);
    });
    $("#form-conclusion").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const titulo = $("#conc-titulo").value.trim(), texto = $("#conc-texto").value.trim();
      if (!titulo || !texto) return;
      E.ed.conclusiones.push({ id: "c" + Date.now().toString(36), titulo, texto, seccion: $("#conc-seccion").value, fecha: hoyISO() });
      $("#conc-titulo").value = ""; $("#conc-texto").value = "";
      marcarCambio();
      renderConclusiones();
    });
    $("#form-periodo").addEventListener("submit", enviarPeriodo);
    window.addEventListener("beforeunload", (ev) => { if (E.modo === "artifact" && E.pendientes > 0) { ev.preventDefault(); ev.returnValue = ""; } });
    let t;
    let ancho = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - ancho) < 8) return;
      ancho = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(renderDatos, 180);
    });
    // resalta la sección visible en la barra
    const enlaces = $$(".nav a");
    const obs = new IntersectionObserver((entradas) => {
      for (const en of entradas) if (en.isIntersecting) enlaces.forEach((a) => a.classList.toggle("activo", a.getAttribute("href") === "#" + en.target.id));
    }, { rootMargin: "-45% 0px -50% 0px" });
    $$("main > section[id]").forEach((s) => obs.observe(s));
    // un cambio de tema del visor repinta las gráficas con sus colores
    new MutationObserver(() => renderDatos()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => renderDatos());
  }

  function abrirDesdeHash() {
    const h = location.hash.slice(1);
    if (h.startsWith("banco-")) abrirBanco(h.slice(6));
  }

  async function iniciar() {
    try {
      const [b, e] = await Promise.all([json("datos/base.json"), json("datos/editorial.json").catch(() => EDITORIAL_VACIO())]);
      E.base = b;
      E.ed = normalizar(e);
    } catch (err) {
      $("#kpis").innerHTML = `<p class="cargando">No se pudieron cargar los datos (${esc(err.message)}). Si abriste el archivo directo desde la carpeta, usa <code>python servir.py</code>.</p>`;
      return;
    }
    if (!window.claude?.use) {
      try { const local = localStorage.getItem("pbgt-editorial"); if (local) E.ed = normalizar(JSON.parse(local)); } catch { /* sin almacenamiento */ }
    }
    if (typeof d3 === "undefined") {
      $("#kpis").innerHTML = `<p class="cargando">No se pudo cargar la librería de gráficas (d3).</p>`;
      return;
    }
    recalcular();
    renderTodo();
    conectarUI();
    abrirDesdeHash();
    detectarCapacidades();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
