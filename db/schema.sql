-- ============================================================
-- MER ANALYTICS INTELLIGENCE — Esquema PostgreSQL v1.0
-- Multi-tenant (una BD compartida, aislamiento por tenant_id + RLS)
-- Compatible con Supabase. Ejecutar en el SQL Editor de Supabase.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- NÚCLEO ----------
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  rubro TEXT NOT NULL DEFAULT 'comercial',     -- mineria|construccion|logistica|bodega|alimentos|comercial|seguridad|climatizacion|salud
  plan TEXT NOT NULL DEFAULT 'trial',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- generado por la API (login propio)
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT,                           -- bcrypt (login propio, sin Supabase)
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',          -- owner|admin|manager|analyst|inspector|viewer
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- BI ----------
CREATE TABLE IF NOT EXISTS kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  unidad TEXT DEFAULT '',
  meta NUMERIC,
  umbral_amarillo NUMERIC,                      -- bajo/encima de esto: amarillo
  umbral_rojo NUMERIC,                          -- bajo/encima de esto: rojo
  direccion TEXT DEFAULT 'up',                  -- up: más es mejor | down: menos es mejor
  frecuencia TEXT DEFAULT 'monthly',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_values (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kpi_id UUID NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  ts DATE NOT NULL,
  value NUMERIC NOT NULL,
  UNIQUE (kpi_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_kpi_values ON kpi_values (tenant_id, kpi_id, ts);

-- ---------- RIESGOS ----------
CREATE TABLE IF NOT EXISTS risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  peligro TEXT NOT NULL,
  area TEXT,
  probabilidad INT CHECK (probabilidad BETWEEN 1 AND 5),
  consecuencia INT CHECK (consecuencia BETWEEN 1 AND 5),
  controles INT DEFAULT 0,
  controles_criticos INT DEFAULT 0,
  dueno TEXT,
  estado TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- INCIDENTES ----------
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,                                  -- INC-2026-0001 (generado por la API)
  titulo TEXT NOT NULL,
  tipo TEXT,                                    -- accidente|incidente|casi_accidente|hallazgo
  severidad TEXT,                               -- Crítica|Alta|Media|Baja
  area TEXT,
  ocurrido_en TIMESTAMPTZ DEFAULT now(),
  responsable TEXT,
  estado TEXT DEFAULT 'reported',               -- reported|investigating|actions|closed
  investigacion JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- INSPECCIONES ----------
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  secciones JSONB NOT NULL DEFAULT '[]',        -- [{titulo, items:[{pregunta, tipo, critico}]}]
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  template_id UUID REFERENCES checklist_templates(id),
  plantilla TEXT,
  area TEXT,
  inspector TEXT,
  programada DATE,
  respuestas JSONB DEFAULT '[]',
  score NUMERIC,
  criticos_fallidos INT DEFAULT 0,
  fotos INT DEFAULT 0,
  geo JSONB,
  estado TEXT DEFAULT 'scheduled',              -- scheduled|in_progress|completed
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- PLANES DE ACCIÓN ----------
CREATE TABLE IF NOT EXISTS action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  origen TEXT,                                  -- código del incidente/inspección/auditoría
  titulo TEXT NOT NULL,
  prioridad TEXT DEFAULT 'Media',
  responsable TEXT,
  vence DATE,
  estado TEXT DEFAULT 'open',                   -- open|in_progress|done|overdue
  evidencia JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- AUTOMATIZACIÓN ----------
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  trigger_def JSONB NOT NULL,                   -- {tipo:'evento'|'umbral'|'cron', config:{...}}
  pasos JSONB NOT NULL DEFAULT '[]',
  activo BOOLEAN DEFAULT true,
  ejecuciones INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  disparado_por JSONB,
  estado TEXT DEFAULT 'completed',
  log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- COMERCIAL / CONVENIOS ----------
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  cliente TEXT NOT NULL,
  titulo TEXT,
  monto NUMERIC DEFAULT 0,
  etapa TEXT DEFAULT 'lead',                    -- lead|qualified|proposal|negotiation|won|lost
  probabilidad NUMERIC DEFAULT 10,
  cierre_estimado DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- CENTRO DE DATOS ----------
CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,                           -- excel|postgres|sqlserver|api|supabase
  config JSONB DEFAULT '{}',                    -- credenciales: cifrar en producción
  estado TEXT DEFAULT 'ok',
  ultima_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AISLAMIENTO ENTRE EMPRESAS (multi-tenant)
-- Con login propio, la API se conecta con un único rol y SIEMPRE
-- filtra por tenant_id en cada consulta (ver crudFactory.js y rutas).
-- No se usan políticas RLS de Supabase. Si más adelante expones la
-- base de datos a clientes directos, puedes añadir RLS aquí.
-- ============================================================

-- Correlativo simple por tabla y tenant
CREATE TABLE IF NOT EXISTS counters (
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL,
  n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, scope)
);

CREATE OR REPLACE FUNCTION next_code(p_tenant UUID, p_scope TEXT, p_prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v INT;
BEGIN
  INSERT INTO counters (tenant_id, scope, n) VALUES (p_tenant, p_scope, 1)
  ON CONFLICT (tenant_id, scope) DO UPDATE SET n = counters.n + 1
  RETURNING n INTO v;
  RETURN p_prefix || '-' || to_char(now(),'YYYY') || '-' || lpad(v::text, 4, '0');
END $$;
