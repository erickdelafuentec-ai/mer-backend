import { q } from "../db.js";

/**
 * Construye el contexto operacional del tenant (lo que la IA "ve")
 * y consulta el modelo. La clave de IA vive SOLO en el servidor.
 */
export async function askAI(tenantId, rubro, pregunta, historial = []) {
  const [kpis, riesgos, incidentes, inspecciones, planes, pipeline] = await Promise.all([
    q(`SELECT k.nombre, k.unidad, k.meta, k.direccion,
              (SELECT value FROM kpi_values v WHERE v.kpi_id=k.id ORDER BY ts DESC LIMIT 1) AS valor_actual
       FROM kpis k WHERE k.tenant_id=$1`, [tenantId]),
    q("SELECT codigo, peligro, area, probabilidad*consecuencia AS nivel, controles_criticos FROM risks WHERE tenant_id=$1 AND estado='active'", [tenantId]),
    q("SELECT codigo, titulo, tipo, severidad, area, estado FROM incidents WHERE tenant_id=$1 AND estado <> 'closed'", [tenantId]),
    q("SELECT codigo, plantilla, area, score, criticos_fallidos, estado FROM inspections WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10", [tenantId]),
    q("SELECT codigo, titulo, prioridad, responsable, vence, estado FROM action_plans WHERE tenant_id=$1 AND estado <> 'done'", [tenantId]),
    q("SELECT cliente, titulo, monto, etapa, probabilidad FROM opportunities WHERE tenant_id=$1", [tenantId]),
  ]);

  const contexto = JSON.stringify({
    rubro, kpis: kpis.rows, riesgos: riesgos.rows, incidentes_abiertos: incidentes.rows,
    inspecciones_recientes: inspecciones.rows, planes_pendientes: planes.rows, pipeline: pipeline.rows,
  });

  const system = `Eres el asistente empresarial de MER Analytics Intelligence para una empresa del rubro ${rubro}. Respondes SIEMPRE en español, ejecutivo y conciso (máx ~150 palabras), citando datos concretos del contexto. Si corresponde, cierra con 1-2 acciones recomendadas. Contexto operacional (JSON): ${contexto}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [...historial.slice(-8), { role: "user", content: pregunta }],
    }),
  });
  if (!resp.ok) throw new Error("Fallo del servicio de IA: " + resp.status);
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}
