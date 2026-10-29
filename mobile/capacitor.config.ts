import type { CapacitorConfig } from '@capacitor/cli';

/**
 * IbuTest for iOS and Android. The web client is bundled into the app (no remote code is
 * loaded); on first launch the user enters their team's HTTPS server address.
 */
const config: CapacitorConfig = {
  appId: 'com.ibutest.app',
  appName: 'IbuTest',
  webDir: '../client/dist',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // Never allow navigation of the app WebView to other origins.
    allowNavigation: [],
    cleartext: false,
  },
  plugins: {
    // Route fetch/XHR through the native HTTP stack so the httpOnly refresh cookie works
    // against the user's server without third-party-cookie restrictions or CORS.
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
