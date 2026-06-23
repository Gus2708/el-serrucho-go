import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// VAPID + secreto del trigger viven SOLO aquí (deploy directo a Supabase, no en repos públicos).
const VAPID_PUBLIC = 'BBEycqyi6qVCYlt8kLcOPE-QrYfcBu2iQmeIqTXUiw42Ua7FiCkqatCJehm8WSZ3IeEBBq_JSyHdUD2D34sl_Ig';
const VAPID_PRIVATE = 'VqY5Fm8yjDdcNmfHLw5uYAQ3WTTCcZ430JuUv-I8ScI';
const SUBJECT = 'mailto:notificaciones.elserrucho@gmail.com';
const TRIGGER_KEY = 'srx_push_b3f1a9c2e7d54486a0f2';

webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Send a push notification via Expo Push API (relays to FCM for Android native).
async function sendExpoNotification(expoToken: string, title: string, body: string, url: string): Promise<{ ok: boolean; invalid?: boolean }> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      to:       expoToken,
      title,
      body,
      data:     { url: url || '/' },
      sound:    'default',
      priority: 'high',
    }),
  });
  if (!res.ok) return { ok: false };
  const json = await res.json();
  const data = json?.data;
  // Expo returns an array of tickets, e.g. [{ status: 'error', details: { error: 'DeviceNotRegistered' } }]
  const ticket = Array.isArray(data) ? data[0] : data;
  if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
    return { ok: false, invalid: true };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get('x-trigger-key') !== TRIGGER_KEY) {
      return new Response(JSON.stringify({ error: 'no autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const payload = await req.json().catch(() => ({}));
    let { title, body, url } = payload;
    const rec = payload.record;
    const table = payload.table;
    if (rec && rec.status && rec.status !== 'pendiente') {
      return new Response(JSON.stringify({ ok: true, skipped: 'no pendiente' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!title && rec) {
      const tel = String(rec.telefono || '').replace('@c.us', '');
      if (table === 'solicitudes_ayuda') {
        title = '🙋 Solicitud de ayuda';
        body = (rec.nombre ? rec.nombre + ': ' : '') + (rec.consulta || 'El bot necesita ayuda');
        url = '/solicitudes';
      } else {
        title = '🔔 Cliente en espera';
        body = (rec.nombre || tel) + ' — ' + (rec.motivo || 'pide atención');
        url = '/notificaciones';
      }
    }
    if (!title) return new Response(JSON.stringify({ error: 'sin title ni record' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const { data: subs } = await supabase.from('push_subscriptions').select('id, subscription');
    const notifPayload = JSON.stringify({ title, body, url: url || '/' });
    let sent = 0, removed = 0;

    for (const s of (subs || [])) {
      const sub = s.subscription;

      if (sub?.type === 'expo') {
        // Native Android via Expo Push API (relays to FCM).
        const result = await sendExpoNotification(sub.expo_token, title, body, url || '/').catch(() => ({ ok: false }));
        if (result.ok) {
          sent++;
        } else if ((result as any).invalid) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
          removed++;
        }
      } else {
        // Web Push (VAPID).
        try {
          await webpush.sendNotification(sub, notifPayload);
          sent++;
        } catch (e) {
          const code = (e && (e as any).statusCode) || 0;
          if (code === 404 || code === 410) { await supabase.from('push_subscriptions').delete().eq('id', s.id); removed++; }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, removed }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
