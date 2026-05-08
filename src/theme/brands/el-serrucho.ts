import { BrandConfig } from './types';

export const elSerrucho: BrandConfig = {
  id:      'el-serrucho',
  appName: 'El Serrucho GO',
  // logo: require('../../../assets/brands/el-serrucho/logo.png'),

  colors: {
    bg:           '#0C0C0C',   // near-black background
    surface:      '#161616',   // card background
    surfaceAlt:   '#1E1E1E',   // elevated surface / inputs
    border:       '#2C2C2C',   // subtle dividers
    primary:      '#F5B200',   // gold — saw blade from El Serrucho logo
    primaryDim:   '#C48E00',   // dimmed gold for secondary elements
    primaryFaded: 'rgba(245,178,0,0.12)', // gold at ~12% opacity
    text:         '#FFFFFF',
    textMuted:    '#888888',
    textDim:      '#444444',
    danger:       '#FF5252',
    warning:      '#FF9800',
    success:      '#4CAF50',
    onPrimary:    '#0C0C0C',   // text/icons on gold backgrounds → black
  },

  // USD ONLY — no Bolívares anywhere in the UI
  currency: {
    symbol:   '$',
    code:     'USD',
    decimals: 2,
  },

  // SyncBadge thresholds (minutes)
  syncThresholds: {
    ok:      30,   // < 30min  → green
    warning: 120,  // 30–120m  → yellow
    // > 120min → red
  },
};
