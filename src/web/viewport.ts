export const rootStyles = `
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

/* Con el teclado abierto la app mide solo lo visible: las barras flotantes
   (pestañas, "Emitir compra") taparían el poco espacio que queda para el form. */
html.keyboard-open [data-hide-on-keyboard] {
  display: none !important;
}

/* El margen del indicador de inicio queda debajo del teclado: sin esto se ve
   como una franja negra entre el formulario y el teclado. */
html.keyboard-open [data-no-bottom-inset-on-keyboard] {
  padding-bottom: 0 !important;
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

export const visualViewportSync = `
(function () {
  var vv = window.visualViewport;
  if (!vv || !(navigator.maxTouchPoints > 0)) return;
  var root = document.documentElement;
  // Al achicar la app ya no hay pan de Safari que muestre el input: se lleva
  // a la vista dentro de su ScrollView. Diferido para medir el layout nuevo.
  function reveal(el) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    setTimeout(function () {
      if (document.activeElement === el) el.scrollIntoView({ block: 'center' });
    }, 0);
  }
  function sync() {
    // Solo con teclado abierto: sin teclado mandan los fallbacks de CSS (100dvh).
    var keyboardOpen = root.clientHeight - vv.height > 120;
    if (keyboardOpen) {
      root.style.setProperty('--app-vh', vv.height + 'px');
      root.style.setProperty('--app-vv-top', vv.offsetTop + 'px');
      root.classList.add('keyboard-open');
      reveal(document.activeElement);
    } else {
      root.style.removeProperty('--app-vh');
      root.style.removeProperty('--app-vv-top');
      root.classList.remove('keyboard-open');
    }
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  }
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('scroll', sync, { passive: true });
  document.addEventListener('focusin', function (e) {
    if (root.classList.contains('keyboard-open')) reveal(e.target);
  });
  sync();
})();
`;

// Temporary viewport diagnostics for the iOS PWA. Toggle with a two-finger long press.
export const viewportDebugPanel = `
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
