import { IpcRequest, IpcResponse, NativeIpcChannel } from './types.js';

export type IpcHandler<T = any, R = any> = (payload: T) => Promise<R> | R;

export class DesktopIpcBridge {
  private handlers: Map<NativeIpcChannel, IpcHandler> = new Map();
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  registerHandler<T, R>(channel: NativeIpcChannel, handler: IpcHandler<T, R>): void {
    this.handlers.set(channel, handler);
  }

  async handleRequest<T, R>(request: IpcRequest<T>): Promise<IpcResponse<R>> {
    const handler = this.handlers.get(request.channel);
    if (!handler) {
      return {
        id: request.id,
        success: false,
        error: `No handler registered for IPC channel: ${request.channel}`,
      };
    }

    try {
      const data = await handler(request.payload);
      return {
        id: request.id,
        success: true,
        data,
      };
    } catch (err: any) {
      return {
        id: request.id,
        success: false,
        error: err?.message || String(err),
      };
    }
  }

  onEvent(channel: string, listener: (data: any) => void): () => void {
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set());
    }
    this.eventListeners.get(channel)!.add(listener);

    return () => {
      this.eventListeners.get(channel)?.delete(listener);
    };
  }

  emitEvent(channel: string, data: any): void {
    const listeners = this.eventListeners.get(channel);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          console.error(`Error emitting event to ${channel}:`, err);
        }
      }
    }
  }
}
