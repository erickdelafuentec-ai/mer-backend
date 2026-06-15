import { Router } from "express";
import { analizarArchivo, importarHoja } from "../services/ingest.js";
import { audit } from "../middleware/audit.js";
import { q } from "../db.js";

const r = Router();

/**
 * POST /api/ingest/analizar
 * Recibe el archivo ya parseado en el navegador y devuelve un plan con IA.
 * body: { sheets: [{ nombre, columnas, filas (muestra) }] }
 */
r.post("/analizar", async (req, res, next) => {
  try {
    const { sheets = [] } = req.body;
    if (!sheets.length) return res.status(400).json({ error: "No se recibieron datos del archivo" });
    const t = await q("SELECT rubro FROM tenants WHERE id=$1", [req.tenantId]);
    const plan = await analizarArchivo(t.rows[0]?.rubro || "general", sheets);
    res.json(plan);
  } catch (e) { next(e); }
});

/**
 * POST /api/ingest/importar
 * Importa realmente una hoja según el plan confirmado.
 * body: { hoja, destino, mapeo, filas:[todas] }
 */
r.post("/importar", async (req, res, next) => {
  try {
    const resultado = await importarHoja(req.tenantId, req.body);
    await audit(req, "import", "ingest", req.body?.hoja || "", { destino: req.body?.destino, registros: resultado.registros });
    res.status(201).json(resultado);
  } catch (e) { next(e); }
});

export default r;
