import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  View,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useCallback, useEffect, useState } from 'react';

// The Entity server (Express, port 3000) serves the full web app. On a real
// device via Expo Go, localhost points at the phone — use your computer's LAN
// IP (e.g. http://192.168.1.20:3000), configurable below at runtime.
const DEFAULT_SERVER_URL = Platform.select({
  ios: 'http://localhost:3000',
  android: 'http://10.0.2.2:3000',
  default: 'http://localhost:3000',
});

const INITIAL_URL = process.env.EXPO_PUBLIC_ENTITY_URL ?? DEFAULT_SERVER_URL ?? 'http://localhost:3000';

function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(INITIAL_URL);
  const [draftUrl, setDraftUrl] = useState(INITIAL_URL);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const checkServer = useCallback((url: string) => {
    setChecking(true);
    setServerAvailable(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch(url, { signal: controller.signal })
      .then((r) => setServerAvailable(r.ok))
      .catch(() => setServerAvailable(false))
      .finally(() => {
        clearTimeout(timeout);
        setChecking(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => checkServer(serverUrl), [checkServer, serverUrl]);

  if (serverAvailable === null || checking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingEmoji}>⚡</Text>
          <Text style={styles.loadingText}>Connecting to Entity…</Text>
          <Text style={styles.helpText}>{serverUrl}</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  if (!serverAvailable) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <Text style={styles.loadingEmoji}>⚡</Text>
          <Text style={styles.errorText}>Entity server not reachable</Text>
          <Text style={styles.helpText}>
            Start the server on your computer (npm run dev), then enter its address.{'\n'}
            On a phone use your computer's LAN IP, not localhost.
          </Text>
          <TextInput
            value={draftUrl}
            onChangeText={setDraftUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.20:3000"
            placeholderTextColor="#555"
            style={styles.urlInput}
          />
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              const next = normalizeUrl(draftUrl);
              if (!next) return;
              setDraftUrl(next);
              if (next === serverUrl) {
                checkServer(next);
              } else {
                setServerUrl(next);
              }
            }}
          >
            <Text style={styles.retryButtonText}>Connect</Text>
          </TouchableOpacity>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        source={{ uri: serverUrl }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <Text style={styles.loadingEmoji}>⚡</Text>
            <Text style={styles.loadingText}>Loading Entity…</Text>
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
    paddingHorizontal: 32,
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
    color: '#e8e8ec',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  helpText: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  urlInput: {
    alignSelf: 'stretch',
    backgroundColor: '#1a1a1e',
    borderRadius: 12,
    color: '#e8e8ec',
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
  },
  retryButton: {
    alignSelf: 'stretch',
    backgroundColor: '#00aaff22',
    borderColor: '#00aaff66',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#7fd4ff',
    fontSize: 15,
    fontWeight: '600',
  },
});
