import express from "express";
import cors from "cors";
import "dotenv/config";

import { auth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import { crudRouter } from "./routes/crudFactory.js";
import kpis from "./routes/kpis.js";
import incidents from "./routes/incidents.js";
import inspections from "./routes/inspections.js";
import ai from "./routes/ai.js";
import bootstrap from "./routes/bootstrap.js";
import ingest from "./routes/ingest.js";
import dataRoutes from "./routes/data.js";
import { q } from "./db.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.json({ limit: "100mb" }));

/* ---------- Públicos ---------- */
app.get("/health", (_req, res) => res.json({ ok: true, servicio: "MER Analytics API", version: "1.0.0" }));
app.use("/auth", authRoutes);   // registro e inicio de sesión propios

/* ---------- Protegidos (JWT propio o DEMO_MODE) ---------- */
app.use("/api", auth);

// Todas las rutas /api requieren un espacio de trabajo (lo crea /auth/register).
app.use("/api", (req, res, next) =>
  req.tenantId ? next() : res.status(401).json({ error: "Sesión inválida", code: "NO_TENANT" }));

app.use("/api/bootstrap", bootstrap);

// Info del tenant (incluye el rubro activo)
app.get("/api/tenant", async (req, res, next) => {
  try {
    const { rows } = await q("SELECT id, name, rubro, plan FROM tenants WHERE id=$1", [req.tenantId]);
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});
app.patch("/api/tenant", async (req, res, next) => {
  try {
    const { rubro, name } = req.body;
    const { rows } = await q(
      "UPDATE tenants SET rubro = COALESCE($2, rubro), name = COALESCE($3, name) WHERE id=$1 RETURNING id, name, rubro, plan",
      [req.tenantId, rubro, name]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Dominios con lógica propia
app.use("/api/kpis", kpis);
app.use("/api/incidents", incidents);
app.use("/api/inspections", inspections);
app.use("/api/ai", ai);
app.use("/api/ingest", ingest);
app.use("/api/data", dataRoutes);

// Dominios CRUD estándar
app.use("/api/risks", crudRouter({
  table: "risks", codePrefix: "R",
  columns: ["peligro","area","probabilidad","consecuencia","controles","controles_criticos","dueno","estado"],
}));
app.use("/api/action-plans", crudRouter({
  table: "action_plans", codePrefix: "PA",
  columns: ["origen","titulo","prioridad","responsable","vence","estado","evidencia"],
}));
app.use("/api/workflows", crudRouter({
  table: "workflows",
  columns: ["nombre","trigger_def","pasos","activo"],
}));
app.use("/api/opportunities", crudRouter({
  table: "opportunities", codePrefix: "OP",
  columns: ["cliente","titulo","monto","etapa","probabilidad","cierre_estimado"],
}));
app.use("/api/checklist-templates", crudRouter({
  table: "checklist_templates",
  columns: ["nombre","secciones","activo"],
}));
app.use("/api/data-sources", crudRouter({
  table: "data_sources",
  columns: ["nombre","tipo","config","estado","ultima_sync"],
}));

// Bitácora de auditoría (solo lectura)
app.get("/api/audit-log", async (req, res, next) => {
  try {
    const { rows } = await q(
      "SELECT action, entity_type, entity_id, detail, created_at FROM audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.tenantId]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- Errores ---------- */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno", detalle: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✓ MER Analytics API escuchando en http://localhost:${PORT}`));
