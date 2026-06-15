import jwt from "jsonwebtoken";

const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";

/**
 * Verifica el JWT emitido por NUESTRA propia API (login propio, sin Supabase).
 * El token lleva { sub: userId, tenant_id, role }.
 * En DEMO_MODE=true permite trabajar sin token usando el tenant demo.
 */
export function auth(req, res, next) {
  try {
    if (process.env.DEMO_MODE === "true" && !req.headers.authorization) {
      req.user = { id: null, role: "admin" };
      req.tenantId = DEMO_TENANT;
      return next();
    }
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Token requerido" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.tenantId = payload.tenant_id;
    next();
  } catch (e) {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/** Firma un token de sesión para un usuario ya autenticado. */
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, tenant_id: user.tenant_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Restringe un endpoint a ciertos roles. */
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "Permiso insuficiente" });
