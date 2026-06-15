import { Router } from "express";
import { q } from "../db.js";
import { audit } from "../middleware/audit.js";
import { detectarColumnas, ejecutarAnalisis } from "../services/analytics.js";

const r = Router();

/**
 * POST /api/data/dataset
 * Guarda un archivo subido (ya parseado en el navegador) como dataset.
 * body: { nombre, origen, periodo, filas:[...todas...] }
 * Detecta el tipo de cada columna y deja el dataset listo para explorar.
 */
r.post("/dataset", async (req, res, next) => {
  try {
    const { nombre = "Datos", origen = "", periodo = "", filas = [] } = req.body;
    if (!filas.length) return res.status(400).json({ error: "El archivo no tiene filas" });
    const columnas = detectarColumnas(filas);
    const { rows } = await q(
      `INSERT INTO datasets (tenant_id, nombre, origen, columnas, filas, total_filas, periodo)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nombre, origen, columnas, total_filas, periodo, created_at`,
      [req.tenantId, nombre, origen, JSON.stringify(columnas), JSON.stringify(filas), filas.length, periodo]);
    await audit(req, "create", "datasets", rows[0].id, { nombre, filas: filas.length });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/** GET /api/data/datasets — lista de archivos cargados (sin las filas, para que sea liviano) */
r.get("/datasets", async (req, res, next) => {
  try {
    const { rows } = await q(
      "SELECT id, nombre, origen, columnas, total_filas, periodo, rubro_detectado, created_at FROM datasets WHERE tenant_id=$1 ORDER BY created_at DESC",
      [req.tenantId]);
    res.json(rows);
  } catch (e) { next(e); }
});

/** GET /api/data/datasets/:id — un dataset completo (con filas) */
r.get("/datasets/:id", async (req, res, next) => {
  try {
    const { rows } = await q("SELECT * FROM datasets WHERE tenant_id=$1 AND id=$2", [req.tenantId, req.params.id]);
    rows.length ? res.json(rows[0]) : res.status(404).json({ error: "No encontrado" });
  } catch (e) { next(e); }
});

/** DELETE /api/data/datasets/:id */
r.delete("/datasets/:id", async (req, res, next) => {
  try {
    await q("DELETE FROM datasets WHERE tenant_id=$1 AND id=$2", [req.tenantId, req.params.id]);
    res.status(204).end();
  } catch (e) { next(e); }
});

/**
 * POST /api/data/analizar
 * Ejecuta un análisis sobre un dataset guardado.
 * body: { dataset_id, config:{ operacion, agrupar_por, columna_valor, filtros, granularidad_fecha, orden, limite } }
 */
r.post("/analizar", async (req, res, next) => {
  try {
    const { dataset_id, config } = req.body;
    const { rows } = await q("SELECT filas FROM datasets WHERE tenant_id=$1 AND id=$2", [req.tenantId, dataset_id]);
    if (!rows.length) return res.status(404).json({ error: "Dataset no encontrado" });
    const resultado = ejecutarAnalisis(rows[0].filas, config || {});
    res.json(resultado);
  } catch (e) { next(e); }
});

/**
 * POST /api/data/sugerencias
 * La IA mira las columnas reales del dataset y propone los análisis más útiles,
 * cada uno listo para ejecutarse (con su config). También deduce el rubro.
 * body: { dataset_id }
 */
r.post("/sugerencias", async (req, res, next) => {
  try {
    const { dataset_id } = req.body;
    const { rows } = await q("SELECT nombre, columnas, filas FROM datasets WHERE tenant_id=$1 AND id=$2", [req.tenantId, dataset_id]);
    if (!rows.length) return res.status(404).json({ error: "Dataset no encontrado" });
    const ds = rows[0];
    const muestra = (ds.filas || []).slice(0, 10);

    const system = `Eres un analista de datos. Recibes las columnas (con su tipo detectado) y una muestra de filas de un archivo real.
Tu tarea:
1) Deducir a qué ámbito/rubro pertenecen los datos (ej: salud/REM, ventas, logística, RRHH...).
2) Proponer entre 4 y 7 análisis CONCRETOS y útiles que se puedan hacer con ESTAS columnas reales.

Para cada análisis devuelve una config ejecutable con esta forma exacta:
{
  "titulo": "<título claro, ej: 'Atenciones por diagnóstico'>",
  "descripcion": "<1 frase de qué responde>",
  "grafico": "barra|linea|torta|tabla|numero",
  "config": {
    "operacion": "conteo|suma|promedio|minimo|maximo|conteo_distintos",
    "agrupar_por": "<nombre EXACTO de una columna existente, o null>",
    "columna_valor": "<nombre EXACTO de una columna numérica, o null>",
    "granularidad_fecha": "anio|mes|dia",
    "orden": "desc",
    "limite": 20
  }
}

Reglas:
- Usa SOLO nombres de columnas que existan realmente (te los doy).
- Para "cuántas atenciones por X" usa operacion "conteo" y agrupar_por "X".
- Para "promedio de edad por X" usa operacion "promedio", columna_valor la de edad, agrupar_por "X".
- Para evolución en el tiempo usa grafico "linea" y agrupar_por la columna de fecha.
Responde ÚNICAMENTE con JSON válido:
{ "rubro_detectado": "<texto>", "resumen": "<2 frases sobre qué contiene el archivo>", "sugerencias": [ ...análisis... ] }`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 2500, system,
        messages: [{ role: "user", content: `Archivo: ${ds.nombre}\nColumnas detectadas: ${JSON.stringify(ds.columnas)}\nMuestra de filas: ${JSON.stringify(muestra)}` }],
      }),
    });
    if (!resp.ok) throw new Error("Fallo del servicio de IA: " + resp.status);
    const data = await resp.json();
    const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("La IA no devolvió sugerencias válidas");
    const plan = JSON.parse(m[0]);

    // Guardar el rubro detectado en el dataset
    if (plan.rubro_detectado) {
      await q("UPDATE datasets SET rubro_detectado=$3 WHERE tenant_id=$1 AND id=$2", [req.tenantId, dataset_id, plan.rubro_detectado]);
    }
    res.json(plan);
  } catch (e) { next(e); }
});

