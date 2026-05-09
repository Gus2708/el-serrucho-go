import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useSyncStatus } from '../hooks/useSyncStatus';
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

  const { dotColor, line1, line2, tag, tagColor, isClosed, isStuck } = getState(minutesAgo, isLoading, colors, activeCommand);

  const handleSync = () => {
    if (isClosed) {
      Alert.alert('Tienda Cerrada', 'El Serrucho está fuera de su horario laboral (8am - 6pm). Los datos se actualizarán automáticamente al abrir.');
      return;
    }

    if (isStuck) {
      Alert.alert(
        'Sincronización Atascada',
        'El backend local no está respondiendo. ¿Deseas forzar el reinicio del estado?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { 
            text: 'Forzar Reinicio', 
            style: 'destructive',
            onPress: async () => {
              try {
                await forceResetSync();
              } catch (e) {
                Alert.alert('Error', 'No se pudo reiniciar el estado.');
              }
            }
          }
        ]
      );
      return;
    }

    triggerSync('sync_all', {
      onError: (error) => {
        Alert.alert('Error de Sincronización', error.message || 'No se pudo conectar con el widget.');
      }
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
          { backgroundColor: isClosed ? colors.border : isStuck ? colors.danger + '15' : colors.primary + '15' },
          pressed && !isClosed && { opacity: 0.7 },
        ]}
        onPress={handleSync}
        disabled={isSyncing && !isStuck}
      >
        {isSyncing && !isStuck ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather 
            name={isClosed ? 'moon' : isStuck ? 'alert-triangle' : 'refresh-cw'} 
            size={14} 
            color={isClosed ? colors.textDim : isStuck ? colors.danger : colors.primary} 
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
  const isClosed = hour >= 18 || hour < 8;

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
    };
  }

  if (isLoading) {
    return {
      dotColor: colors.textMuted,
      line1:    'Verificando sincronización…',
      line2:    'Conectando con Supabase',
      tag:      '…',
      tagColor: colors.textMuted,
    };
  }
  if (minutesAgo === null) {
    return {
      dotColor: colors.danger,
      line1:    'Widget sin actividad detectada',
      line2:    'No hay datos de sincronización',
      tag:      'Offline',
      tagColor: colors.danger,
    };
  }
  if (minutesAgo < 1) {
    return {
      dotColor: colors.success,
      line1:    'Widget activo · monitoreando .dat',
      line2:    'Último cambio detectado · ahora mismo',
      tag:      'En sync',
      tagColor: colors.success,
    };
  }
  if (minutesAgo < 30) {
    return {
      dotColor: colors.success,
      line1:    'Widget activo · monitoreando .dat',
      line2:    `Último cambio detectado · ${minutesAgo} min`,
      tag:      'En sync',
      tagColor: colors.success,
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
    };
  }
  const hours = Math.floor(minutesAgo / 60);
  return {
    dotColor: colors.danger,
    line1:    'Widget sin actividad · revisar proceso',
    line2:    `Sin cambios desde hace ${hours}h`,
    tag:      'Sin sync',
    tagColor: colors.danger,
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
