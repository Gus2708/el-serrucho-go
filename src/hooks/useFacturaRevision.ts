import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createFacturaRevisionRepository,
  RevisionRepositoryError,
  type ExtraccionRow,
  type FacturaRevisionRepository,
  type RevisionRow,
} from '../lib/facturaRevisionRepository';
import { supabase } from '../lib/supabase';
import { parseFacturaExtraction, type FacturaExtraccionPayload } from '../lib/facturaExtractionContract';
import { matchInvoiceLines, type LineMatch } from '../lib/facturaMatching';
import { evaluarRepresentacionPos, type RepresentacionPos } from '../lib/compraRepresentacionPos';
import { fetchExistenciasEstrictas, type ExistenciasEstrictas } from '../lib/facturaExistencias';
import {
  aplicarEdicion,
  asociacionDesdeCandidato,
  calcularRevision,
  crearRevisionDesdeExtraccion,
  estadoRevision,
  evaluarCodigoBarras,
  resolverFactura,
  validarContenidoRevision,
  type AsociacionRevision,
  type CalculoRevision,
  type Edicion,
  type EstadoCodigoBarras,
  type FacturaEfectiva,
  type RevisionContenido,
} from '../lib/facturaRevision';

export const facturaRevisionRepository: FacturaRevisionRepository = createFacturaRevisionRepository(supabase);

export type EstadoVisible =
  | 'Sin revisión'
  | 'Con bloqueos'
  | 'Con cambios sin guardar'
  | 'Pendiente de aprobación'
  | 'Aprobación desactualizada'
  | 'Validada';

export type CargaRevision = 'cargando' | 'listo' | 'no_disponible' | 'error' | 'sin_sesion';

/** State of the Hybrid stock snapshot: `no_aplica` while there is nothing to read (blocked review, no confirmed SKU, no session). */
export type EstadoExistencias = 'no_aplica' | 'pendiente' | 'error' | 'listo';

export interface AvisoRevision {
  readonly tipo: 'ok' | 'warning' | 'error';
  readonly texto: string;
}

export interface UseFacturaRevisionParams {
  readonly repository: FacturaRevisionRepository;
  readonly facturaId: string;
  readonly ownerId: string;
  readonly facturaVersion: number;
  readonly documentoSha256: string | null;
  readonly editorDirty: boolean;
  readonly getSessionUid: () => string | null;
  readonly newId: () => string;
  /**
   * Existing auth signal for a session replacement that never reads as a null UID (sign-out then sign-in as the
   * same account). Returns the unsubscribe function. Defaults to the Supabase auth listener.
   */
  readonly suscribirCierreSesion?: (alCerrarSesion: () => void) => () => void;
  /** Reads Hybrid stock for the confirmed SKUs of an unblocked review. Defaults to the strict reader: a NULL or unreadable stock stays unknown, never zero. */
  readonly leerExistencias?: (codigos: string[]) => Promise<ExistenciasEstrictas>;
}

type AuthListener = (evento: string) => void;
type AuthApi = { onAuthStateChange?: (cb: AuthListener) => { data?: { subscription?: { unsubscribe?: () => void } } } };

/** Only SIGNED_OUT counts: token refreshes and focus re-emissions of SIGNED_IN must not reset the review. */
function suscribirCierreSesionPorDefecto(alCerrarSesion: () => void): () => void {
  try {
    const resultado = (supabase as unknown as { auth?: AuthApi }).auth?.onAuthStateChange?.(evento => {
      if (evento === 'SIGNED_OUT') alCerrarSesion();
    });
    return () => {
      try {
        resultado?.data?.subscription?.unsubscribe?.();
      } catch {
        // Nothing to release.
      }
    };
  } catch {
    return () => undefined;
  }
}

/** Evidence of a barcode check is only valid for exactly this code, SKU, extraction and lifecycle/session generation. */
function claveBarras(token: string, lineaId: string, codigo: string | null, asociado: string | null, extraccionId: string | null): string {
  return JSON.stringify([token, lineaId, codigo, asociado, extraccionId]);
}

