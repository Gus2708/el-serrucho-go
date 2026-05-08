import React, { createContext, useContext } from 'react';
import { tokens } from './tokens';
import { elSerrucho } from './brands/el-serrucho';
import { BrandConfig } from './brands/types';

// To white-label for a new client: swap the import above and rebuild.
const ACTIVE_BRAND: BrandConfig = elSerrucho;

interface ThemeContextValue {
  colors:   BrandConfig['colors'];
  currency: BrandConfig['currency'];
  sync:     BrandConfig['syncThresholds'];
  tokens:   typeof tokens;
  brand:    BrandConfig;
  /** Format a USD amount: "$1,234.56" */
  formatUSD: (amount: number | null | undefined) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { currency } = ACTIVE_BRAND;

  const formatUSD = (amount: number | null | undefined): string => {
    if (amount == null || isNaN(amount)) return `${currency.symbol}0.00`;
    return `${currency.symbol}${amount.toLocaleString('en-US', {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    })}`;
  };

  return (
    <ThemeContext.Provider
      value={{
        colors:    ACTIVE_BRAND.colors,
        currency:  ACTIVE_BRAND.currency,
        sync:      ACTIVE_BRAND.syncThresholds,
        tokens,
        brand:     ACTIVE_BRAND,
        formatUSD,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
