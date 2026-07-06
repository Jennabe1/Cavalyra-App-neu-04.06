import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.cavalyra.app',
  appName: 'Cavalyra',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // Für lokale Tests gegen die Lovable-Sandbox kann diese URL aktiviert werden.
    // Für Store-Veröffentlichungen (Play Store / App Store) MUSS dieser Block
    // auskommentiert / entfernt sein, damit die App offline aus dem gebündelten
    // dist/ Verzeichnis lädt.
    // url: 'https://e59b0fff-3a8b-4ae2-bcd6-fb60e231b1fd.lovableproject.com?forceHideBadge=true',
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    // WICHTIG: 'never' verhindert doppelte Safe-Area-Berechnung.
    // Mit 'always' inset die WKWebView den Inhalt bereits um die Safe Area,
    // gleichzeitig würde CSS env(safe-area-inset-*) nochmals padden -> Leerraum
    // oben (unter Dynamic Island) und unten (über Home Indicator).
    // Mit 'never' füllt die WebView den kompletten Screen (viewport-fit=cover),
    // und CSS env(safe-area-inset-*) übernimmt die Safe Area exakt einmal.
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
    backgroundColor: '#5c3540',
    preferredContentMode: 'mobile',
    handleApplicationNotifications: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#5c3540',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#5c3540',
    },
  },
};

export default config;
