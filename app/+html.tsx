import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

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
        
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Anti-cache for PWA updates */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />

        {/* iOS / Safari specific */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Serrucho GO" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Serrucho GO" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: expoRootStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const expoRootStyles = `
#root, body, html {
  height: 100% !important;
  height: 100dvh !important;
  width: 100vw !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  position: fixed !important;
  inset: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background-color: #010100 !important;
  -webkit-overflow-scrolling: touch !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  touch-action: none !important;
}

#root {
  display: flex;
  flex-direction: column;
}
`;
