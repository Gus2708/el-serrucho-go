// Universal design primitives — never change per brand
export const tokens = {
  spacing: {
    xs:  4,
    sm:  8,
    md:  16,
    lg:  24,
    xl:  32,
    xxl: 48,
  },
  radius: {
    sm:   8,
    md:   12,
    lg:   20,
    xl:   28,
    pill: 999,
  },
  fontSize: {
    display: 36,
    h1:      26,
    h2:      20,
    h3:      16,
    body:    14,
    sm:      12,
    xs:      10,
    xxs:     9,
  },
  fontWeight: {
    regular:  '400' as const,
    medium:   '500' as const,
    semibold: '600' as const,
    bold:     '700' as const,
    black:    '800' as const,
  },
  lineHeight: {
    tight:  1.2,
    normal: 1.5,
    loose:  1.7,
  },
  typography: {
    family: {
      mono: 'JetBrainsMono_400Regular',
      monoMedium: 'JetBrainsMono_500Medium',
      monoBold: 'JetBrainsMono_700Bold',
    },
  },
};
