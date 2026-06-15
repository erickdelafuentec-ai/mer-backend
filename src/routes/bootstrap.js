import { Router } from "express";
import { q } from "../db.js";

const r = Router();

/**
 * GET /api/bootstrap
 * Entrega en una sola llamada todo lo que el frontend necesita para
 * pintar la plataforma: tenant (rubro), KPIs con su último valor,
 * riesgos, incidentes, inspecciones, planes, workflows y pipeline.
 * Si el tenant aún no tiene datos para su rubro, los siembra una vez.
 */
r.get("/", async (req, res, next) => {
  try {
    const t = await q("SELECT id, name, rubro, plan FROM tenants WHERE id=$1", [req.tenantId]);
    if (!t.rows.length) return res.status(404).json({ error: "Tenant no encontrado" });
    const tenant = t.rows[0];

    // Sembrar datos de arranque la primera vez (por rubro)
    const count = await q("SELECT count(*)::int AS n FROM kpis WHERE tenant_id=$1", [req.tenantId]);
    if (count.rows[0].n === 0) await seedRubro(req.tenantId, tenant.rubro);

    const [kpis, riesgos, incidentes, inspecciones, planes, workflows, pipeline] = await Promise.all([
      q(`SELECT k.*, (SELECT value FROM kpi_values v WHERE v.kpi_id=k.id ORDER BY ts DESC LIMIT 1) AS valor_actual,
                (SELECT json_agg(value ORDER BY ts) FROM kpi_values v WHERE v.kpi_id=k.id) AS serie
         FROM kpis k WHERE k.tenant_id=$1 ORDER BY k.created_at`, [req.tenantId]),
      q("SELECT * FROM risks WHERE tenant_id=$1 ORDER BY probabilidad*consecuencia DESC", [req.tenantId]),
      q("SELECT * FROM incidents WHERE tenant_id=$1 ORDER BY created_at DESC", [req.tenantId]),
      q("SELECT * FROM inspections WHERE tenant_id=$1 ORDER BY created_at DESC", [req.tenantId]),
      q("SELECT * FROM action_plans WHERE tenant_id=$1 ORDER BY created_at DESC", [req.tenantId]),
      q("SELECT * FROM workflows WHERE tenant_id=$1 ORDER BY created_at", [req.tenantId]),
      q("SELECT * FROM opportunities WHERE tenant_id=$1 ORDER BY monto DESC", [req.tenantId]),
    ]);

    res.json({
      tenant,
      kpis: kpis.rows, riesgos: riesgos.rows, incidentes: incidentes.rows,
      inspecciones: inspecciones.rows, planes: planes.rows,
      workflows: workflows.rows, pipeline: pipeline.rows,
    });
  } catch (e) { next(e); }
});

/** Siembra un set mínimo de datos coherentes con el rubro elegido. */
async function seedRubro(tenantId, rubro) {
  const sets = {
    salud: {
      kpis: [["Lista de espera (días)","d",75,"down",94],["Espera en urgencias","min",120,"down",142],["Ocupación de camas","%",85,"up",87],["Tasa de IAAS","%",2,"down",1.8]],
      riesgos: [["Error de medicación","Farmacia",3,5,3,2],["Caída de pacientes","Hospitalización",4,3,2,1],["IAAS","Hospitalización",3,4,4,2]],
    },
    mineria: {
      kpis: [["Producción procesada","kt",520,"up",571],["Cumplimiento inspecciones","%",95,"up",87],["Controles críticos","%",90,"up",72],["Disponibilidad planta","%",93,"up",95]],
      riesgos: [["Caída de altura en silos","Mantención",2,4,3,2],["Atrapamiento en correa","Chancado",1,5,4,2],["Polvo de sílice","Planta Norte",4,3,2,1]],
    },
    construccion: {
      kpis: [["Avance físico","%",78,"up",71],["Cumplimiento inspecciones","%",95,"up",84],["Controles críticos","%",90,"up",69],["Costo vs presupuesto","%",100,"down",96]],
      riesgos: [["Caída en moldajes","Obra Gruesa",4,5,3,2],["Desplome de excavación","Estructuras",3,5,2,1],["Carga suspendida","Estructuras",3,5,4,2]],
    },
    logistica: {
      kpis: [["Entregas a tiempo","%",96,"up",94],["Check pre-uso flota","%",100,"up",88],["Disponibilidad flota","%",92,"up",93],["Costo por km","$",430,"down",412]],
      riesgos: [["Volcamiento en ruta","Ruta Norte",3,5,3,1],["Fatiga del conductor","Flota",4,4,2,1],["Atropello en patio","Centro de Distribución",2,5,3,2]],
    },
    comercial: {
      kpis: [["Ventas del mes","M$",520,"up",571],["Conversión","%",4,"up",3.4],["Ticket promedio","k$",40,"up",42.5],["Quiebres de stock","%",4,"down",6.2]],
      riesgos: [["Pérdida desconocida","Tienda Centro",4,3,3,1],["Caída de clientes","Tienda Mall",3,3,2,0],["Fraude e-commerce","E-commerce",2,4,3,1]],
    },
  };
  const data = sets[rubro] || sets.comercial;
  for (const [nombre, unidad, meta, direccion, valor] of data.kpis) {
    const k = await q(
      "INSERT INTO kpis (tenant_id, nombre, unidad, meta, direccion) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [tenantId, nombre, unidad, meta, direccion]);
    // 6 meses de historia simple alrededor del valor actual
    for (let m = 5; m >= 0; m--) {
      const ts = `2026-0${6 - m}-01`;
      const v = +(valor * (1 - m * 0.02 * (direccion === "up" ? 1 : -1))).toFixed(1);
      await q("INSERT INTO kpi_values (tenant_id, kpi_id, ts, value) VALUES ($1,$2,$3,$4)", [tenantId, k.rows[0].id, ts, v]);
    }
  }
  for (const [peligro, area, p, c, ctrl, crit] of data.riesgos) {
    await q(
      "INSERT INTO risks (tenant_id, codigo, peligro, area, probabilidad, consecuencia, controles, controles_criticos, dueno) VALUES ($1, next_code($1,'risks','R'), $2,$3,$4,$5,$6,$7,'Por asignar')",
      [tenantId, peligro, area, p, c, ctrl, crit]);
  }
  // Un workflow estrella ya activo
  await q(
    `INSERT INTO workflows (tenant_id, nombre, trigger_def, pasos, activo) VALUES
     ($1, 'Hallazgo crítico → plan + aviso',
      '{"tipo":"evento","evento":"inspection.completed","condicion":"criticos_fallidos>0"}',
      '[{"tipo":"crear_plan","prioridad":"Crítica","plazo_dias":5},{"tipo":"notificar_whatsapp","destinatario":"supervisor"}]', true)`,
    [tenantId]);
}

export default r;
