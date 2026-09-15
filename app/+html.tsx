import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import { rootStyles, viewportDebugPanel, visualViewportSync } from '../src/web/viewport';

/**
 * This file is web-only and used to configure the root HTML for every
 * web page during static rendering.
 * The contents of this function only run in Node.js and only during
 * static rendering (expo export).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <title>El Serrucho GO</title>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, maximum-scale=1, user-scalable=0, viewport-fit=cover" />

        {/* PWA Primary Meta Tags */}
        <meta name="theme-color" content="#010100" />
        <meta name="description" content="Dashboard administrativo ferretería El Serrucho" />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        
        {/* Open Graph / social preview */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="El Serrucho GO" />
        <meta property="og:url" content="https://el-serrucho-go.vercel.app" />
        <meta property="og:title" content="El Serrucho GO - Real-Time Inventory &amp; Sales Analytics" />
        <meta property="og:description" content="Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta property="og:image" content="https://el-serrucho-go.vercel.app/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="El Serrucho GO - Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="El Serrucho GO - Real-Time Inventory &amp; Sales Analytics" />
        <meta name="twitter:description" content="Mobile + PWA analytics dashboard in daily use at a hardware store. Built with Expo, React Native, TypeScript and Supabase." />
        <meta name="twitter:image" content="https://el-serrucho-go.vercel.app/og.png" />

        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Anti-cache for PWA updates */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />

        {/* iOS / Safari specific */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="Serrucho GO" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Serrucho GO" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: rootStyles }} />
        <script dangerouslySetInnerHTML={{ __html: visualViewportSync }} />
        <script dangerouslySetInnerHTML={{ __html: viewportDebugPanel }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

