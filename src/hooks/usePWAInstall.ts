import { create } from 'zustand';
import { Platform } from 'react-native';

interface PWAInstallState {
  deferredPrompt: any | null;
  isInstallable: boolean;
  isStandalone: boolean;
  hasUpdate: boolean;
  setDeferredPrompt: (prompt: any) => void;
  setIsInstallable: (installable: boolean) => void;
  setIsStandalone: (standalone: boolean) => void;
  setHasUpdate: (hasUpdate: boolean) => void;
  install: () => Promise<boolean>;
}

export const usePWAInstallStore = create<PWAInstallState>((set, get) => ({
  deferredPrompt: null,
  isInstallable: false,
  isStandalone: false,
  hasUpdate: false,
  setDeferredPrompt: (deferredPrompt) => set({ deferredPrompt, isInstallable: !!deferredPrompt }),
  setIsInstallable: (isInstallable) => set({ isInstallable }),
  setIsStandalone: (isStandalone) => set({ isStandalone }),
  setHasUpdate: (hasUpdate) => set({ hasUpdate }),
  install: async () => {
    const prompt = get().deferredPrompt;
    if (!prompt) return false;
    try {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      console.log('SW PWA install prompt selection outcome:', outcome);
      // Clean up prompt after use
      set({ deferredPrompt: null, isInstallable: false });
      return outcome === 'accepted';
    } catch (err) {
      console.error('SW PWA install prompt failed:', err);
      return false;
    }
  },
}));
