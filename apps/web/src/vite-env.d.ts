/// <reference types="vite/client" />

import type {
  DesktopBootstrapConfig,
  DesktopAppInfo,
  DesktopLifecycleEvent,
  DesktopFlushRequest,
  DesktopFlushResult,
  DesktopMenuAction,
  OnboardingState,
} from '@okw/desktop';

declare global {
  interface Window {
    openobDesktop?: {
      getBootstrapConfig(): Promise<DesktopBootstrapConfig>;
      chooseVault(): Promise<DesktopBootstrapConfig | null>;
      getAppInfo(): Promise<DesktopAppInfo>;
      getOnboardingState(): Promise<OnboardingState | null>;
      setOnboardingState(state: OnboardingState): Promise<void>;
      getPluginStates(): Promise<Record<string, boolean>>;
      setPluginStates(states: Record<string, boolean>): Promise<void>;
      onLifecycleEvent(listener: (event: DesktopLifecycleEvent) => void): () => void;
      onFlushRequest(
        listener: (req: DesktopFlushRequest) => Promise<DesktopFlushResult> | DesktopFlushResult
      ): () => void;
      onMenuAction(listener: (action: DesktopMenuAction) => void): () => void;
    };
  }
}
export {};
