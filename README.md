# MER Analytics Intelligence — Backend API

API REST multi-empresa (multi-tenant) y multi-rubro que da persistencia real a la plataforma MER: PostgreSQL, autenticación con Supabase, asistente de IA en el servidor y motor de workflows que convierte eventos en acciones (ej: inspección con hallazgo crítico → plan de acción automático).

## Requisitos
- Node.js 20+
- Una cuenta gratuita en [supabase.com](https://supabase.com) (incluye PostgreSQL + autenticación)
- Una clave de API de Anthropic para el asistente de IA (opcional para empezar)

## Puesta en marcha (15 minutos)

**1. Crear el proyecto en Supabase**
- Crea un proyecto nuevo en supabase.com.
- Abre el **SQL Editor** y ejecuta el contenido de `db/schema.sql` (crea todas las tablas, seguridad por empresa y correlativos).
- Luego ejecuta `db/seed.sql` (crea la empresa demo con rubro *salud* y datos de ejemplo; puedes cambiar el rubro).

**2. Configurar el backend**
```bash
cp .env.example .env
# Edita .env con:
#  - DATABASE_URL  → Supabase: Settings → Database → Connection string (URI)
#  - SUPABASE_JWT_SECRET → Settings → API → JWT Secret
#  - ANTHROPIC_API_KEY → tu clave de IA (opcional al inicio)
npm install
npm start
```
Verás: `✓ MER Analytics API escuchando en http://localhost:4000`

**3. Probarlo (DEMO_MODE=true no exige token)**
```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/tenant
curl http://localhost:4000/api/risks
curl -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Prueba desde la API","tipo":"hallazgo","severidad":"Media","area":"Urgencias"}'
```

## Endpoints principales
| Método y ruta | Descripción |
|---|---|
| `GET/PATCH /api/tenant` | Datos de la empresa y **cambio de rubro** |
| `GET/POST/PATCH/DELETE /api/kpis` | KPIs configurables |
| `GET/POST /api/kpis/:id/values` | Serie histórica de un KPI |
| `POST /api/kpis/import/bulk` | **Carga masiva desde Excel** (filas en JSON) |
| `/api/risks` | Matriz de riesgos |
| `/api/incidents` + `POST /:id/avanzar` | Incidentes y su flujo de etapas |
| `/api/inspections` + `POST /:id/submit` | Inspecciones; el cierre **dispara workflows** |
| `/api/action-plans` | Planes de acción |
| `/api/workflows` | Automatizaciones configurables |
| `/api/opportunities` | Pipeline comercial / convenios |
| `/api/checklist-templates` | Plantillas de checklist |
| `/api/data-sources` | Fuentes de datos conectadas |
| `POST /api/ai/chat` | Asistente IA con contexto real de la BD |
| `GET /api/audit-log` | Bitácora de auditoría |

## Ejemplo del flujo estrella (dato → acción)
1. Crea un workflow:
```json
POST /api/workflows
{
  "nombre": "Hallazgo crítico → plan + aviso",
  "trigger_def": { "tipo": "evento", "evento": "inspection.completed", "condicion": "criticos_fallidos>0" },
  "pasos": [
    { "tipo": "crear_plan", "prioridad": "Crítica", "plazo_dias": 5 },
    { "tipo": "notificar_whatsapp", "destinatario": "supervisor" }
  ],
  "activo": true
}
```
2. Cierra una inspección con `POST /api/inspections/:id/submit` y `"criticos_fallidos": 2`.
3. La API crea automáticamente el plan de acción (PA-2026-XXXX), registra el run del workflow y deja la notificación encolada. Todo queda en `audit_log`.

## Carga de datos desde Excel (caso hospitales / estadística)
En el frontend se lee el archivo con SheetJS y se envían las filas:
```json
POST /api/kpis/import/bulk
{ "kpi_id": "<uuid del KPI>", "filas": [ {"ts":"2026-01-01","value":78}, {"ts":"2026-02-01","value":82} ] }
```

## Autenticación en producción
1. Pon `DEMO_MODE=false`.
2. Los usuarios inician sesión con **Supabase Auth** en el frontend (email, Google o Microsoft).
3. El frontend envía el token en cada petición: `Authorization: Bearer <access_token>`.
4. Registra cada usuario en la tabla `users` con su `tenant_id` y rol (owner/admin/manager/analyst/inspector/viewer).

## Conectar el frontend
En la app React reemplaza los datos en memoria por llamadas a esta API:
```js
const API = "http://localhost:4000";
const riesgos = await fetch(`${API}/api/risks`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
```

## Despliegue
- **API:** Railway, Render o Fly.io (`npm start`, variables del `.env`).
- **Base de datos:** ya vive en Supabase.
- **Frontend:** Vercel.
- Pendientes para producción completa (puntos de integración ya marcados en el código): envío real de email/WhatsApp, generación de PDF en servidor y sincronizadores de SQL Server/APIs externas.
