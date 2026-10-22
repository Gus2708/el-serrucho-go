/* Native modules the UI suite never exercises for real. Business modules are never mocked here. */
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(async () => 'JVBERi0x'), // base64 of the "%PDF-1" header bytes
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: jest.fn(async () => new Uint8Array(32).fill(0xab).buffer),
    randomUUID: jest.fn(() => `c0000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`),
  };
});
