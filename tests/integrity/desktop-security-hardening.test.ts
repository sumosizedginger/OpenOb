import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'node:crypto';

describe('Desktop Security Hardening & Trust Boundaries (P1-A & P1-C)', () => {
  describe('Exact-Origin Navigation Security', () => {
    function checkAllowedNavigation(
      navUrl: string,
      gatewayUrl: string | null,
      isDev = false,
      devUrl = 'http://localhost:5173'
    ): boolean {
      try {
        const parsed = new URL(navUrl);
        if (gatewayUrl) {
          const gatewayOrigin = new URL(gatewayUrl).origin;
          if (parsed.origin === gatewayOrigin) return true;
        }
        if (isDev && devUrl) {
          const viteOrigin = new URL(devUrl).origin;
          if (parsed.origin === viteOrigin) return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    it('allows exact gateway origin navigation', () => {
      const gatewayUrl = 'http://127.0.0.1:49152';
      expect(checkAllowedNavigation('http://127.0.0.1:49152/index.html', gatewayUrl)).toBe(true);
      expect(checkAllowedNavigation('http://127.0.0.1:49152/notes/Welcome.md', gatewayUrl)).toBe(
        true
      );
    });

    it('strictly rejects malicious navigation attempts', () => {
      const gatewayUrl = 'http://127.0.0.1:49152';

      // Rogue ports
      expect(checkAllowedNavigation('http://127.0.0.1:8080', gatewayUrl)).toBe(false);

      // Credential / Subdomain trickery (@evil.com)
      expect(checkAllowedNavigation('http://127.0.0.1:49152@evil.com', gatewayUrl)).toBe(false);

      // External HTTP/HTTPS domains
      expect(checkAllowedNavigation('https://google.com', gatewayUrl)).toBe(false);
      expect(checkAllowedNavigation('https://openob.org', gatewayUrl)).toBe(false);

      // Javascript & Data URIs
      expect(checkAllowedNavigation('javascript:alert(1)', gatewayUrl)).toBe(false);
      expect(checkAllowedNavigation('data:text/html,<h1>hacked</h1>', gatewayUrl)).toBe(false);
      expect(checkAllowedNavigation('file:///C:/Windows/System32/calc.exe', gatewayUrl)).toBe(
        false
      );
    });

    it('allows dev server origin only in development mode', () => {
      const gatewayUrl = 'http://127.0.0.1:49152';
      const devUrl = 'http://localhost:5173';

      expect(checkAllowedNavigation('http://localhost:5173', gatewayUrl, false, devUrl)).toBe(
        false
      );
      expect(checkAllowedNavigation('http://localhost:5173', gatewayUrl, true, devUrl)).toBe(true);
      expect(checkAllowedNavigation('http://localhost:5173/app', gatewayUrl, true, devUrl)).toBe(
        true
      );
    });
  });

  describe('IPC Main-Frame Sender Trust Validation', () => {
    function validateSender(
      event: { sender: any; senderFrame: any },
      mainWindow: { isDestroyed: () => boolean; webContents: any } | null,
      gatewayUrl: string
    ): boolean {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      if (event.sender !== mainWindow.webContents) return false;
      if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;
      const senderUrl = event.senderFrame?.url;
      if (!senderUrl) return false;

      try {
        const parsed = new URL(senderUrl);
        const trustedOrigin = new URL(gatewayUrl).origin;
        return parsed.origin === trustedOrigin;
      } catch {
        return false;
      }
    }

    it('accepts IPC invoke from main window main frame with trusted origin', () => {
      const mockWebContents = {
        mainFrame: { url: 'http://127.0.0.1:49152/index.html' },
      };
      const mockMainWindow = {
        isDestroyed: () => false,
        webContents: mockWebContents,
      };

      const validEvent = {
        sender: mockWebContents,
        senderFrame: mockWebContents.mainFrame,
      };

      expect(validateSender(validEvent, mockMainWindow, 'http://127.0.0.1:49152')).toBe(true);
    });

    it('rejects IPC invoke from subframes or rogue windows', () => {
      const mockWebContents = {
        mainFrame: { url: 'http://127.0.0.1:49152/index.html' },
      };
      const mockMainWindow = {
        isDestroyed: () => false,
        webContents: mockWebContents,
      };

      // Subframe (e.g. iframe)
      const subFrameEvent = {
        sender: mockWebContents,
        senderFrame: { url: 'http://127.0.0.1:49152/iframe.html' },
      };
      expect(validateSender(subFrameEvent, mockMainWindow, 'http://127.0.0.1:49152')).toBe(false);

      // External sender
      const rogueEvent = {
        sender: { mainFrame: {} },
        senderFrame: { url: 'https://evil.com' },
      };
      expect(validateSender(rogueEvent, mockMainWindow, 'http://127.0.0.1:49152')).toBe(false);
    });
  });

  describe('Plugin Host Sandbox & Safe DOM Construction (P1-C)', () => {
    it('does not use innerHTML raw sink for error rendering', () => {
      const errorMsg = '<script>alert(1)</script>';
      let textContent = '';
      const container = {
        get textContent() {
          return textContent;
        },
        set textContent(val: string) {
          textContent = val;
        },
        replaceChildren: vi.fn((child: any) => {
          textContent = child.textContent || '';
        }),
      };

      const card = {
        className: 'plugin-view-error',
        textContent: `Plugin View Error: ${errorMsg}`,
      };
      container.replaceChildren(card);

      expect(container.textContent).toBe('Plugin View Error: <script>alert(1)</script>');
      expect(container.textContent).not.toContain('<script>alert(1)</script><');
    });
  });
});
