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
    getOnboardingState(): Promise<{
      version: number;
      dismissedFirstRun: boolean;
      quickTourCompleted: boolean;
      completedChapters: string[];
    } | null>;
    setOnboardingState(state: {
      version: number;
      dismissedFirstRun: boolean;
      quickTourCompleted: boolean;
      completedChapters: string[];
    }): Promise<void>;
    onLifecycleEvent(listener: (event: { type: string; payload?: any }) => void): () => void;
  };
}
