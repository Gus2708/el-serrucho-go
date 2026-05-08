import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SYSTEM_PROMPT = `
You are analyzing inventory data for a Venezuelan hardware store running the 
Hybrid POS system. Stock is synchronized from local .dat files via a Python 
file-watcher widget. Sync may lag by minutes. All prices are in USD.

For each product, determine if the current stock level is plausible given its 
30-day sales velocity. Flag cases that suggest:
- Sync failure (stock not updated after sales)
- Data entry error in Hybrid POS
- Theft or unexplained shrinkage  
- Dead stock (no movement in 90+ days but high stock count)

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{ "suspicious": boolean, "reason": string | null, "severity": "alta" | "media" | "baja" | null }
`.trim();

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Fetch products with their 30-day sales velocity
  const { data: products, error } = await supabase.rpc('get_products_for_anomaly_check');
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  const results = { checked: 0, flagged: 0, errors: 0 };

  for (const product of (products ?? [])) {
    try {
      const prompt = `
Product: ${product.codigo_interno} — ${product.descripcion}
Unit: ${product.unidad}
Current stock: ${product.existencia}
Cost: $${product.costo} | Sale price: $${product.precio_venta}
Units sold last 30 days: ${product.vendido_30d ?? 0}
Last updated: ${product.actualizado_en}
`.trim();

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 128 },
          }),
        }
      );

      const json = await res.json();
      const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

      results.checked++;

      if (parsed.suspicious && parsed.reason) {
        results.flagged++;
        await supabase.from('anomalias').upsert({
          codigo_producto: product.codigo_interno,
          tipo:            'stock_irreal',
          severidad:       parsed.severity ?? 'media',
          explicacion:     parsed.reason,
          detectado_en:    new Date().toISOString(),
          resuelto:        false,
        }, { onConflict: 'codigo_producto,tipo', ignoreDuplicates: false });
      }
    } catch {
      results.errors++;
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
});
