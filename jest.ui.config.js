/**
 * UI suite: React Native Testing Library over the plain `react-native` preset.
 * Only `*.ui.test.tsx` runs here; the root unit config ignores those files.
 * Run with `npm run test:ui`.
 */
module.exports = {
  preset: 'react-native',
  testMatch: ['**/*.ui.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/supabase/tests/'],
  setupFiles: ['<rootDir>/jest.ui.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
