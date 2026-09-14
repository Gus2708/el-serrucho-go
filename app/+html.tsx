import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * This file is web-only and used to configure the root HTML for every
 * web page during static rendering.
 * The contents of this function only run in Node.js and only during
 * static rendering (expo export).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <title>El Serrucho GO</title>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1, user-scalable=0, viewport-fit=cover" />

        {/* PWA Primary Meta Tags */}
        <meta name="theme-color" content="#010100" />
        <meta name="description" content="Dashboard administrativo ferretería El Serrucho" />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        
        {/* Open Graph / social preview */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="El Serrucho GO" />
        <meta property="og:url" content="https://el-serrucho-go.vercel.app" />
        <meta property="og:title" content="El Serrucho GO - Real-Time Inventory &amp; Sales Analytics" />
        <meta property="og:description" content="Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta property="og:image" content="https://el-serrucho-go.vercel.app/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="El Serrucho GO - Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="El Serrucho GO - Real-Time Inventory &amp; Sales Analytics" />
        <meta name="twitter:description" content="Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta name="twitter:image" content="https://el-serrucho-go.vercel.app/og.png" />

        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Anti-cache for PWA updates */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />

        {/* iOS / Safari specific */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="Serrucho GO" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Serrucho GO" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: expoRootStyles }} />
        <script dangerouslySetInnerHTML={{ __html: visualViewportSync }} />
        <script dangerouslySetInnerHTML={{ __html: viewportDebugPanel }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const expoRootStyles = `
html {
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: #010100 !important;
  overflow: hidden !important;
}

body {
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: #010100 !important;
  overflow: hidden !important;
  -webkit-overflow-scrolling: touch !important;
}

#root {
  position: fixed !important;
  top: var(--app-vv-top, 0px) !important;
  left: 0 !important;
  right: 0 !important;
  bottom: auto !important;
  width: 100% !important;
  height: 100vh !important;
  height: var(--app-vh, 100dvh) !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  background-color: #010100 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

/* Los Modal de React Native se montan en un portal colgado de <body>, así que
   quedan fuera del marco mobile que la app fuerza en escritorio y se estiraban
   a todo el ancho de la pantalla. Mientras ese marco está activo, el overlay
   del modal se recorta al mismo ancho y se centra igual que el marco.
   La clase la pone app/_layout.tsx. Se engancha en aria-modal y no en
   role="dialog" porque React Native Web recién pone el role cuando termina la
   animación de apertura, y hasta entonces el modal se vería a pantalla completa. */
body.app-framed [aria-modal="true"] {
  max-width: var(--app-frame-width, 480px);
  margin-left: auto;
  margin-right: auto;
}

/* iOS Safari: con el teclado abierto solo se achica el visual viewport; lo
   fixed de borde a borde sigue midiendo la pantalla completa y Safari deja
   panear la diferencia. Se ata al visual viewport (ver visualViewportSync). */
[aria-modal="true"] {
  top: var(--app-vv-top, 0px) !important;
  bottom: auto !important;
  height: var(--app-vh, 100%) !important;
}

/* iOS standalone: fill entire screen including safe areas */
@supports (padding: env(safe-area-inset-top)) {
  #root {
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: 0;
    height: 100vh !important;
    height: var(--app-vh, 100dvh) !important;
  }
}
`;

const visualViewportSync = `
(function () {
  var vv = window.visualViewport;
  if (!vv || !(navigator.maxTouchPoints > 0)) return;
  var root = document.documentElement;
  function sync() {
    // Solo con teclado abierto: en la PWA instalada iOS puede reportar un
    // visualViewport mas alto que 100dvh y la barra inferior quedaba cortada.
    var keyboardOpen = root.clientHeight - vv.height > 120;
    if (keyboardOpen) {
      root.style.setProperty('--app-vh', vv.height + 'px');
      root.style.setProperty('--app-vv-top', vv.offsetTop + 'px');
    } else {
      root.style.removeProperty('--app-vh');
      root.style.removeProperty('--app-vv-top');
    }
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  }
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('scroll', sync, { passive: true });
  sync();
})();
`;

// Temporary viewport diagnostics for the iOS PWA. Toggle with a two-finger long press.
const viewportDebugPanel = `
(function () {
  var KEY = 'serrucho-viewport-debug';
  var panel = null;
  var pre = null;
  var interval = null;
  var pressTimer = null;

  function probe(css, read) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' + css;
    document.body.appendChild(el);
    var value = read(el);
    document.body.removeChild(el);
    return value;
  }

  function unitHeight(unit) {
    return probe('height:100' + unit, function (el) { return el.getBoundingClientRect().height.toFixed(1); });
  }

  function safeArea(side) {
    return probe('padding-top:env(safe-area-inset-' + side + ',0px)', function (el) { return getComputedStyle(el).paddingTop; });
  }

  function report() {
    var vv = window.visualViewport;
    var de = document.documentElement;
    var root = document.getElementById('root');
    var rr = root ? root.getBoundingClientRect() : null;
    var vars = getComputedStyle(de);
    return [
      'UA: ' + navigator.userAgent,
      'standalone: ' + (navigator.standalone === true) + ' | display-mode: ' + matchMedia('(display-mode: standalone)').matches,
      'screen: ' + screen.width + 'x' + screen.height + ' @' + window.devicePixelRatio,
      'innerHeight: ' + window.innerHeight + ' | outerHeight: ' + window.outerHeight + ' | clientHeight: ' + de.clientHeight,
      'visualViewport: ' + (vv ? vv.height.toFixed(1) + ' | offsetTop: ' + vv.offsetTop.toFixed(1) + ' | scale: ' + vv.scale : 'n/a'),
      '100vh: ' + unitHeight('vh') + ' | 100dvh: ' + unitHeight('dvh') + ' | 100svh: ' + unitHeight('svh') + ' | 100lvh: ' + unitHeight('lvh'),
      'safe-area top: ' + safeArea('top') + ' | bottom: ' + safeArea('bottom'),
      '#root: ' + (rr ? 'top ' + rr.top.toFixed(1) + ' | height ' + rr.height.toFixed(1) + ' | bottom ' + rr.bottom.toFixed(1) : 'n/a'),
      '--app-vh: ' + (vars.getPropertyValue('--app-vh').trim() || '-') + ' | --app-vv-top: ' + (vars.getPropertyValue('--app-vv-top').trim() || '-'),
      'scrollY: ' + window.scrollY
    ].join('\\n');
  }

  function button(label, onPress) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin-right:8px;padding:6px 12px;border:0;border-radius:8px;background:#F5B200;color:#0C0C0C;font:700 12px ui-monospace,Menlo,monospace';
    b.addEventListener('click', function () { onPress(b); });
    return b;
  }

  function show() {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:2147483647;background:rgba(0,0,0,0.92);color:#7CFC00;border:1px solid #F5B200;border-radius:10px;padding:10px;font:11px/1.4 ui-monospace,Menlo,monospace;-webkit-user-select:text;user-select:text';
    pre = document.createElement('pre');
    pre.style.cssText = 'margin:0 0 10px;white-space:pre-wrap;word-break:break-all';
    panel.appendChild(pre);
    panel.appendChild(button('Copiar', function (b) {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(report()).then(function () { b.textContent = 'Copiado'; });
    }));
    panel.appendChild(button('Cerrar', hide));
    document.body.appendChild(panel);
    pre.textContent = report();
    interval = setInterval(function () { pre.textContent = report(); }, 1000);
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function hide() {
    if (!panel) return;
    clearInterval(interval);
    panel.parentNode.removeChild(panel);
    panel = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  window.addEventListener('touchstart', function (e) {
    clearTimeout(pressTimer);
    if (e.touches.length !== 2) return;
    pressTimer = setTimeout(function () { panel ? hide() : show(); }, 1000);
  }, { passive: true, capture: true });
  window.addEventListener('touchend', function () { clearTimeout(pressTimer); }, { passive: true, capture: true });
  window.addEventListener('touchcancel', function () { clearTimeout(pressTimer); }, { passive: true, capture: true });

  var enabled = false;
  try { enabled = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (enabled) window.addEventListener('load', show);
})();
`;
