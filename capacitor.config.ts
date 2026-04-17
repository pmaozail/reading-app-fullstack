import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pmaozail.readingapp',
  appName: 'Reading App',
  webDir: 'dist',
  server: {
    cleartext: true,
    androidScheme: 'http',
  },
};

export default config;
