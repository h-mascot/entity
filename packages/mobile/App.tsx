import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, SafeAreaView, Text, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState, useEffect } from 'react';

const DEFAULT_SERVER_URL = Platform.select({
  ios: 'http://localhost:5173',
  android: 'http://10.0.2.2:5173',
  default: 'http://localhost:5173',
});

const SERVER_URL = process.env.EXPO_PUBLIC_ENTITY_URL ?? DEFAULT_SERVER_URL ?? 'http://localhost:5173';

export default function App() {
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${SERVER_URL}`, { signal: controller.signal })
      .then(r => { if (r.ok) setServerAvailable(true); else setServerAvailable(false); })
      .catch(() => setServerAvailable(false));

    return () => controller.abort();
  }, []);

  if (serverAvailable === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingEmoji}>⚡</Text>
          <Text style={styles.loadingText}>Connecting to Entity...</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  if (!serverAvailable) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingEmoji}>⚠️</Text>
          <Text style={styles.errorText}>Entity server not reachable</Text>
          <Text style={styles.helpText}>Start the web app and point `EXPO_PUBLIC_ENTITY_URL` to it:{'\n'}{SERVER_URL}</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        source={{ uri: SERVER_URL }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <Text style={styles.loadingEmoji}>⚡</Text>
            <Text style={styles.loadingText}>Loading Entity...</Text>
          </View>
        )}
        onError={(e) => console.error('WebView error:', e.nativeEvent)}
        allowsBackForwardNavigationGestures={true}
      />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  webviewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  loadingEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  loadingText: {
    color: '#888888',
    fontSize: 16,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  helpText: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
