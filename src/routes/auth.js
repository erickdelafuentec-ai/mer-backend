import { Router } from "express";
import bcrypt from "bcryptjs";
import { q } from "../db.js";
import { signToken } from "../middleware/auth.js";

const r = Router();

/**
 * POST /auth/register
 * Crea la empresa (tenant) + el usuario dueño, y devuelve un token de sesión.
 * body: { email, password, empresa, rubro }
 */
r.post("/register", async (req, res, next) => {
  try {
    const { email, password, empresa = "Mi Empresa", rubro = "comercial" } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Correo y contraseña son obligatorios" });
    if (password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });

    const existe = await q("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
    if (existe.rows.length) return res.status(409).json({ error: "Ya existe una cuenta con ese correo" });

    const slug = (empresa.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "empresa") + "-" + Date.now().toString(36);
    const tn = await q(
      "INSERT INTO tenants (name, slug, rubro, plan) VALUES ($1,$2,$3,'trial') RETURNING id, name, rubro, plan",
      [empresa, slug, rubro]);

    const hash = await bcrypt.hash(password, 10);
    const u = await q(
      "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,'owner') RETURNING id, email, tenant_id, role",
      [tn.rows[0].id, email, hash]);

    const token = signToken(u.rows[0]);
    res.status(201).json({ token, tenant: tn.rows[0], user: { email, role: "owner" } });
  } catch (e) { next(e); }
});

/**
 * POST /auth/login
 * body: { email, password } → { token, tenant }
 */
r.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Correo y contraseña son obligatorios" });

    const { rows } = await q(
      "SELECT id, email, password_hash, tenant_id, role FROM users WHERE lower(email)=lower($1)", [email]);
    if (!rows.length) return res.status(401).json({ error: "Correo o contraseña incorrectos" });

    const ok = await bcrypt.compare(password, rows[0].password_hash || "");
    if (!ok) return res.status(401).json({ error: "Correo o contraseña incorrectos" });

    const tn = await q("SELECT id, name, rubro, plan FROM tenants WHERE id=$1", [rows[0].tenant_id]);
    const token = signToken(rows[0]);
    res.json({ token, tenant: tn.rows[0], user: { email: rows[0].email, role: rows[0].role } });
  } catch (e) { next(e); }
});

export default r;
