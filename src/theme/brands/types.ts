export interface BrandColors {
  bg:           string;
  surface:      string;
  surfaceAlt:   string;
  border:       string;
  primary:      string;
  primaryDim:   string;
  primaryFaded: string;
  text:         string;
  textMuted:    string;
  textDim:      string;
  danger:       string;
  warning:      string;
  success:      string;
  onPrimary:    string;
}

export interface BrandConfig {
  id:      string;
  appName: string;
  logo?:   any;
  colors:  BrandColors;
  currency: {
    symbol:   string;
    code:     string;
    decimals: number;
  };
  syncThresholds: {
    ok:      number; // minutes
    warning: number; // minutes
  };
}
