import { q } from "../db.js";

/** Registra acciones de escritura en la bitácora de auditoría. */
export async function audit(req, action, entityType, entityId, detail = null) {
  try {
    await q(
      "INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5,$6)",
      [req.tenantId, req.user?.id, action, entityType, String(entityId ?? ""), detail]
    );
  } catch { /* la auditoría nunca debe romper la operación principal */ }
}
