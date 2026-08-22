import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBootstrapConfig,
  DesktopAppInfo,
  DesktopLifecycleEvent,
  DesktopFlushRequest,
  DesktopFlushResult,
  DesktopMenuAction,
  OnboardingState,
} from '@okw/desktop';

export interface OpenObDesktopBridge {
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
}

const desktopBridge: OpenObDesktopBridge = {
  async getBootstrapConfig(): Promise<DesktopBootstrapConfig> {
    return ipcRenderer.invoke('desktop:get-bootstrap');
  },
  async chooseVault(): Promise<DesktopBootstrapConfig | null> {
    return ipcRenderer.invoke('desktop:choose-vault');
  },
  async getAppInfo(): Promise<DesktopAppInfo> {
    return ipcRenderer.invoke('desktop:get-info');
  },
  async getOnboardingState(): Promise<OnboardingState | null> {
    return ipcRenderer.invoke('desktop:get-onboarding-state');
  },
  async setOnboardingState(state: OnboardingState): Promise<void> {
    return ipcRenderer.invoke('desktop:set-onboarding-state', state);
  },
  async getPluginStates(): Promise<Record<string, boolean>> {
    return ipcRenderer.invoke('desktop:get-plugin-states');
  },
  async setPluginStates(states: Record<string, boolean>): Promise<void> {
    return ipcRenderer.invoke('desktop:set-plugin-states', states);
  },
  onLifecycleEvent(listener: (event: DesktopLifecycleEvent) => void): () => void {
    const handler = (_event: any, data: DesktopLifecycleEvent) => listener(data);
    ipcRenderer.on('desktop:lifecycle-event', handler);
    return () => {
      ipcRenderer.removeListener('desktop:lifecycle-event', handler);
    };
  },
  onFlushRequest(
    listener: (req: DesktopFlushRequest) => Promise<DesktopFlushResult> | DesktopFlushResult
  ): () => void {
    const handler = async (_event: any, req: DesktopFlushRequest) => {
      try {
        const result = await listener(req);
        void ipcRenderer.invoke('desktop:flush-result', result);
      } catch (err: any) {
        void ipcRenderer.invoke('desktop:flush-result', {
          requestId: req.requestId,
          success: false,
          conflicts: [],
          failures: [err?.message || 'Flush handler error'],
        });
      }
    };
    ipcRenderer.on('desktop:flush-request', handler);
    return () => {
      ipcRenderer.removeListener('desktop:flush-request', handler);
    };
  },
  onMenuAction(listener: (action: DesktopMenuAction) => void): () => void {
    const handler = (_event: any, data: { action: DesktopMenuAction }) => {
      if (data?.action) listener(data.action);
    };
    ipcRenderer.on('desktop:menu-action', handler);
    return () => {
      ipcRenderer.removeListener('desktop:menu-action', handler);
    };
  },
};

contextBridge.exposeInMainWorld('openobDesktop', desktopBridge);
