import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'my-app',
  webDir: 'dist/myApp/browser',

  server: {
    androidScheme: 'http',  
    cleartext: true
  }
};

export default config;