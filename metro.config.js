const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Asegurarse de que Metro maneje correctamente los archivos estáticos en la carpeta public
config.resolver.sourceExts.push('mjs');

module.exports = config;
