/* ============================================================
   Motor de análisis de datos genérico (sobre cualquier archivo)
   - detectarColumnas: infiere tipo de cada columna real
   - ejecutarAnalisis: agrupa/cuenta/promedia/suma/filtra sobre las filas
   ============================================================ */

const esFecha = (v) => {
  if (v == null || v === "") return false;
  if (v instanceof Date) return true;
  const s = String(v);
  if (/^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(s)) return true;       // 2026-01 / 2026/01/15
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(s)) return true;        // 15-01-2026
  const d = new Date(s);
  return !isNaN(d.getTime()) && s.length >= 6;
};
const esNumero = (v) => v !== null && v !== "" && !isNaN(parseFloat(String(v).replace(",", ".")));
const num = (v) => parseFloat(String(v ?? "").replace(",", "."));

/** Detecta el tipo de cada columna a partir de una muestra de filas. */
export function detectarColumnas(filas) {
  if (!filas.length) return [];
  const cols = Object.keys(filas[0]);
  return cols.map((nombre) => {
    const valores = filas.map((f) => f[nombre]).filter((v) => v != null && v !== "");
    const muestra = valores.slice(0, 200);
    let nNum = 0, nFecha = 0;
    for (const v of muestra) {
      if (esFecha(v)) nFecha++;
      else if (esNumero(v)) nNum++;
    }
    const total = muestra.length || 1;
    const distintos = new Set(muestra.map(String)).size;
    let tipo;
    if (nFecha / total > 0.6) tipo = "fecha";
    else if (nNum / total > 0.7) tipo = "numero";
    else if (distintos <= Math.max(20, total * 0.3)) tipo = "categoria"; // pocos valores únicos = categórica
    else tipo = "texto";
    return {
      nombre, tipo,
      distintos,
      ejemplos: [...new Set(muestra.map(String))].slice(0, 5),
      nulos: filas.length - valores.length,
    };
  });
}

/**
 * Ejecuta un análisis sobre las filas.
 * config: {
 *   operacion: "conteo"|"suma"|"promedio"|"minimo"|"maximo"|"conteo_distintos",
 *   agrupar_por: "<columna categórica o fecha>",
 *   columna_valor: "<columna numérica>" (no requerida para conteo),
 *   filtros: [{columna, operador:"="|"!="|">"|"<"|"contiene"|"entre", valor, valor2}],
 *   granularidad_fecha: "anio"|"mes"|"dia" (si agrupar_por es fecha),
 *   orden: "desc"|"asc", limite: N
 * }
 * Devuelve { etiquetas:[], valores:[], tabla:[{grupo, valor}], total }
 */
export function ejecutarAnalisis(filas, config) {
  const { operacion = "conteo", agrupar_por, columna_valor, filtros = [], granularidad_fecha = "anio", orden = "desc", limite = 50 } = config;

  // 1) Filtrar
  let datos = filas.filter((f) => filtros.every((flt) => cumpleFiltro(f, flt)));

  // 2) Clave de agrupación
  const claveDe = (f) => {
    if (!agrupar_por) return "Total";
    let v = f[agrupar_por];
    if (v == null || v === "") return "(sin dato)";
    if (granularidad_fecha && esFecha(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        if (granularidad_fecha === "anio") return String(d.getFullYear());
        if (granularidad_fecha === "mes") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return d.toISOString().slice(0, 10);
      }
    }
    return String(v);
  };

  // 3) Agrupar y agregar
  const grupos = {};
  for (const f of datos) {
    const k = claveDe(f);
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(f);
  }

  const tabla = Object.entries(grupos).map(([grupo, fs]) => {
    let valor;
    const nums = columna_valor ? fs.map((x) => num(x[columna_valor])).filter((n) => !isNaN(n)) : [];
    switch (operacion) {
      case "suma": valor = nums.reduce((a, b) => a + b, 0); break;
      case "promedio": valor = nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : 0; break;
      case "minimo": valor = nums.length ? Math.min(...nums) : 0; break;
      case "maximo": valor = nums.length ? Math.max(...nums) : 0; break;
      case "conteo_distintos": valor = new Set(fs.map((x) => x[columna_valor])).size; break;
      default: valor = fs.length; // conteo
    }
    return { grupo, valor };
  });

  // 4) Ordenar y limitar
  tabla.sort((a, b) => orden === "asc" ? a.valor - b.valor : b.valor - a.valor);
  const limitada = tabla.slice(0, limite);

  return {
    operacion, agrupar_por: agrupar_por || null, columna_valor: columna_valor || null,
    etiquetas: limitada.map((r) => r.grupo),
    valores: limitada.map((r) => r.valor),
    tabla: limitada,
    total_grupos: tabla.length,
    total_filas_filtradas: datos.length,
  };
}

function cumpleFiltro(f, flt) {
  const v = f[flt.columna];
  const val = flt.valor;
  switch (flt.operador) {
    case "=": return String(v) === String(val);
    case "!=": return String(v) !== String(val);
    case ">": return num(v) > num(val);
    case "<": return num(v) < num(val);
    case "contiene": return String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
    case "entre": {
      if (esFecha(v)) { const d = +new Date(v); return d >= +new Date(val) && d <= +new Date(flt.valor2); }
      return num(v) >= num(val) && num(v) <= num(flt.valor2);
    }
    default: return true;
  }
}
