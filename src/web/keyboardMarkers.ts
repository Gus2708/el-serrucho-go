// react-native-web renders dataSet keys as data-* attributes; rootStyles targets them while the iOS keyboard is open.

// Floating bottom bars: they would cover the small form area left above the keyboard.
export const HIDE_ON_KEYBOARD = { hideOnKeyboard: 'true' } as const;

// SafeAreaViews with edges={['top']}: on web, react-native-safe-area-context 5.x still pads the
// bottom inset for edges missing from the array, which shows as a black band above the keyboard.
export const NO_BOTTOM_INSET_ON_KEYBOARD = { noBottomInsetOnKeyboard: 'true' } as const;
