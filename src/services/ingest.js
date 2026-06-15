import { q } from "../db.js";

/**
 * Analiza una muestra de filas (provenientes de un Excel/CSV ya parseado en
 * el navegador) y usa la IA para detectar qué tipo de información contiene
 * cada hoja/tabla y proponer opciones de uso dentro de MER.
 *
 * sheets: [{ nombre, columnas:[...], filas:[{...}, ...] (muestra de ~20) }]
 * Devuelve un plan: por cada hoja, el tipo detectado y un mapeo sugerido.
 */
export async function analizarArchivo(rubro, sheets) {
  const resumen = sheets.map(s => ({
    hoja: s.nombre,
    columnas: s.columnas,
    muestra: (s.filas || []).slice(0, 8),
  }));

  const system = `Eres un analista de datos de MER Analytics Intelligence (rubro: ${rubro}).
Recibes una o varias hojas de un Excel con columnas y una muestra de filas.
Tu tarea: detectar qué representa cada hoja y proponer cómo cargarla en la plataforma.

Categorías posibles (destino):
- "kpi": serie de indicadores en el tiempo (columnas de fecha/periodo + uno o más valores numéricos).
- "incidentes": eventos, accidentes, hallazgos, fallas, reclamos (suelen tener fecha, descripción, tipo o severidad).
- "inspecciones": checklists o auditorías realizadas (fecha, área, responsable, puntaje/resultado).
- "riesgos": peligros con probabilidad/consecuencia o nivel.
- "comercial": clientes, ventas, oportunidades, cotizaciones, montos.
- "tareas": actividades o planes con responsable y fecha de vencimiento.
- "generico": una tabla de datos que igual sirve para graficar/resumir, pero no encaja claro arriba.

Para cada hoja, mapea las columnas reales a los campos del destino. Si es kpi, identifica la columna de tiempo (campo "tiempo") y las columnas de métricas (campo "metricas": lista).

Responde ÚNICAMENTE con JSON válido, sin texto adicional, con esta forma:
{
 "hojas": [
   {
     "hoja": "<nombre>",
     "destino": "kpi|incidentes|inspecciones|riesgos|comercial|tareas|generico",
     "confianza": "alta|media|baja",
     "explicacion": "<1 frase de por qué>",
     "mapeo": { ... campos según destino ... },
     "vista_previa": "<1 frase de qué se creará, ej: '3 KPIs con 12 meses de datos'>"
   }
 ],
 "analisis_general": "<2-3 frases: qué trae este archivo y qué se puede hacer con él en MER>",
 "acciones_sugeridas": ["<acción 1>", "<acción 2>", "<acción 3>"]
}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: "Hojas del archivo:\n" + JSON.stringify(resumen) }],
    }),
  });
  if (!resp.ok) throw new Error("Fallo del servicio de IA: " + resp.status);
  const data = await resp.json();
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  // Extraer el JSON aunque venga con texto alrededor
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("La IA no devolvió un plan válido");
  return JSON.parse(m[0]);
}

/**
 * Importa realmente los datos según el plan confirmado por el usuario.
 * payload: { hoja, destino, mapeo, filas:[...todas...] }
 * Devuelve un resumen de lo creado.
 */
export async function importarHoja(tenantId, { destino, mapeo = {}, filas = [] }) {
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? null : n; };
  const txt = (v) => (v == null ? null : String(v));
  const creado = { destino, registros: 0, detalle: "" };

  if (destino === "kpi") {
    const colTiempo = mapeo.tiempo;
    const metricas = mapeo.metricas || [];
    let total = 0;
    for (const nombreMetrica of metricas) {
      const k = await q(
        "INSERT INTO kpis (tenant_id, nombre, unidad, direccion) VALUES ($1,$2,'','up') RETURNING id",
        [tenantId, nombreMetrica]);
      for (const fila of filas) {
        const valor = num(fila[nombreMetrica]);
        if (valor == null) continue;
        // intentar interpretar la fecha; si no, usar índice como periodo
        let ts = fila[colTiempo];
        const d = new Date(ts);
        ts = isNaN(d.getTime()) ? `2026-01-01` : d.toISOString().slice(0, 10);
        await q(
          `INSERT INTO kpi_values (tenant_id, kpi_id, ts, value) VALUES ($1,$2,$3,$4)
           ON CONFLICT (kpi_id, ts) DO UPDATE SET value = EXCLUDED.value`,
          [tenantId, k.rows[0].id, ts, valor]);
        total++;
      }
    }
    creado.registros = metricas.length;
    creado.detalle = `${metricas.length} KPI(s) con ${total} valores`;
  }

  else if (destino === "incidentes") {
    for (const f of filas) {
      await q(
        `INSERT INTO incidents (tenant_id, codigo, titulo, tipo, severidad, area, responsable, estado)
         VALUES ($1, next_code($1,'incidents','INC'), $2,$3,$4,$5,$6,'reported')`,
        [tenantId, txt(f[mapeo.titulo]) || "Sin título", txt(f[mapeo.tipo]) || "hallazgo",
         txt(f[mapeo.severidad]) || "Media", txt(f[mapeo.area]), txt(f[mapeo.responsable])]);
      creado.registros++;
    }
    creado.detalle = `${creado.registros} incidentes importados`;
  }

  else if (destino === "inspecciones") {
    for (const f of filas) {
      await q(
        `INSERT INTO inspections (tenant_id, codigo, plantilla, area, inspector, score, estado)
         VALUES ($1, next_code($1,'inspections','INS'), $2,$3,$4,$5,'completed')`,
        [tenantId, txt(f[mapeo.plantilla]) || "Inspección", txt(f[mapeo.area]),
         txt(f[mapeo.inspector]), num(f[mapeo.score])]);
      creado.registros++;
    }
    creado.detalle = `${creado.registros} inspecciones importadas`;
  }

  else if (destino === "riesgos") {
    for (const f of filas) {
      await q(
        `INSERT INTO risks (tenant_id, codigo, peligro, area, probabilidad, consecuencia, dueno)
         VALUES ($1, next_code($1,'risks','R'), $2,$3,$4,$5,$6)`,
        [tenantId, txt(f[mapeo.peligro]) || "Riesgo", txt(f[mapeo.area]),
         Math.min(5, Math.max(1, Math.round(num(f[mapeo.probabilidad]) || 3))),
         Math.min(5, Math.max(1, Math.round(num(f[mapeo.consecuencia]) || 3))),
         txt(f[mapeo.dueno])]);
      creado.registros++;
    }
    creado.detalle = `${creado.registros} riesgos importados`;
  }

  else if (destino === "comercial") {
    for (const f of filas) {
      await q(
        `INSERT INTO opportunities (tenant_id, codigo, cliente, titulo, monto, etapa, probabilidad)
         VALUES ($1, next_code($1,'opportunities','OP'), $2,$3,$4,'lead',$5)`,
        [tenantId, txt(f[mapeo.cliente]) || "Cliente", txt(f[mapeo.titulo]),
         num(f[mapeo.monto]) || 0, num(f[mapeo.probabilidad]) || 10]);
      creado.registros++;
    }
    creado.detalle = `${creado.registros} oportunidades importadas`;
  }

  else if (destino === "tareas") {
    for (const f of filas) {
      await q(
        `INSERT INTO action_plans (tenant_id, codigo, origen, titulo, responsable, estado)
         VALUES ($1, next_code($1,'action_plans','PA'), 'Importado', $2,$3,'open')`,
        [tenantId, txt(f[mapeo.titulo]) || "Tarea", txt(f[mapeo.responsable])]);
      creado.registros++;
    }
    creado.detalle = `${creado.registros} tareas importadas`;
  }

  else {
    // genérico: lo guardamos como KPIs de cualquier columna numérica
    const cols = filas.length ? Object.keys(filas[0]) : [];
    const numericas = cols.filter(c => filas.some(f => !isNaN(parseFloat(f[c]))));
    let total = 0;
    for (const c of numericas.slice(0, 6)) {
      const k = await q("INSERT INTO kpis (tenant_id, nombre, unidad, direccion) VALUES ($1,$2,'','up') RETURNING id", [tenantId, c]);
      filas.forEach((f, i) => {
        const v = num(f[c]); if (v == null) return;
        q("INSERT INTO kpi_values (tenant_id, kpi_id, ts, value) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [tenantId, k.rows[0].id, `2026-${String((i % 12) + 1).padStart(2, "0")}-01`, v]);
        total++;
      });
    }
    creado.registros = numericas.length;
    creado.detalle = `${numericas.length} indicadores detectados`;
  }

  return creado;
}
