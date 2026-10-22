const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true,
});

// E2E CLI links can be unreadable on Windows and are not application dependencies.
const blockList = config.resolver.blockList || [];
config.resolver.blockList = [
  ...(Array.isArray(blockList) ? blockList : [blockList]),
  /[/\\]e2e[/\\]node_modules(?:[/\\].*)?$/,
];

// Asegurarse de que Metro maneje correctamente los archivos estáticos en la carpeta public
config.resolver.sourceExts.push('mjs');

// Redirigir jspdf a su versión ES module para evitar el bundle node que contiene llamadas AMD require([])
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'jspdf') {
    return {
      filePath: require.resolve('jspdf/dist/jspdf.es.min.js'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