/**
 * POST /api/data/preguntar
 * Pregunta libre en lenguaje natural sobre un dataset. La IA traduce la
 * pregunta a una config de análisis, la ejecutamos, y la IA explica el resultado.
 * body: { dataset_id, pregunta }
 */
r.post("/preguntar", async (req, res, next) => {
  try {
    const { dataset_id, pregunta } = req.body;
    const { rows } = await q("SELECT nombre, columnas, filas FROM datasets WHERE tenant_id=$1 AND id=$2", [req.tenantId, dataset_id]);
    if (!rows.length) return res.status(404).json({ error: "Dataset no encontrado" });
    const ds = rows[0];

    // Paso 1: la IA traduce la pregunta a una config
    const sysConfig = `Traduce la pregunta del usuario a una config de análisis sobre estas columnas reales: ${JSON.stringify(ds.columnas)}.
Responde SOLO JSON: { "config": { "operacion":"conteo|suma|promedio|minimo|maximo|conteo_distintos", "agrupar_por":"<columna o null>", "columna_valor":"<columna o null>", "granularidad_fecha":"anio|mes|dia", "filtros":[{"columna":"","operador":"=|!=|>|<|contiene|entre","valor":"","valor2":""}], "orden":"desc", "limite":20 }, "grafico":"barra|linea|torta|tabla|numero", "titulo":"<título>" }
Usa SOLO nombres de columnas existentes.`;
    const resp1 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, system: sysConfig, messages: [{ role: "user", content: pregunta }] }),
    });
    if (!resp1.ok) throw new Error("Fallo del servicio de IA: " + resp1.status);
    const d1 = await resp1.json();
    const t1 = (d1.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const m1 = t1.match(/\{[\s\S]*\}/);
    if (!m1) throw new Error("No pude interpretar la pregunta");
    const plan = JSON.parse(m1[0]);

    // Paso 2: ejecutar el análisis sobre los datos reales
    const resultado = ejecutarAnalisis(ds.filas, plan.config || {});

    // Paso 3: la IA redacta una conclusión breve sobre el resultado real
    const sysExpl = `Eres un analista. En 2-3 frases en español, responde la pregunta del usuario usando estos resultados reales. Sé concreto con los números.`;
    const resp2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 500, system: sysExpl,
        messages: [{ role: "user", content: `Pregunta: ${pregunta}\nResultado: ${JSON.stringify(resultado.tabla.slice(0, 15))}` }] }),
    });
    const d2 = await resp2.json();
    const explicacion = (d2.content || []).filter(b => b.type === "text").map(b => b.text).join("");

    res.json({ titulo: plan.titulo || pregunta, grafico: plan.grafico || "barra", resultado, explicacion });
  } catch (e) { next(e); }
});

export default r;
