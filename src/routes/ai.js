import { Router } from "express";
import { q } from "../db.js";
import { askAI } from "../services/ai.js";

const r = Router();

/** POST /api/ai/chat  { pregunta, historial?: [{role, content}] } */
r.post("/chat", async (req, res, next) => {
  try {
    const { pregunta, historial = [] } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Falta la pregunta" });
    const { rows } = await q("SELECT rubro FROM tenants WHERE id=$1", [req.tenantId]);
    const respuesta = await askAI(req.tenantId, rows[0]?.rubro || "general", pregunta, historial);
    res.json({ respuesta });
  } catch (e) { next(e); }
});

export default r;
