import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { notify, confirm } from '../lib/notify';
import { Feather } from '@expo/vector-icons';

export function SyncBadge() {
  const { colors } = useTheme();
  const { minutesAgo, isLoading, triggerSync, forceResetSync, isSyncing, activeCommand } = useSyncStatus();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const { dotColor, line1, line2, tag, tagColor, isClosed, isStuck, isRecess } = getState(minutesAgo, isLoading, colors, activeCommand);

  const handleSync = () => {
    if (isClosed) {
      notify('Tienda Cerrada', 'El Serrucho está fuera de su horario laboral (8am - 6pm). Los datos se actualizarán automáticamente al abrir.');
      return;
    }

    if (isStuck) {
      confirm({
        title:       'Sincronización Atascada',
        message:     'El backend local no está respondiendo. ¿Deseas forzar el reinicio del estado?',
        confirmText: 'Forzar Reinicio',
        destructive: true,
        onConfirm: async () => {
          try {
            await forceResetSync();
          } catch {
            notify('Error', 'No se pudo reiniciar el estado.');
          }
        },
      });
      return;
    }

    triggerSync('sync_all', {
      onError: (error) => {
        notify('Error de Sincronización', error.message || 'No se pudo conectar con el widget.');
      },
    });
  };

  return (
    <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border, opacity: isClosed ? 0.8 : 1 }]}>
      <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: isClosed ? 1 : pulse }]} />

      <View style={styles.texts}>
        <Text style={[styles.t1, { color: isClosed ? colors.textMuted : colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{line1}</Text>
        <Text style={[styles.t2, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit>{line2}</Text>
      </View>

      <View style={[styles.tag, { backgroundColor: tagColor + '18', borderColor: tagColor + '40' }]}>
        <Text style={[styles.tagText, { color: tagColor }]}>{tag}</Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.syncButton,
          { backgroundColor: (isClosed || isRecess) ? colors.border : isStuck ? colors.danger + '15' : colors.primary + '15' },
          pressed && !isClosed && !isRecess && { opacity: 0.7 },
        ]}
        onPress={handleSync}
        disabled={(isSyncing && !isStuck) || isRecess}
      >
        {isSyncing && !isStuck ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather 
            name={isClosed ? 'moon' : isRecess ? 'coffee' : isStuck ? 'alert-triangle' : 'refresh-cw'} 
            size={14} 
            color={isClosed ? colors.textMuted : isRecess ? colors.warning : isStuck ? colors.danger : colors.primary} 
          />
        )}
      </Pressable>
    </View>
  );
}

function getState(
  minutesAgo: number | null,
  isLoading: boolean,
  colors: { success: string; warning: string; danger: string; textMuted: string; primary: string },
  activeCommand: { status: string; comando: string; runningMinutes?: number } | null
) {
  // 0. Verificar Horario de Atención (6 PM - 8 AM = Cerrado)
  const now = new Date();
  const hour = now.getHours();
  const isSunday = now.getDay() === 0;
  const isClosed = (hour >= 18 || hour < 8) || isSunday;
  const isRecess = hour === 13 && !isSunday; // 1:00 PM - 1:59 PM (Solo días laborables)

  if (activeCommand) {
    const isProcessing = activeCommand.status === 'ejecutando' || activeCommand.status === 'procesando';
    const isStuck = (activeCommand.runningMinutes || 0) >= 2;

    return {
      dotColor: isStuck ? colors.danger : (isProcessing ? colors.primary : colors.warning),
      line1:    isStuck ? 'Sincronización demorada' : (isProcessing ? 'Sincronización en curso…' : 'Comando en cola (remoto)'),
      line2:    isStuck ? 'El backend local no responde' : (isProcessing ? 'Backend local procesando data' : 'Esperando respuesta del listener'),
      tag:      isStuck ? 'Stuck' : (isProcessing ? 'Syncing' : 'Pendiente'),
      tagColor: isStuck ? colors.danger : (isProcessing ? colors.primary : colors.warning),
      isClosed: false,
      isStuck,
      isRecess: false,
    };
  }

  if (isClosed) {
    return {
      dotColor: colors.textMuted,
      line1:    'El Serrucho está cerrado',
      line2:    'No hay cambios pendientes por ahora',
      tag:      'Cerrado',
      tagColor: colors.textMuted,
      isClosed: true,
      isRecess: false,
    };
  }

  if (isRecess) {
    return {
      dotColor: colors.warning,
      line1:    'Tienda en Receso',
      line2:    'Retomamos actividad a las 2:00 PM',
      tag:      'Receso',
      tagColor: colors.warning,
      isClosed: false,
      isRecess: true,
    };
  }

  if (isLoading) {
    return {
      dotColor: colors.textMuted,
      line1:    'Verificando sincronización…',
      line2:    'Conectando con Supabase',
      tag:      '…',
      tagColor: colors.textMuted,
      isRecess: false,
    };
  }
  if (minutesAgo === null) {
    return {
      dotColor: colors.danger,
      line1:    'Widget sin actividad detectada',
      line2:    'No hay datos de sincronización',
      tag:      'Offline',
      tagColor: colors.danger,
      isRecess: false,
    };
  }
  if (minutesAgo < 1) {
    return {
      dotColor: colors.success,
      line1:    'Widget activo · monitoreando .dat',
      line2:    'Último cambio detectado · ahora mismo',
      tag:      'En sync',
      tagColor: colors.success,
      isRecess: false,
    };
  }
  if (minutesAgo < 30) {
    return {
      dotColor: colors.success,
      line1:    'Widget activo · monitoreando .dat',
      line2:    `Último cambio detectado · ${minutesAgo} min`,
      tag:      'En sync',
      tagColor: colors.success,
      isRecess: false,
    };
  }
  if (minutesAgo < 120) {
    const h = Math.floor(minutesAgo / 60);
    const m = minutesAgo % 60;
    const ago = h > 0 ? `${h}h ${m}m` : `${minutesAgo} min`;
    return {
      dotColor: colors.warning,
      line1:    'Sincronización demorada · Hybrid POS',
      line2:    `Sin actividad hace ${ago}`,
      tag:      'Demorada',
      tagColor: colors.warning,
      isRecess: false,
    };
  }
  const hours = Math.floor(minutesAgo / 60);
  return {
    dotColor: colors.danger,
    line1:    'Widget sin actividad · revisar proceso',
    line2:    `Sin cambios desde hace ${hours}h`,
    tag:      'Sin sync',
    tagColor: colors.danger,
    isRecess: false,
  };
}

const styles = StyleSheet.create({
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    marginHorizontal:  16,
    marginBottom:      12,
    borderRadius:      12,
    borderWidth:       0.5,
    paddingVertical:   10,
    paddingHorizontal: 14,
  },
  dot: {
    width:        7,
    height:       7,
    borderRadius: 4,
    flexShrink:   0,
  },
  texts: {
    flex: 1,
    gap:  1,
  },
  t1: {
    fontSize:   11,
    fontFamily: 'JetBrainsMono_500Medium',
  },
  t2: {
    fontSize: 10,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  tag: {
    borderRadius:     20,
    borderWidth:      0.5,
    paddingVertical:  3,
    paddingHorizontal: 10,
    flexShrink:       0,
    minWidth:         60,
    alignItems:       'center',
  },
  tagText: {
    fontSize:   10,
    fontFamily: 'JetBrainsMono_700Bold',
  },
  syncButton: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     4,
  },
});
