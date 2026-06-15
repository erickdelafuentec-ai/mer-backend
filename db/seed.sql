-- Datos iniciales: empresa demo (rubro salud) + KPIs y registros de ejemplo.
-- Ejecutar DESPUÉS de schema.sql. Cambia el rubro si lo deseas.

INSERT INTO tenants (id, name, slug, rubro, plan) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Empresa Demo SpA', 'demo', 'salud', 'professional')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO kpis (tenant_id, nombre, unidad, meta, direccion) VALUES
  ('00000000-0000-0000-0000-000000000001','Lista de espera (días promedio)','d',75,'down'),
  ('00000000-0000-0000-0000-000000000001','Tiempo de espera en urgencias','min',120,'down'),
  ('00000000-0000-0000-0000-000000000001','Ocupación de camas','%',85,'up'),
  ('00000000-0000-0000-0000-000000000001','Tasa de IAAS','%',2.0,'down');

INSERT INTO risks (tenant_id, codigo, peligro, area, probabilidad, consecuencia, controles, controles_criticos, dueno) VALUES
  ('00000000-0000-0000-0000-000000000001','R-01','Error de medicación en administración','Farmacia',3,5,3,2,'C. Rojas'),
  ('00000000-0000-0000-0000-000000000001','R-02','Caída de pacientes hospitalizados','Hospitalización',4,3,2,1,'A. Vidal'),
  ('00000000-0000-0000-0000-000000000001','R-03','Infección asociada a la atención (IAAS)','Hospitalización',3,4,4,2,'M. Soto');

INSERT INTO incidents (tenant_id, codigo, titulo, tipo, severidad, area, responsable, estado) VALUES
  ('00000000-0000-0000-0000-000000000001','INC-2026-0001','Casi error de medicación detectado en doble chequeo','casi_accidente','Alta','Hospitalización','A. Vidal','reported'),
  ('00000000-0000-0000-0000-000000000001','INC-2026-0002','Carro de paro con insumo vencido','hallazgo','Alta','Urgencias','C. Rojas','investigating');

INSERT INTO checklist_templates (tenant_id, nombre, secciones) VALUES
  ('00000000-0000-0000-0000-000000000001','Ronda de seguridad del paciente',
   '[{"titulo":"General","items":[{"pregunta":"¿Identificación de pacientes con doble verificador?","tipo":"si_no","critico":true},{"pregunta":"¿Barandas de camas operativas?","tipo":"si_no","critico":true},{"pregunta":"¿Higiene de manos disponible en punto de atención?","tipo":"si_no","critico":false}]}]');
