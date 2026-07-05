# Entity Mobile (Expo)

A native shell around the Entity web app using a WebView, installable on your phone via [Expo Go](https://expo.dev/go).

## Run it

1. Start the Entity server on your computer:

   ```bash
   npm run dev   # serves the app on port 3000
   ```

2. Start the Expo dev server:

   ```bash
   cd packages/mobile
   npx expo start
   ```

3. Install **Expo Go** on your phone (App Store / Play Store), then scan the QR code Expo prints.

4. The app connects to `http://localhost:3000` by default. On a real phone, localhost points at the phone itself — enter your computer's LAN IP on the connect screen (e.g. `http://192.168.1.20:3000`), or set it up-front:

   ```bash
   EXPO_PUBLIC_ENTITY_URL=http://192.168.1.20:3000 npx expo start
   ```

   Your computer and phone must be on the same network, and the server must listen on the LAN address (`HOST=0.0.0.0 npm run dev` — set `ENTITY_API_TOKEN` or `ENTITY_ALLOW_INSECURE=1` since the server refuses unauthenticated non-loopback binds).

## Standalone builds

For an installable app without Expo Go, use [EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npx eas build --platform ios      # or android
```
