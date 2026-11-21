import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { VerificacionCodigo } from '../lib/facturaRevisionPasos';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { Boton, Entrada, Texto } from './FacturaRevisionCabecera';

export interface CapturaCodigoNuevoProps {
  id: string;
  codigo: string | undefined;
  /** Catalog lookup of `codigo`, owned by the review (it also drives the line's readiness); undefined = not answered yet. */
  verificacion: VerificacionCodigo | undefined;
  estaVigente: () => boolean;
  onCapturar: (codigo: string | null) => { ok: boolean };
}

function verificationText(result: VerificacionCodigo): string {
  switch (result.tipo) {
    case 'colision': return `${(result.skus ?? []).join(', ')}: código encontrado en el catálogo; no se asignó ni se creó ningún producto.`;
    case 'cargando': return 'Verificando el código en el catálogo…';
    case 'incompleta': return 'Verificación incompleta: no se puede afirmar que el código sea único.';
    case 'sin_coincidencias': return 'Sin coincidencias en esta lectura. No asigna el código ni crea productos.';
  }
}

/** Captures a draft value only. A camera result never creates a product or assigns a catalog barcode. */
export default function FacturaCodigoBarrasNuevo(props: CapturaCodigoNuevoProps): React.JSX.Element {
  const { id, codigo, verificacion } = props;
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(true);
  const cameraGeneration = useRef(0);
  const cameraOpen = useRef(false);
  const [camera, setCamera] = useState<number | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cameraOpen.current = false;
      cameraGeneration.current += 1;
    };
  }, []);

  const estadoVerificacion: VerificacionCodigo = verificacion ?? { tipo: 'cargando' };

  function vigente(): boolean {
    return mounted.current && live.current.estaVigente();
  }

  function guardar(value: string | null): void {
    if (!vigente()) return;
    const result = live.current.onCapturar(value);
    setError(!result.ok);
    if (result.ok) setManual('');
  }

  function cerrar(generation: number): boolean {
    if (!vigente() || generation !== cameraGeneration.current || !cameraOpen.current) return false;
    cameraOpen.current = false;
    cameraGeneration.current += 1;
    setCamera(null);
    return true;
  }

  function abrir(): void {
    if (!vigente()) return;
    const generation = ++cameraGeneration.current;
    cameraOpen.current = true;
    setCamera(generation);
  }

  return (
    <View style={{ gap: 8 }}>
      <Texto small tone="muted">El código escaneado se usará en Código; el código de la factura, en Referencia.</Texto>
      <Texto small tone="muted">Para preparar el borrador de compra, el código nuevo admite hasta 80 caracteres (letras, números, . _ / -), sin recortar.</Texto>
      <Texto testID={`${id}-barras-escaneado`}>{codigo ?? 'Sin código capturado'}</Texto>
      <Boton testID={`${id}-barras-escanear`} label="Escanear código de barras" onPress={abrir} />
      <Entrada testID={`${id}-barras-manual`} label="Código de barras manual" value={manual} onChangeText={setManual} />
      <Boton testID={`${id}-barras-guardar`} label="Guardar código capturado" disabled={manual.length === 0} onPress={() => guardar(manual)} />
      <Boton testID={`${id}-barras-limpiar`} label="Quitar código capturado" disabled={codigo === undefined} onPress={() => guardar(null)} />
      {error ? <Texto testID={`${id}-barras-error`} tone="danger">Código no válido. Conserva los ceros iniciales y evita espacios al principio o al final.</Texto> : null}
      {codigo ? (
        <Texto testID={estadoVerificacion.tipo === 'colision' ? `${id}-barras-colision` : `${id}-barras-verificacion`} small tone="warning">
          {verificationText(estadoVerificacion)}
        </Texto>
      ) : null}
      {camera !== null ? <BarcodeScannerModal key={camera} visible onClose={() => { cerrar(camera); }} onScan={value => {
        if (cerrar(camera)) guardar(value);
      }} /> : null}
    </View>
  );
}
