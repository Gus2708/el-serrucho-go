import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { FacturaRevisionRepository } from '../lib/facturaRevisionRepository';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { Boton, Entrada, Texto } from './FacturaRevisionCabecera';

export interface CapturaCodigoNuevoProps {
  id: string;
  codigo: string | undefined;
  estaVigente: () => boolean;
  onCapturar: (codigo: string | null) => { ok: boolean };
  leerColisiones: FacturaRevisionRepository['leerColisionesBarras'];
}

type Verificacion = { tipo: 'cargando' | 'incompleta' | 'sin_coincidencias' | 'colision'; skus?: string[] };

function verificationText(result: Verificacion): string {
  switch (result.tipo) {
    case 'colision': return `${(result.skus ?? []).join(', ')}: código encontrado en el catálogo; no se asignó ni se creó ningún producto.`;
    case 'cargando': return 'Verificando el código en el catálogo…';
    case 'incompleta': return 'Verificación incompleta: no se puede afirmar que el código sea único.';
    case 'sin_coincidencias': return 'Sin coincidencias en esta lectura. No asigna el código ni crea productos.';
  }
}

/** Captures a draft value only. A camera result never creates a product or assigns a catalog barcode. */
export default function FacturaCodigoBarrasNuevo(props: CapturaCodigoNuevoProps): React.JSX.Element {
  const { id, codigo } = props;
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(true);
  const cameraGeneration = useRef(0);
  const cameraOpen = useRef(false);
  const [camera, setCamera] = useState<number | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(false);
  const [verification, setVerification] = useState<Verificacion>({ tipo: 'incompleta' });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cameraOpen.current = false;
      cameraGeneration.current += 1;
    };
  }, []);

  function vigente(): boolean {
    return mounted.current && live.current.estaVigente();
  }

  useEffect(() => {
    let cancelled = false;
    if (!codigo) return;
    setVerification({ tipo: 'cargando' });
    function incomplete(): void {
      if (!cancelled && vigente()) setVerification({ tipo: 'incompleta' });
    }
    void Promise.resolve().then(() => live.current.leerColisiones([codigo])).then(result => {
      if (cancelled || !vigente()) return;
      const read = result[codigo];
      if (!read || !Array.isArray(read.productos) || read.productos.some(product =>
        !product || typeof product.codigoInterno !== 'string' || product.codigoInterno === '')) {
        incomplete();
        return;
      }
      const skus = read.productos.map(product => product.codigoInterno).filter(sku => typeof sku === 'string' && sku !== '');
      if (skus.length > 0) setVerification({ tipo: 'colision', skus });
      else setVerification({ tipo: read.completo === true ? 'sin_coincidencias' : 'incompleta' });
    }, incomplete);
    return () => { cancelled = true; };
  }, [codigo]);

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
    <View>
      <Texto small tone="muted">El código escaneado se usará en Código; el código de la factura, en Referencia.</Texto>
      <Texto testID={`${id}-barras-escaneado`}>{codigo ?? 'Sin código capturado'}</Texto>
      <Boton testID={`${id}-barras-escanear`} label="Escanear código de barras" onPress={abrir} />
      <Entrada testID={`${id}-barras-manual`} label="Código de barras manual" value={manual} onChangeText={setManual} />
      <Boton testID={`${id}-barras-guardar`} label="Guardar código capturado" disabled={manual.length === 0} onPress={() => guardar(manual)} />
      <Boton testID={`${id}-barras-limpiar`} label="Quitar código capturado" disabled={codigo === undefined} onPress={() => guardar(null)} />
      {error ? <Texto testID={`${id}-barras-error`} tone="danger">Código no válido. Conserva los ceros iniciales y evita espacios al principio o al final.</Texto> : null}
      {codigo ? (
        <Texto testID={verification.tipo === 'colision' ? `${id}-barras-colision` : `${id}-barras-verificacion`} small tone="warning">
          {verificationText(verification)}
        </Texto>
      ) : null}
      {camera !== null ? <BarcodeScannerModal key={camera} visible onClose={() => { cerrar(camera); }} onScan={value => {
        if (cerrar(camera)) guardar(value);
      }} /> : null}
    </View>
  );
}
