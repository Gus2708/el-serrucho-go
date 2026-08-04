import { useMutation, UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { withSupabaseRetry } from '../lib/retry';

// Escritura de crédito (fiado): todo pasa por RPC (creditos_*), nunca por
// INSERT/UPDATE directo — las tablas base no tienen policies de escritura.
// Es dinero, así que NO hay optimistic updates: se espera la confirmación del
// servidor y se invalida ['creditos'] completo. Simple y sin riesgo de que la
// UI quede desincronizada con el saldo real. Ver migración 041.

export interface CrearCuentaInput {
  nombre:          string;
  cliente_codigo?: string | null;
  documento_id?:   string | null;
  telefono?:       string | null;
  nota?:           string | null;
}

/** Como CrearCuentaInput pero sin `nota`: resolver no edita una cuenta que ya exista. */
export interface ResolverCuentaInput {
  nombre:          string;
  cliente_codigo?: string | null;
  documento_id?:   string | null;
  telefono?:       string | null;
}

export interface RegistrarCargoInput {
  cuenta_id:        number;
  monto_usd:        number;
  concepto:         string;
  origen:           'factura' | 'libre';
  venta_documento?: string | null;
  fecha?:           string | null;
}

export interface RegistrarAbonoInput {
  cuenta_id:   number;
  monto_usd:   number;
  concepto?:   string | null;
  metodo?:     string | null;
  referencia?: string | null;
  fecha?:      string | null;
}

export interface AnularMovimientoInput {
  movimiento_id: number;
  motivo:        string;
  cuenta_id:     number;
}

export interface CorregirMovimientoInput {
  movimiento_id: number;
  monto_usd:     number;
  concepto?:     string | null;
  fecha?:        string | null;
  metodo?:       string | null;
  referencia?:   string | null;
  motivo?:       string;
  cuenta_id:     number;
}

export interface ActualizarCuentaInput {
  cuenta_id:      number;
  nombre:         string;
  documento_id?:  string | null;
  telefono?:      string | null;
  nota?:          string | null;
}

/** Convierte errores de Postgres/PostgREST en un mensaje de mostrador. */
function traducirError(error: { code?: string; message?: string }): string {
  // Los RPC de crédito ya devuelven mensajes en español legibles para el
  // usuario (ej. "La factura X ya está cargada..."); solo se traducen los
  // códigos crudos que llegan sin pasar por esa capa.
  if (error.code === '23505') return 'Eso ya está registrado.';
  if (error.code === '42501' || error.message?.includes('insufficient_privilege')) {
    return 'No tienes permiso para hacer esto.';
  }
  if (error.message) return error.message;
  return 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.';
}

function invalidateCreditos(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['creditos'] });
}

export function useCrearCuenta(): UseMutationResult<number, Error, CrearCuentaInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrearCuentaInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_crear_cuenta', {
          p_nombre:         input.nombre,
          p_cliente_codigo: input.cliente_codigo ?? null,
          p_documento_id:   input.documento_id ?? null,
          p_telefono:       input.telefono ?? null,
          p_nota:           input.nota ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

/**
 * Devuelve el id de la cuenta activa con ese nombre, creándola si no existe.
 *
 * Es find-or-create ATÓMICO en el servidor (RPC `creditos_resolver_cuenta`,
 * migr. 043): si dos cajeros anotan facturas a la misma persona nueva a la vez,
 * uno inserta y el otro recibe el id del ganador. Resolver esto en el cliente
 * exigía tres viajes a la red y dejaba la carrera en manos del dispositivo.
 */
export function useResolverCuenta(): UseMutationResult<number, Error, ResolverCuentaInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResolverCuentaInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_resolver_cuenta', {
          p_nombre:         input.nombre,
          p_cliente_codigo: input.cliente_codigo ?? null,
          p_documento_id:   input.documento_id ?? null,
          p_telefono:       input.telefono ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useRegistrarCargo(): UseMutationResult<number, Error, RegistrarCargoInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrarCargoInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_registrar_cargo', {
          p_cuenta_id:       input.cuenta_id,
          p_monto_usd:       input.monto_usd,
          p_concepto:        input.concepto,
          p_origen:          input.origen,
          p_venta_documento: input.venta_documento ?? null,
          p_fecha:           input.fecha ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useRegistrarAbono(): UseMutationResult<number, Error, RegistrarAbonoInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrarAbonoInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_registrar_abono', {
          p_cuenta_id:  input.cuenta_id,
          p_monto_usd:  input.monto_usd,
          p_concepto:   input.concepto ?? null,
          p_metodo:     input.metodo ?? null,
          p_referencia: input.referencia ?? null,
          p_fecha:      input.fecha ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useAnularMovimiento(): UseMutationResult<number, Error, AnularMovimientoInput> {
  const queryClient = useQueryClient();
  return useMutation({
    // cuenta_id no lo pide el RPC (el movimiento ya sabe a qué cuenta pertenece);
    // se recibe igual para que el llamador no tenga que ir a buscarlo aparte.
    mutationFn: async (input: AnularMovimientoInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_anular_movimiento', {
          p_movimiento_id: input.movimiento_id,
          p_motivo:        input.motivo,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useCorregirMovimiento(): UseMutationResult<number, Error, CorregirMovimientoInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CorregirMovimientoInput): Promise<number> => {
      const { data, error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_corregir_movimiento', {
          p_movimiento_id: input.movimiento_id,
          p_monto_usd:     input.monto_usd,
          p_concepto:      input.concepto ?? null,
          p_fecha:         input.fecha ?? null,
          p_metodo:        input.metodo ?? null,
          p_referencia:    input.referencia ?? null,
          p_motivo:        input.motivo ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
      return data as number;
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useCerrarCuenta(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cuentaId: number): Promise<void> => {
      const { error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_cerrar_cuenta', { p_cuenta_id: cuentaId }),
      );
      if (error) throw new Error(traducirError(error));
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useReabrirCuenta(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (cuentaId: number): Promise<void> => {
      const { error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_reabrir_cuenta', { p_cuenta_id: cuentaId }),
      );
      if (error) throw new Error(traducirError(error));
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}

export function useActualizarCuenta(): UseMutationResult<void, Error, ActualizarCuentaInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ActualizarCuentaInput): Promise<void> => {
      const { error } = await withSupabaseRetry(() =>
        supabase.rpc('creditos_actualizar_cuenta', {
          p_cuenta_id:    input.cuenta_id,
          p_nombre:       input.nombre,
          p_documento_id: input.documento_id ?? null,
          p_telefono:     input.telefono ?? null,
          p_nota:         input.nota ?? null,
        }),
      );
      if (error) throw new Error(traducirError(error));
    },
    onSuccess: () => invalidateCreditos(queryClient),
  });
}
