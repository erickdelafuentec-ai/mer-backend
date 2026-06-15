import { q } from "../db.js";
import { audit } from "../middleware/audit.js";
import { crudRouter } from "./crudFactory.js";
import { runWorkflowsFor } from "../services/workflowEngine.js";

const r = crudRouter({
  table: "inspections", codePrefix: "INS",
  columns: ["template_id","plantilla","area","inspector","programada","respuestas","score","criticos_fallidos","fotos","geo","estado"],
});

/** POST /api/inspections/:id/submit — cierre desde la app móvil.
 *  body: { respuestas, score, criticos_fallidos, fotos, geo }
 *  Si hay ítems críticos fallidos, dispara los workflows configurados
 *  (por ejemplo: crear plan de acción y notificar al supervisor). */
r.post("/:id/submit", async (req, res, next) => {
  try {
    const { respuestas = [], score = null, criticos_fallidos = 0, fotos = 0, geo = null } = req.body;
    const { rows } = await q(
      `UPDATE inspections
         SET respuestas=$3, score=$4, criticos_fallidos=$5, fotos=$6, geo=$7, estado='completed'
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [req.tenantId, req.params.id, JSON.stringify(respuestas), score, criticos_fallidos, fotos, geo]);
    if (!rows.length) return res.status(404).json({ error: "No encontrada" });
    await audit(req, "submit", "inspections", req.params.id, { score, criticos_fallidos });
    const acciones = await runWorkflowsFor(req.tenantId, "inspection.completed", rows[0]);
    res.json({ inspeccion: rows[0], workflows_ejecutados: acciones });
  } catch (e) { next(e); }
});

export default r;
