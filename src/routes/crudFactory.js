import { Router } from "express";
import { q } from "../db.js";
import { audit } from "../middleware/audit.js";

/**
 * Genera un router CRUD estándar y seguro por tenant para una tabla.
 *  - GET    /          lista (con ?estado=&area=&limit=&offset=)
 *  - GET    /:id       detalle
 *  - POST   /          crear (solo columnas permitidas)
 *  - PATCH  /:id       actualizar parcial
 *  - DELETE /:id       eliminar
 */
export function crudRouter({ table, columns, codePrefix = null, orderBy = "created_at DESC" }) {
  const r = Router();
  const cols = new Set(columns);

  r.get("/", async (req, res, next) => {
    try {
      const filters = []; const params = [req.tenantId];
      for (const k of ["estado", "area", "etapa", "tipo", "prioridad"]) {
        if (req.query[k] && cols.has(k)) { params.push(req.query[k]); filters.push(`${k} = $${params.length}`); }
      }
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const offset = parseInt(req.query.offset) || 0;
      const where = ["tenant_id = $1", ...filters].join(" AND ");
      const { rows } = await q(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`, params);
      res.json(rows);
    } catch (e) { next(e); }
  });

  r.get("/:id", async (req, res, next) => {
    try {
      const { rows } = await q(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2`, [req.tenantId, req.params.id]);
      rows.length ? res.json(rows[0]) : res.status(404).json({ error: "No encontrado" });
    } catch (e) { next(e); }
  });

  r.post("/", async (req, res, next) => {
    try {
      const entries = Object.entries(req.body).filter(([k]) => cols.has(k));
      if (!entries.length) return res.status(400).json({ error: "Sin campos válidos" });
      const names = entries.map(([k]) => k);
      const values = entries.map(([, v]) => (v !== null && typeof v === "object") ? JSON.stringify(v) : v);
      let extraCols = "", extraVals = "";
      if (codePrefix) { extraCols = ", codigo"; extraVals = `, next_code($1, '${table}', '${codePrefix}')`; }
      const placeholders = values.map((_, i) => `$${i + 2}`).join(",");
      const { rows } = await q(
        `INSERT INTO ${table} (tenant_id, ${names.join(",")}${extraCols})
         VALUES ($1, ${placeholders}${extraVals}) RETURNING *`,
        [req.tenantId, ...values]);
      await audit(req, "create", table, rows[0].id, req.body);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  r.patch("/:id", async (req, res, next) => {
    try {
      const entries = Object.entries(req.body).filter(([k]) => cols.has(k));
      if (!entries.length) return res.status(400).json({ error: "Sin campos válidos" });
      const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
      const { rows } = await q(
        `UPDATE ${table} SET ${sets} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [req.tenantId, req.params.id, ...entries.map(([, v]) => (v !== null && typeof v === "object") ? JSON.stringify(v) : v)]);
      if (!rows.length) return res.status(404).json({ error: "No encontrado" });
      await audit(req, "update", table, req.params.id, req.body);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  r.delete("/:id", async (req, res, next) => {
    try {
      const { rowCount } = await q(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=$2`, [req.tenantId, req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "No encontrado" });
      await audit(req, "delete", table, req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return r;
}
