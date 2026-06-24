import { scaleFont } from '../theme/responsive';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export interface DraftRestoreBannerProps {
  itemCount: number;
  nota?:     string;
  onRestore: () => void;
  onDiscard: () => void;
}

const NATIVE_DRIVER = Platform.OS !== 'web';

export function DraftRestoreBanner({ itemCount, nota, onRestore, onDiscard }: DraftRestoreBannerProps) {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(72)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue:         0,
        duration:        220,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
      Animated.timing(opacity, {
        toValue:         1,
        duration:        200,
        easing:          Easing.out(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
    ]).start();
  }, []);

  function dismiss(callback: () => void) {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue:         72,
        duration:        180,
        easing:          Easing.in(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
      Animated.timing(opacity, {
        toValue:         0,
        duration:        160,
        easing:          Easing.in(Easing.quad),
        useNativeDriver: NATIVE_DRIVER,
      }),
    ]).start(({ finished }) => {
      if (finished) callback();
    });
  }

  const countLabel = itemCount === 1 ? '1 ítem' : `${itemCount} ítems`;

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor:     colors.primary + '33',
          transform:       [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryFaded }]}>
        <Feather name="edit-2" size={13} color={colors.primary} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.heading, { color: colors.text }]}>
          Borrador guardado · {countLabel}
        </Text>
        {nota ? (
          <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={1}>
            {nota}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => dismiss(onRestore)}
          style={({ pressed }) => [
            styles.btnContinue,
            { backgroundColor: colors.primary },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={[styles.btnContinueText, { color: colors.onPrimary }]}>
            Continuar
          </Text>
        </Pressable>
        <Pressable
          onPress={() => dismiss(onDiscard)}
          style={({ pressed }) => [pressed && { opacity: 0.5 }]}
          hitSlop={8}
        >
          <Text style={[styles.btnDiscard, { color: colors.textDim }]}>
            Descartar
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position:          'absolute',
    bottom:            90,
    left:              16,
    right:             16,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingVertical:   12,
    paddingHorizontal: 14,
    borderRadius:      14,
    borderWidth:       1,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.35,
    shadowRadius:      6,
    elevation:         6,
    zIndex:            900,
  },
  iconWrap: {
    width:          30,
    height:         30,
    borderRadius:   9,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  content: {
    flex: 1,
    gap:  2,
  },
  heading: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
    lineHeight: scaleFont(16),
  },
  sub: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
    lineHeight: scaleFont(14),
  },
  actions: {
    alignItems:  'flex-end',
    gap:         5,
    flexShrink:  0,
  },
  btnContinue: {
    paddingVertical:   5,
    paddingHorizontal: 10,
    borderRadius:      8,
  },
  btnContinueText: {
    fontSize:   scaleFont(11),
    fontFamily: 'JetBrainsMono_700Bold',
  },
  btnDiscard: {
    fontSize:   scaleFont(10),
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
