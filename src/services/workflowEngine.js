import { q } from "../db.js";

/**
 * Motor de workflows (versión 1, síncrona).
 * Busca workflows activos del tenant cuyo trigger coincida con el evento
 * y ejecuta sus pasos. Los pasos de notificación quedan registrados en el
 * log del run; conectar SMTP / WhatsApp Business API es configuración de despliegue.
 *
 * Formato de workflow:
 *   trigger_def: { tipo: "evento", evento: "inspection.completed", condicion?: "criticos_fallidos>0" }
 *   pasos: [
 *     { tipo: "crear_plan", titulo?, prioridad?, responsable?, plazo_dias? },
 *     { tipo: "notificar_email", destinatario },
 *     { tipo: "notificar_whatsapp", destinatario }
 *   ]
 */
export async function runWorkflowsFor(tenantId, evento, entidad) {
  const { rows: wfs } = await q(
    `SELECT * FROM workflows
      WHERE tenant_id=$1 AND activo=true
        AND trigger_def->>'tipo' = 'evento'
        AND trigger_def->>'evento' = $2`,
    [tenantId, evento]);

  const ejecutados = [];
  for (const wf of wfs) {
    const cond = wf.trigger_def?.condicion;
    if (cond === "criticos_fallidos>0" && !(entidad.criticos_fallidos > 0)) continue;

    const log = [];
    for (const paso of wf.pasos) {
      switch (paso.tipo) {
        case "crear_plan": {
          const { rows } = await q(
            `INSERT INTO action_plans (tenant_id, codigo, origen, titulo, prioridad, responsable, vence, estado)
             VALUES ($1, next_code($1,'action_plans','PA'), $2, $3, $4, $5,
                     now()::date + make_interval(days => $6), 'open')
             RETURNING codigo`,
            [tenantId,
             entidad.codigo || String(entidad.id),
             paso.titulo || ("Acción derivada de " + evento),
             paso.prioridad || "Alta",
             paso.responsable || entidad.inspector || entidad.responsable || "Por asignar",
             paso.plazo_dias || 7]);
          log.push({ paso: "crear_plan", resultado: rows[0].codigo });
          break;
        }
        case "notificar_email":
        case "notificar_whatsapp":
          // Punto de integración: SendGrid / WhatsApp Business API.
          log.push({ paso: paso.tipo, destinatario: paso.destinatario || "supervisor", estado: "encolado" });
          break;
        default:
          log.push({ paso: paso.tipo, estado: "omitido (tipo no soportado en v1)" });
      }
    }
    await q(
      "INSERT INTO workflow_runs (tenant_id, workflow_id, disparado_por, estado, log) VALUES ($1,$2,$3,$4,$5)",
      [tenantId, wf.id, { evento, entidad: entidad.codigo || entidad.id }, "completed", JSON.stringify(log)]);
    await q("UPDATE workflows SET ejecuciones = ejecuciones + 1 WHERE id=$1", [wf.id]);
    ejecutados.push({ workflow: wf.nombre, log });
  }
  return ejecutados;
}
