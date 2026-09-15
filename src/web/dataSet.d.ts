import 'react-native';

declare module 'react-native' {
  interface ViewProps {
    // react-native-web only: rendered as data-* attributes, ignored on native.
    dataSet?: Record<string, string>;
  }
}
