import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBootstrapConfig,
  DesktopAppInfo,
  DesktopLifecycleEvent,
  OnboardingState,
} from '@okw/desktop';

export interface OpenObDesktopBridge {
  getBootstrapConfig(): Promise<DesktopBootstrapConfig>;
  chooseVault(): Promise<DesktopBootstrapConfig | null>;
  getAppInfo(): Promise<DesktopAppInfo>;
  getOnboardingState(): Promise<OnboardingState | null>;
  setOnboardingState(state: OnboardingState): Promise<void>;
  onLifecycleEvent(listener: (event: DesktopLifecycleEvent) => void): () => void;
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
  onLifecycleEvent(listener: (event: DesktopLifecycleEvent) => void): () => void {
    const handler = (_event: any, data: DesktopLifecycleEvent) => listener(data);
    ipcRenderer.on('desktop:lifecycle-event', handler);
    return () => {
      ipcRenderer.removeListener('desktop:lifecycle-event', handler);
    };
  },
};

contextBridge.exposeInMainWorld('openobDesktop', desktopBridge);
