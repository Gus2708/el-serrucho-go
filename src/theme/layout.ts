/**
 * Ancho del marco mobile que la app fuerza en escritorio (modo demo y login).
 * Lo comparten el contenedor de app/_layout.tsx, useDeviceSize y la regla CSS
 * que recorta los portales de Modal en app/+html.tsx.
 */
export const MOBILE_FRAME_WIDTH = 480;

/**
 * Clase que se pone en <body> mientras el marco mobile está activo. La usa
 * app/+html.tsx para recortar los Modal, que se montan fuera del marco.
 */
export const FRAMED_BODY_CLASS = 'app-framed';

/** Custom property que expone el ancho del marco al CSS. */
export const FRAME_WIDTH_CSS_VAR = '--app-frame-width';
