/// <reference types="vite/client" />

interface Window {
  openobDesktop?: {
    getBootstrapConfig(): Promise<{
      gatewayUrl: string;
      token: string;
      vaultName: string;
      vaultPath?: string;
    }>;
    chooseVault(): Promise<{
      gatewayUrl: string;
      token: string;
      vaultName: string;
      vaultPath?: string;
    } | null>;
    getAppInfo(): Promise<{ name: string; version: string; platform: string }>;
    onLifecycleEvent(listener: (event: { type: string; payload?: any }) => void): () => void;
  };
}