const UNAVAILABLE = new RevisionRepositoryError('no_disponible').message;

const REPOSITORY_NOTICES: Partial<Record<string, string>> = {
  revision_obsoleta: 'Hay una revisión más reciente en el servidor. Tus cambios siguen aquí; recarga para ver la versión del servidor.',
  version_obsoleta: 'La factura cambió desde que se guardó esta revisión. Tus cambios siguen aquí; recarga para continuar.',
  clave_reutilizada: 'Esta operación ya se registró con otro contenido. Vuelve a guardar.',
  no_autorizado: 'No tienes permiso para esta operación. Inicia sesión de nuevo e inténtalo otra vez.',
  datos_invalidos: 'El servidor no aceptó el contenido. Revisa los campos marcados.',
  red: 'Sin conexión con el servidor. Tus cambios siguen en pantalla; vuelve a guardar para reintentar con la misma operación.',
};

function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canon(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseExtraction(row: ExtraccionRow | undefined): FacturaExtraccionPayload | null {
  if (!row || row.resultado === null) return null;
  const parsed = parseFacturaExtraction(row.resultado);
  return parsed.ok ? parsed.data : null;
}

/** numeroLinea -> lineaId already used for this extraction anywhere in the invoice history. */
function historicalIds(revisiones: readonly RevisionRow[], extraccionId: string): Map<number, string> {
  const ids = new Map<number, string>();
  for (const row of revisiones) {
    if (row.extraccionId !== extraccionId) continue;
    const lineas = (row.contenido as { lineas?: Array<{ lineaId?: unknown; origen?: { numeroLinea?: unknown } | null }> } | null)?.lineas ?? [];
    for (const linea of lineas) {
      const numero = linea.origen?.numeroLinea;
      if (typeof numero === 'number' && typeof linea.lineaId === 'string' && !ids.has(numero)) ids.set(numero, linea.lineaId);
    }
  }
  return ids;
}

/** Sorted, unique internal codes of the confirmed products. Independent of blockers so a transient one never changes the read key. */
function codigosConfirmados(calculo: CalculoRevision | null): string[] {
  if (!calculo) return [];
  const codigos = new Set<string>();
  for (const { decisionAsociacion } of calculo.lineas) {
    if (decisionAsociacion.tipo === 'confirmado' && decisionAsociacion.codigoInterno !== null) codigos.add(decisionAsociacion.codigoInterno);
  }
  return [...codigos].sort();
}

function isUsable(row: ExtraccionRow, documentoSha256: string | null): boolean {
  return row.estado === 'completado' && documentoSha256 !== null && row.documentoSha256 === documentoSha256 && parseExtraction(row) !== null;
}

interface Estado {
  carga: CargaRevision;
  revisiones: RevisionRow[];
  extracciones: ExtraccionRow[];
  contenido: RevisionContenido | null;
  extraccion: FacturaExtraccionPayload | null;
  ocupado: 'guardando' | 'aprobando' | 'extrayendo' | null;
  aviso: AvisoRevision | null;
  conflicto: boolean;
  motivoReemplazo: string | null;
  catalogoParcial: boolean | null;
  candidatos: Record<number, LineMatch>;
  /** Extraction the suggestions were computed for; they are only exposed while it is the current one. */
  candidatosDe: string | null;
  /** Barcode check results keyed by claveBarras(...), never by line alone. */
  estadosBarras: Record<string, EstadoCodigoBarras>;
}

const INICIAL: Estado = {
  carga: 'cargando',
  revisiones: [],
  extracciones: [],
  contenido: null,
  extraccion: null,
  ocupado: null,
  aviso: null,
  conflicto: false,
  motivoReemplazo: null,
  catalogoParcial: null,
  candidatos: {},
  candidatosDe: null,
  estadosBarras: {},
};

export function useFacturaRevision(params: UseFacturaRevisionParams) {
  const { facturaId, ownerId, facturaVersion, documentoSha256, editorDirty } = params;
  // Collaborators are read through a ref so a parent that recreates them each render never reloads the review.
  const live = useRef(params);
  live.current = params;
  const [estado, setEstado] = useState<Estado>(INICIAL);
  const [, setSesionTick] = useState(0);
  const fence = `${ownerId}|${facturaId}|${facturaVersion}|${documentoSha256 ?? ''}`;
  // Monotonic generations: `vida` moves on every identity change (A/B/A included) and on unmount; `sesion` moves on
  // every observed session transition (including null -> same UID) and on a sign-out signal. A result is admitted
  // only if it was requested under the CURRENT pair, never because the values happen to be equal again.
  const generacion = useRef({ vida: 0, sesion: 0 });
  const fenceVista = useRef<string | null>(null);
  const uidVisto = useRef<string | null | undefined>(undefined);
  if (fenceVista.current !== fence) {
    fenceVista.current = fence;
    generacion.current.vida += 1;
  }
  const uidAhora = params.getSessionUid();
  if (uidVisto.current !== uidAhora) {
    if (uidVisto.current !== undefined) generacion.current.sesion += 1;
    uidVisto.current = uidAhora;
  }
  const tokenActual = useCallback((): string => `${generacion.current.vida}.${generacion.current.sesion}`, []);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const pendienteRef = useRef<{ firma: string; clave: string } | null>(null);
  const barrasPedidas = useRef(new Set<string>());
  const catalogoPara = useRef<string | null>(null);
  const peticionCatalogo = useRef(0);

  const vigente = useCallback((token: string): boolean => token === tokenActual() && live.current.getSessionUid() === ownerId, [ownerId, tokenActual]);
  const patch = useCallback((cambio: Partial<Estado> | ((actual: Estado) => Partial<Estado>)) => {
    setEstado(actual => ({ ...actual, ...(typeof cambio === 'function' ? cambio(actual) : cambio) }));
  }, []);

  const ultimaFila = estado.revisiones.length > 0 ? estado.revisiones[estado.revisiones.length - 1] : null;

  const cargar = useCallback(async (conservarEdicion: boolean): Promise<void> => {
    const token = tokenActual();
    if (live.current.getSessionUid() !== ownerId) {
      setEstado({ ...INICIAL, carga: 'sin_sesion' });
      return;
    }
    try {
      const [revisiones, extracciones] = await Promise.all([live.current.repository.leerRevisiones(facturaId), live.current.repository.leerExtracciones(facturaId)]);
      if (!vigente(token)) return;
      const ultima = revisiones.length > 0 ? revisiones[revisiones.length - 1] : null;
      let contenido: RevisionContenido | null = null;
      let extraccion: FacturaExtraccionPayload | null = null;
      if (ultima) {
        extraccion = ultima.extraccionId ? parseExtraction(extracciones.find(row => row.id === ultima.extraccionId)) : null;
        if (ultima.extraccionId && !extraccion) throw new RevisionRepositoryError('desconocido');
        const validado = validarContenidoRevision(ultima.contenido, extraccion);
        if (!validado.ok) throw new RevisionRepositoryError('desconocido');
        contenido = validado.contenido;
      }
      setEstado(actual => ({
        ...INICIAL,
        carga: 'listo',
        revisiones,
        extracciones,
        contenido: conservarEdicion && actual.contenido ? actual.contenido : contenido,
        extraccion: conservarEdicion && actual.contenido ? actual.extraccion : extraccion,
        conflicto: conservarEdicion ? actual.conflicto : false,
        aviso: conservarEdicion ? actual.aviso : null,
        motivoReemplazo: conservarEdicion ? actual.motivoReemplazo : null,
        candidatos: actual.candidatos,
        candidatosDe: actual.candidatosDe,
        catalogoParcial: actual.catalogoParcial,
        estadosBarras: actual.estadosBarras,
      }));
    } catch (error) {
      if (!vigente(token)) return;
      const code = error instanceof RevisionRepositoryError ? error.code : 'desconocido';
      setEstado({ ...INICIAL, carga: code === 'no_disponible' ? 'no_disponible' : 'error' });
    }
  }, [facturaId, ownerId, vigente, tokenActual]);

  useEffect(() => {
    pendienteRef.current = null;
    barrasPedidas.current = new Set();
    catalogoPara.current = null;
    setEstado(INICIAL);
    void cargar(false);
  }, [fence, cargar]);

  // Leaving the screen invalidates every in-flight result.
  useEffect(
    () => () => {
      generacion.current.vida += 1;
    },
    []
  );

  useEffect(() => {
    const suscribir = live.current.suscribirCierreSesion ?? suscribirCierreSesionPorDefecto;
    return suscribir(() => {
      generacion.current.sesion += 1;
      setSesionTick(n => n + 1);
    });
  }, []);

  // A session transition releases the busy state, drops in-flight work (their token no longer matches) and,
  // if the same account is signed in again, rereads the server while keeping the unsaved review edits.
  const sesionGen = generacion.current.sesion;
  const vidaVista = useRef(generacion.current.vida);
  const sesionPrimera = useRef(true);
  useEffect(() => {
    if (sesionPrimera.current) {
      sesionPrimera.current = false;
      return;
    }
    if (vidaVista.current !== generacion.current.vida) {
      vidaVista.current = generacion.current.vida;
      return;
    }
    barrasPedidas.current = new Set();
    catalogoPara.current = null;
    if (live.current.getSessionUid() !== ownerId) {
      patch({ ocupado: null, carga: 'sin_sesion' });
      return;
    }
    patch({ ocupado: null });
    void cargar(true);
  }, [sesionGen, ownerId, cargar, patch]);

  // Bounded catalog subset for suggestions, once per extraction in view.
  useEffect(() => {
    const extraccion = estado.extraccion;
    const extraccionId = estado.contenido?.extraccion_id ?? null;
    if (!extraccion || !extraccionId || estado.carga !== 'listo' || catalogoPara.current === extraccionId) return;
    catalogoPara.current = extraccionId;
    const token = tokenActual();
    const peticion = ++peticionCatalogo.current;
    const actual = () => peticion === peticionCatalogo.current && vigente(token);
    void live.current.repository.buscarCandidatos(extraccion.lineas).then(
      ({ productos, parcial }) => {
        if (!actual()) return;
        const resultado = matchInvoiceLines({ supplierKey: null, lines: extraccion.lineas, catalog: productos });
        const candidatos: Record<number, LineMatch> = {};
        if (resultado.ok) for (const match of resultado.lines) candidatos[match.numeroLinea] = match;
        patch({ candidatos, candidatosDe: extraccionId, catalogoParcial: parcial || !resultado.ok });
      },
      () => {
        if (actual()) patch({ candidatos: {}, candidatosDe: extraccionId, catalogoParcial: true });
      }
    );
  }, [estado.extraccion, estado.contenido?.extraccion_id, estado.carga, vigente, tokenActual, patch]);

  // Exact barcode checks run only for lines whose user explicitly chose to use the printed code.
  const efectiva: FacturaEfectiva | null = useMemo(
    () => (estado.contenido ? resolverFactura(estado.extraccion, estado.contenido) : null),
    [estado.contenido, estado.extraccion]
  );
  useEffect(() => {
    if (!efectiva || estado.carga !== 'listo') return;
    const token = tokenActual();
    const extraccionId = estado.contenido?.extraccion_id ?? null;
    for (const linea of efectiva.lineas) {
      const codigo = linea.campos.codigoProveedor.valor;
      if (!linea.usarCodigoFactura || linea.asociacion.tipo === 'pendiente') continue;
      const asociado = linea.asociacion.codigoInterno;
      const clave = claveBarras(token, linea.lineaId, codigo, asociado, extraccionId);
      if (barrasPedidas.current.has(clave)) continue;
      barrasPedidas.current.add(clave);
      if (!codigo) {
        patch(actual => ({ estadosBarras: { ...actual.estadosBarras, [clave]: 'sin_codigo' } }));
        continue;
      }
      void live.current.repository.leerColisionesBarras([codigo]).then(
        lectura => {
          if (!vigente(token)) return;
          const resultado = evaluarCodigoBarras({ codigoFactura: codigo, codigoInternoAsociado: asociado, catalogo: lectura[codigo] ?? { productos: [], completo: false } });
          patch(actual => ({ estadosBarras: { ...actual.estadosBarras, [clave]: resultado } }));
        },
        () => {
          if (vigente(token)) patch(actual => ({ estadosBarras: { ...actual.estadosBarras, [clave]: 'no_verificable' } }));
        }
      );
    }
  }, [efectiva, estado.carga, estado.contenido?.extraccion_id, sesionGen, vigente, tokenActual, patch]);

  // Only evidence for the CURRENT code, SKU, extraction and generation is admitted; anything else counts as unknown.
  const estadosBarrasVigentes = useMemo(() => {
    const vigentes: Record<string, EstadoCodigoBarras> = {};
    if (!efectiva) return vigentes;
    const token = tokenActual();
    const extraccionId = estado.contenido?.extraccion_id ?? null;
    for (const linea of efectiva.lineas) {
      if (!linea.usarCodigoFactura || linea.asociacion.tipo === 'pendiente') continue;
      const prueba = estado.estadosBarras[claveBarras(token, linea.lineaId, linea.campos.codigoProveedor.valor, linea.asociacion.codigoInterno, extraccionId)];
      if (prueba) vigentes[linea.lineaId] = prueba;
    }
    return vigentes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efectiva, estado.estadosBarras, estado.contenido?.extraccion_id, sesionGen, generacion.current.vida, tokenActual]);

  const calculo: CalculoRevision | null = useMemo(() => {
    if (!estado.contenido) return null;
    return calcularRevision({ extraccion: estado.extraccion, contenido: estado.contenido, estadosCodigoBarras: estadosBarrasVigentes });
  }, [estado.contenido, estado.extraccion, estadosBarrasVigentes]);

  const contenidoGuardado = useMemo(() => (ultimaFila ? canon(ultimaFila.contenido) : null), [ultimaFila]);
  const sucio = estado.contenido !== null && canon(estado.contenido) !== contenidoGuardado;

  const identidadVigente = ultimaFila !== null && ultimaFila.facturaVersion === facturaVersion && ultimaFila.documentoSha256 === documentoSha256;
  const estadoVisible: EstadoVisible = (() => {
    if (!estado.contenido || !calculo) return 'Sin revisión';
    const aprobada = ultimaFila !== null && ultimaFila.aprobadoEn !== null;
    const resultado = estadoRevision({
      calculo,
      ultima: { fingerprint: sucio ? 'sin-guardar' : ultimaFila?.fingerprint ?? 'sin-guardar', facturaVersion, documentoSha256 },
      atestacion: aprobada && ultimaFila ? { fingerprint: ultimaFila.fingerprint, facturaVersion: ultimaFila.facturaVersion, documentoSha256: ultimaFila.documentoSha256 } : null,
    });
    if (resultado === 'atestacion_obsoleta') return 'Aprobación desactualizada';
    if (resultado === 'con_bloqueos') return 'Con bloqueos';
    if (sucio || !identidadVigente) return 'Con cambios sin guardar';
    return resultado === 'validada' ? 'Validada' : 'Pendiente de aprobación';
  })();

  const sesionOk = params.getSessionUid() === ownerId;

  // Read-only Hybrid stock snapshot for the confirmed SKUs, read only while the review has no blockers. The key carries
  // the account, invoice, session generation and SKU set (never the blocker state), so a snapshot is not inherited from
  // another invoice or a previous session of the same account and typing never re-reads; a result requested under an
  // older generation lands under its own key and is never shown. A failed or pending read stays unknown (never zero)
  // and nothing retries or reloads on its own.
  const codigosStock = codigosConfirmados(calculo);
  const leerStock = sesionOk && calculo?.sinBloqueos === true && codigosStock.length > 0;
  const lecturaExistencias = useQuery({
    queryKey: ['factura-revision-existencias', ownerId, facturaId, sesionGen, codigosStock],
    queryFn: () => (live.current.leerExistencias ?? fetchExistenciasEstrictas)(codigosStock),
    enabled: leerStock,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const estadoExistencias: EstadoExistencias = !leerStock ? 'no_aplica' : lecturaExistencias.isSuccess ? 'listo' : lecturaExistencias.isError ? 'error' : 'pendiente';
  // The observed time of the query result, never the evaluation time.
  const lecturaExistenciasEn = estadoExistencias === 'listo' && lecturaExistencias.dataUpdatedAt > 0 ? new Date(lecturaExistencias.dataUpdatedAt).toISOString() : null;
  const existenciasLeidas = estadoExistencias === 'listo' ? lecturaExistencias.data : undefined;
  const representacionPos: RepresentacionPos | null = useMemo(
    () => (calculo && efectiva && sesionOk && estado.carga === 'listo' ? evaluarRepresentacionPos({ calculo, efectiva, existencias: existenciasLeidas ?? {}, lecturaExistenciasEn }) : null),
    [calculo, efectiva, sesionOk, estado.carga, existenciasLeidas, lecturaExistenciasEn]
  );

  const puedeExtraer = sesionOk && documentoSha256 !== null && facturaVersion >= 1 && !editorDirty && estado.ocupado === null && (estado.carga === 'listo' || estado.carga === 'error');
  const razonNoExtraer: string | null = !sesionOk
    ? 'Inicia sesión con la cuenta de esta factura.'
    : documentoSha256 === null
      ? 'Adjunta y guarda un documento para extraer datos.'
      : facturaVersion < 1
        ? 'Guarda la factura antes de extraer datos.'
        : editorDirty
          ? 'Guarda los cambios de la factura antes de extraer datos.'
          : null;
  const puedeGuardar = sesionOk && sucio && estado.ocupado === null && !estado.conflicto && estado.carga === 'listo';
  const puedeAprobar = sesionOk && !sucio && !editorDirty && identidadVigente && ultimaFila !== null && ultimaFila.aprobadoEn === null && calculo?.sinBloqueos === true && estado.ocupado === null && !estado.conflicto;

  // ── Actions ───────────────────────────────────────────────────────────────

  const editar = useCallback((edicion: Edicion): { ok: boolean } => {
    const actual = estadoRef.current;
    if (!actual.contenido) return { ok: false };
    const resultado = aplicarEdicion(actual.contenido, actual.extraccion, edicion, () => live.current.newId());
    if (!resultado.ok) {
      patch({ aviso: { tipo: 'error', texto: 'Esa edición no es válida: revisa el valor y el motivo.' } });
      return { ok: false };
    }
    if (resultado.cambio) patch({ contenido: resultado.contenido, aviso: null });
    return { ok: true };
  }, [patch]);

  const elegirCandidato = useCallback((numeroLinea: number, lineaId: string, codigoInterno: string): void => {
    const actual = estadoRef.current;
    const match = actual.candidatosDe === actual.contenido?.extraccion_id ? actual.candidatos[numeroLinea] : undefined;
    const asociacion: AsociacionRevision | null = match ? asociacionDesdeCandidato(match, codigoInterno, null) : null;
    if (asociacion) editar({ tipo: 'asociacion', lineaId, asociacion });
  }, [editar]);

  const aplicarExtraccion = useCallback((extraccionId: string, motivo: string | null): { ok: boolean } => {
    const actual = estadoRef.current;
    const fila = actual.extracciones.find(row => row.id === extraccionId);
    const payload = fila ? parseExtraction(fila) : null;
    if (!fila || !payload || !isUsable(fila, documentoSha256)) return { ok: false };
    const reemplaza = actual.contenido !== null;
    const razon = motivo !== null && motivo.trim() !== '' ? motivo.trim() : null;
    if (reemplaza && razon === null) return { ok: false };
    const historia = historicalIds(actual.revisiones, extraccionId);
    const creada = crearRevisionDesdeExtraccion(payload, extraccionId, numeroLinea => (numeroLinea !== null && historia.get(numeroLinea)) || live.current.newId());
    if (!creada.ok) return { ok: false };
    catalogoPara.current = null;
    barrasPedidas.current = new Set();
    peticionCatalogo.current += 1;
    patch({ contenido: creada.contenido, extraccion: payload, motivoReemplazo: razon, candidatos: {}, candidatosDe: null, catalogoParcial: null, estadosBarras: {}, aviso: null });
    return { ok: true };
  }, [documentoSha256, patch]);

  const guardar = useCallback(async (motivoTexto: string): Promise<boolean> => {
    const actual = estadoRef.current;
    const token = tokenActual();
    if (!actual.contenido || actual.ocupado || actual.conflicto || canon(actual.contenido) === (actual.revisiones.length ? canon(actual.revisiones[actual.revisiones.length - 1].contenido) : null)) return false;
    if (!vigente(token)) return false;
    const base = actual.revisiones.length > 0 ? actual.revisiones[actual.revisiones.length - 1] : null;
    const motivo = motivoTexto.trim() !== '' ? motivoTexto.trim() : actual.motivoReemplazo;
    const contenido = actual.contenido;
    const firma = canon({ rev: base?.revision ?? 0, fv: facturaVersion, ext: contenido.extraccion_id, contenido, motivo });
    const clave = pendienteRef.current?.firma === firma ? pendienteRef.current.clave : live.current.newId();
    pendienteRef.current = { firma, clave };
    patch({ ocupado: 'guardando', aviso: null });
    try {
      const resultado = await live.current.repository.guardarRevision({
        facturaId,
        revisionEsperada: base?.revision ?? 0,
        clave,
        facturaVersion,
        extraccionId: contenido.extraccion_id,
        contenido,
        motivo,
      });
      if (!vigente(token)) return false;
      pendienteRef.current = null;
      const fila: RevisionRow = {
        revision: resultado.revision,
        clave,
        facturaVersion,
        extraccionId: contenido.extraccion_id,
        documentoSha256,
        contenido,
        fingerprint: resultado.fingerprint,
        motivo,
        creadoPor: ownerId,
        aprobadoPor: null,
        aprobadoEn: null,
      };
      patch(anterior => ({
        ocupado: null,
        motivoReemplazo: null,
        revisiones: [...anterior.revisiones.filter(row => row.revision !== fila.revision), fila],
        aviso: { tipo: 'ok', texto: resultado.replay ? 'Ya estaba guardada en el servidor.' : 'Revisión guardada en el servidor.' },
      }));
      return true;
    } catch (error) {
      if (!vigente(token)) return false;
      const code = error instanceof RevisionRepositoryError ? error.code : 'desconocido';
      const conflicto = code === 'revision_obsoleta' || code === 'version_obsoleta';
      if (code !== 'red' && code !== 'desconocido') pendienteRef.current = null;
      patch({
        ocupado: null,
        conflicto,
        aviso: { tipo: conflicto ? 'warning' : 'error', texto: REPOSITORY_NOTICES[code] ?? 'No se pudo guardar la revisión. Inténtalo otra vez.' },
      });
      return false;
    }
  }, [documentoSha256, facturaId, facturaVersion, ownerId, patch, vigente]);

  const aprobar = useCallback(async (): Promise<void> => {
    const actual = estadoRef.current;
    const token = tokenActual();
    const fila = actual.revisiones.length > 0 ? actual.revisiones[actual.revisiones.length - 1] : null;
    if (!fila || actual.ocupado || !vigente(token)) return;
    patch({ ocupado: 'aprobando', aviso: null });
    try {
      await live.current.repository.aprobarRevision({ facturaId, revision: fila.revision, fingerprint: fila.fingerprint, facturaVersion });
      if (!vigente(token)) return;
      patch(anterior => ({
        ocupado: null,
        revisiones: anterior.revisiones.map(row => (row.revision === fila.revision ? { ...row, aprobadoPor: ownerId, aprobadoEn: new Date().toISOString() } : row)),
        aviso: { tipo: 'ok', texto: 'Revisión humana registrada.' },
      }));
    } catch (error) {
      if (!vigente(token)) return;
      const code = error instanceof RevisionRepositoryError ? error.code : 'desconocido';
      const conflicto = code === 'revision_obsoleta' || code === 'version_obsoleta';
      patch({ ocupado: null, conflicto, aviso: { tipo: conflicto ? 'warning' : 'error', texto: REPOSITORY_NOTICES[code] ?? 'No se pudo registrar la aprobación.' } });
    }
  }, [facturaId, facturaVersion, ownerId, patch, vigente]);

  const extraer = useCallback(async (): Promise<void> => {
    const token = tokenActual();
    if (!vigente(token) || estadoRef.current.ocupado) return;
    patch({ ocupado: 'extrayendo', aviso: null });
    let aviso: AvisoRevision;
    try {
      const resultado = await live.current.repository.extraer({ facturaId, solicitudId: live.current.newId(), versionEsperada: facturaVersion });
      switch (resultado.tipo) {
        case 'completado':
          aviso = { tipo: 'ok', texto: 'Extracción terminada. Revisa los datos antes de usarlos.' };
          break;
        case 'cuarentena':
          aviso = { tipo: 'warning', texto: 'La factura cambió durante la extracción; el resultado quedó retenido y no se usa.' };
          break;
        case 'en_curso':
          aviso = { tipo: 'warning', texto: 'Ya hay una extracción en curso para esta factura. Se volvió a leer su estado; no se repite sola.' };
          break;
        case 'incierto':
          aviso = { tipo: 'warning', texto: 'No se pudo confirmar el resultado. Se volvió a leer el estado; no se repite sola.' };
          break;
        case 'no_disponible':
          aviso = { tipo: 'warning', texto: UNAVAILABLE };
          break;
        default:
          aviso = { tipo: 'error', texto: resultado.codigo === 'no_autorizado' || resultado.codigo === 'unauthorized' ? 'No tienes permiso para extraer esta factura.' : 'El servidor rechazó la extracción.' };
      }
    } catch {
      aviso = { tipo: 'warning', texto: 'No se pudo confirmar el resultado. Se volvió a leer el estado; no se repite sola.' };
    }
    if (!vigente(token)) return;
    try {
      const extracciones = await live.current.repository.leerExtracciones(facturaId);
      if (!vigente(token)) return;
      patch({ ocupado: null, extracciones, aviso });
    } catch {
      if (vigente(token)) patch({ ocupado: null, aviso });
    }
  }, [facturaId, facturaVersion, patch, vigente]);

  const recargar = useCallback(async (): Promise<void> => {
    await cargar(false);
  }, [cargar]);

  const suggestionsCurrent = estado.candidatosDe !== null && estado.candidatosDe === (estado.contenido?.extraccion_id ?? null);
  const extraccionesUsables = useMemo(() => estado.extracciones.filter(row => isUsable(row, documentoSha256)), [estado.extracciones, documentoSha256]);

  return {
    carga: estado.carga,
    aviso: estado.aviso,
    ocupado: estado.ocupado,
    conflicto: estado.conflicto,
    contenido: estado.contenido,
    extraccion: estado.extraccion,
    efectiva,
    calculo,
    representacionPos,
    estadoExistencias,
    estadoVisible,
    sucio,
    ultimaFila,
    extracciones: estado.extracciones,
    extraccionesUsables,
    candidatos: suggestionsCurrent ? estado.candidatos : {},
    catalogoParcial: suggestionsCurrent ? estado.catalogoParcial : null,
    estadosBarras: estadosBarrasVigentes,
    puedeExtraer,
    razonNoExtraer,
    puedeGuardar,
    puedeAprobar,
    editar,
    elegirCandidato,
    aplicarExtraccion,
    guardar,
    aprobar,
    extraer,
    recargar,
  };
}

export type FacturaRevisionControl = ReturnType<typeof useFacturaRevision>;
