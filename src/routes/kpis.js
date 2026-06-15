import { Router } from "express";
import { q } from "../db.js";
import { crudRouter } from "./crudFactory.js";

const r = crudRouter({ table: "kpis", columns: ["nombre","unidad","meta","umbral_amarillo","umbral_rojo","direccion","frecuencia"] });

/** GET /api/kpis/:id/values — serie histórica */
r.get("/:id/values", async (req, res, next) => {
  try {
    const { rows } = await q(
      "SELECT ts, value FROM kpi_values WHERE tenant_id=$1 AND kpi_id=$2 ORDER BY ts",
      [req.tenantId, req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

/** POST /api/kpis/:id/values  { ts: "2026-06-01", value: 87 } — carga manual o desde Excel/ETL */
r.post("/:id/values", async (req, res, next) => {
  try {
    const { ts, value } = req.body;
    const { rows } = await q(
      `INSERT INTO kpi_values (tenant_id, kpi_id, ts, value) VALUES ($1,$2,$3,$4)
       ON CONFLICT (kpi_id, ts) DO UPDATE SET value = EXCLUDED.value RETURNING *`,
      [req.tenantId, req.params.id, ts, value]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/** POST /api/kpis/import — carga masiva (filas de un Excel convertidas a JSON)
 *  body: { kpi_id, filas: [{ts, value}, ...] }   */
r.post("/import/bulk", async (req, res, next) => {
  try {
    const { kpi_id, filas = [] } = req.body;
    let n = 0;
    for (const f of filas) {
      await q(
        `INSERT INTO kpi_values (tenant_id, kpi_id, ts, value) VALUES ($1,$2,$3,$4)
         ON CONFLICT (kpi_id, ts) DO UPDATE SET value = EXCLUDED.value`,
        [req.tenantId, kpi_id, f.ts, f.value]); n++;
    }
    res.json({ importadas: n });
  } catch (e) { next(e); }
});

export default r;
