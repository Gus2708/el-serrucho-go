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
async function sendExpoNotification(
  expoToken: string, title: string, body: string, url: string, channelId: string,
): Promise<{ ok: boolean; invalid?: boolean }> {
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
      channelId,
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

const MOTIVO_TXT: Record<string, string> = {
  dominio_no_autorizado: 'dirección de remitente falsa',
  dmarc_fallido: 'correo no verificado (falló autenticación)',
  header_from_no_alinea: 'correo no verificado (dominio no coincide)',
};

Deno.serve(async (req) => {
  try {
    if (req.headers.get('x-trigger-key') !== TRIGGER_KEY) {
      return new Response(JSON.stringify({ error: 'no autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const payload = await req.json().catch(() => ({}));
    let { title, body, url } = payload;
    const rec = payload.record;
    const table = payload.table;
    let channelId = 'default';
    let urgent = false;
    if (rec && rec.status && rec.status !== 'pendiente') {
      return new Response(JSON.stringify({ ok: true, skipped: 'no pendiente' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!title && rec && table === 'alertas_zelle_spoof') {
      title = '🚨 INTENTO DE ESTAFA DETECTADO';
      const motivoTxt = MOTIVO_TXT[rec.motivo] || 'remitente no verificado';
      body = `Correo falso imitando un pago Zelle desde "${rec.from_addr}" (${motivoTxt}). NO es un pago real — ignóralo y no hagas clic en nada.`;
      url = '/notificaciones';
      channelId = 'alerta-seguridad';
      urgent = true;
    }
    if (!title && rec && table === 'pagos_zelle') {
      const monto = rec.monto == null ? null : `$${Number(rec.monto).toFixed(2)}`;
      const enRevision = rec.estado === 'en_revision';
      if (enRevision) {
        title = '⏳ Zelle en revisión';
        body = monto
          ? `${monto} de ${rec.remitente || 'remitente desconocido'} — retenido por el banco`
          : (rec.asunto || 'Un pago Zelle quedó pendiente de revisión');
      } else {
        title = '💰 Zelle recibido';
        body = monto
          ? `${monto} — ${rec.remitente || 'remitente desconocido'}`
          : (rec.asunto || 'Nuevo pago Zelle (revisar correo)');
      }
      url = '/pagos';
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

    const { data: allSubs } = await supabase.from('push_subscriptions').select('id, subscription, empleado_id');
    let subs = allSubs || [];

    if (table === 'pagos_zelle' || table === 'alertas_zelle_spoof') {
      // Zelle (pagos + estafa) → a TODOS los empleados activos. Coincide con la
      // política de lectura (migración 031: is_active_employee abrió Zelle a
      // cualquier empleado). El privilegio de admin (lista completa vs. últimos 5
      // y conciliar) vive en app/pagos.tsx, NO en el push. El opt-out por usuario
      // se aplica más abajo.
      const { data: actives } = await supabase.from('profiles').select('id').eq('is_active', true);
      const allowed = new Set((actives || []).map((p) => p.id));
      subs = subs.filter((s) => s.empleado_id && allowed.has(s.empleado_id));
    }

    // Opt-out por usuario: cada empleado puede silenciar una categoría entera desde
    // el gestor de usuarios. Categorías: "zelle" (pagos + alertas de estafa) y "bots"
    // (atenciones + solicitudes). Semántica opt-out: solo un `false` explícito en
    // profiles.notif_prefs la desactiva; ausente = sigue recibiendo. Se aplica
    // DESPUÉS del filtro de empleados activos: solo puede reducir, nunca ampliar.
    let category: 'bots' | 'zelle' | null = null;
    if (table === 'pagos_zelle' || table === 'alertas_zelle_spoof') {
      category = 'zelle';
    } else if (rec) {
      category = 'bots';
    }

    if (category) {
      const empleadoIds = [...new Set(subs.map((s) => s.empleado_id).filter(Boolean))];
      if (empleadoIds.length > 0) {
        const { data: prefsRows } = await supabase
          .from('profiles')
          .select('id, notif_prefs')
          .in('id', empleadoIds);
        const silenced = new Set(
          (prefsRows || [])
            .filter((p) => p.notif_prefs?.[category!] === false)
            .map((p) => p.id),
        );
        subs = subs.filter((s) => !s.empleado_id || !silenced.has(s.empleado_id));
      }
    }

    const notifPayload = JSON.stringify({ title, body, url: url || '/', urgent });
    let sent = 0, removed = 0;

    for (const s of subs) {
      const sub = s.subscription;

      if (sub?.type === 'expo') {
        // Native Android via Expo Push API (relays to FCM).
        const result = await sendExpoNotification(sub.expo_token, title, body, url || '/', channelId).catch(() => ({ ok: false }));
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
