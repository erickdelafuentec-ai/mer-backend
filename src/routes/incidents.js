import { q } from "../db.js";
import { audit } from "../middleware/audit.js";
import { crudRouter } from "./crudFactory.js";
import { runWorkflowsFor } from "../services/workflowEngine.js";

const r = crudRouter({
  table: "incidents", codePrefix: "INC",
  columns: ["titulo","tipo","severidad","area","responsable","estado","investigacion","ocurrido_en"],
});

/** POST /api/incidents/:id/avanzar — mueve el incidente a la siguiente etapa */
const ETAPAS = ["reported","investigating","actions","closed"];
r.post("/:id/avanzar", async (req, res, next) => {
  try {
    const { rows } = await q("SELECT estado FROM incidents WHERE tenant_id=$1 AND id=$2", [req.tenantId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "No encontrado" });
    const idx = ETAPAS.indexOf(rows[0].estado);
    const nuevo = ETAPAS[Math.min(idx + 1, ETAPAS.length - 1)];
    const upd = await q("UPDATE incidents SET estado=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *", [req.tenantId, req.params.id, nuevo]);
    await audit(req, "avanzar", "incidents", req.params.id, { a: nuevo });
    await runWorkflowsFor(req.tenantId, "incident.updated", upd.rows[0]);
    res.json(upd.rows[0]);
  } catch (e) { next(e); }
});

export default r;
