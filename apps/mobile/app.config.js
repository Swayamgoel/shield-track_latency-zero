/**
 * app.config.js — Dynamic Expo config for ShieldTrack mobile
 *
 * Why this exists instead of app.json:
 *   Expo natively reads .env from the closest directory (apps/mobile/.env).
 *   We want a single source-of-truth root .env for the whole monorepo.
 *   Using app.config.js lets us explicitly load the root .env with dotenv,
 *   then inject values into the Expo `extra` and `env` fields.
 *
 * All process.env.EXPO_PUBLIC_* reads in the app still work automatically
 * because dotenv.config() populates process.env at build/start time.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  expo: {
    name: 'ShieldTrack',
    slug: 'shieldtrack',
    scheme: 'shieldtrack',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-router'],
  },
};
