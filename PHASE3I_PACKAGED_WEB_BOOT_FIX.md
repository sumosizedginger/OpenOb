# Phase 3I: Packaged Electron Web UI Boot Fix Report

**Date:** 2026-08-22  
**Authority:** Foreman Gemini 3.7 Flash  
**Issue Resolved:** Packaged Electron executable (`win-unpacked/OpenOb.exe`) launching to raw `UNAUTHORIZED` JSON instead of React UI.  
**Repository:** https://github.com/sumosizedginger/OpenOb

---

## 1. Root Cause Analysis

### What Happened

When `apps/desktop/release/win-unpacked/OpenOb.exe` was launched manually by a user on Windows:

1. `apps/desktop/src/main.ts` previously attempted to resolve `webDistPath` via relative directory hopping (`path.resolve(__dirname, '../../../apps/web/dist')`) and `process.cwd()` fallbacks.
2. In packaged mode, `__dirname` resides inside the asar archive (`resources/app.asar/dist`), and `process.cwd()` is whatever directory the user launched the executable from (e.g. `C:\Program Files\OpenOb\` or desktop shortcut). Neither path pointed to a valid `index.html`.
3. `apps/desktop/electron-builder.json` previously placed `"../../apps/web/dist/**/*"` in the `files` list rather than using `extraResources`.
4. When the embedded Gateway started with an invalid `webDistPath`, requests to `GET /` could not find `index.html`.
5. Because `apps/gateway/src/server.ts` previously allowed static file misses to fall through into route dispatch without terminating the request, `GET /` fell through into token authentication. Lacking a Bearer token, the server returned:
   ```json
   {
     "code": "UNAUTHORIZED",
     "message": "Unauthorized: Missing or invalid authentication credentials"
   }
   ```

---

## 2. Technical Remediation

### 1. Deterministic Production Packaging via `extraResources` (`apps/desktop/electron-builder.json`)

Web application assets are now packaged into the standard Electron `resources/web/` directory:

```json
{
  "files": [
    "dist/**/*",
    "package.json",
    "node_modules/**/*",
    "../../apps/gateway/dist/**/*",
    "../../packages/*/dist/**/*"
  ],
  "extraResources": [
    {
      "from": "../web/dist",
      "to": "web",
      "filter": ["**/*"]
    }
  ]
}
```

### 2. Explicit `getWebDistPath()` Contract (`apps/desktop/src/main.ts`)

`getWebDistPath()` now provides deterministic resolution with fail-fast validation:

```typescript
function getWebDistPath(): string {
  if (app.isPackaged) {
    const packagedWeb = path.join(process.resourcesPath, 'web');
    if (!fs.existsSync(path.join(packagedWeb, 'index.html'))) {
      throw new Error(
        `OpenOb web application assets are missing from the desktop package (checked "${packagedWeb}").`
      );
    }
    return packagedWeb;
  }

  // Development mode: resolve monorepo apps/web/dist
  const devPaths = [
    path.resolve(__dirname, '../../../apps/web/dist'),
    path.resolve(__dirname, '../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.join(process.resourcesPath || '', 'web'),
  ];

  for (const devPath of devPaths) {
    if (fs.existsSync(path.join(devPath, 'index.html'))) {
      return devPath;
    }
  }

  throw new Error(
    `OpenOb web application assets not found in development paths. Please run 'npm run build:web'.`
  );
}
```

### 3. Static Route Containment & Anti-Fallthrough (`apps/gateway/src/server.ts`)

Static web delivery routes (`serveWeb: true` and `!pathname.startsWith('/api/')`) now strictly terminate with `200` (on hit) or `404 Not Found` (on miss / directory boundary). Static misses can **never** fall through into `/api/v1` token authorization.

### 4. Build Sequencing Enforcement (`package.json`)

The desktop packaging commands now enforce prerequisite compilation of the web frontend:

```json
{
  "package:desktop": "npm run build:web && npm run build:desktop && npm run pack --workspace=apps/desktop",
  "pack:desktop": "npm run build:web && npm run build:desktop && npm run pack --workspace=apps/desktop",
  "dist:desktop": "npm run build:web && npm run build:desktop && npm run dist --workspace=apps/desktop"
}
```

---

## 3. Verification & Evidence

### 1. Packaged Directory Structure

Inspection of `apps/desktop/release/win-unpacked/resources/web`:

- `index.html` (1,249 bytes)
- `assets/index-*.css` (21,037 bytes)
- `assets/index-*.js` (332,529 bytes)
- `assets/react-vendor-*.js` (173,286 bytes)
- `assets/codemirror-vendor-*.js` (506,286 bytes)
- `brand/openob-mark.png` (103,464 bytes)
- `brand/openob-mark-64.png` (7,855 bytes)
- `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`, `apple-touch-icon.png`

### 2. HTTP Probe Matrix Against Running Packaged Desktop Gateway

Verified in automated test `tests/e2e/desktop-electron.spec.ts`:

| Probe Endpoint               | Headers                   | Expected Status        | Result                                       |
| ---------------------------- | ------------------------- | ---------------------- | -------------------------------------------- |
| `GET /`                      | None (Unauthenticated)    | `200 text/html`        | ✅ Serves OpenOb HTML with `<div id="root">` |
| `GET /assets/index-*.js`     | None (Unauthenticated)    | `200 text/javascript`  | ✅ Serves production JS bundle               |
| `GET /favicon.ico`           | None (Unauthenticated)    | `200 image/x-icon`     | ✅ Serves Saint Jackass favicon              |
| `GET /brand/openob-mark.png` | None (Unauthenticated)    | `200 image/png`        | ✅ Serves transparent header mark            |
| `GET /api/v1/workspace`      | None (Unauthenticated)    | `401 UNAUTHORIZED`     | ✅ Strictly rejected                         |
| `GET /api/v1/workspace`      | `Bearer OPENOB_DESKTOP_*` | `200 application/json` | ✅ Authorized (`apiVersion: "v1"`)           |

### 3. Real Packaged Executable E2E Launch Verification

Playwright test `tests/e2e/desktop-electron.spec.ts` launched `release/win-unpacked/OpenOb.exe`:

- Verified `.app-container`, `.app-header`, `.app-logo`, `.logo-text` mounted in DOM.
- Verified window title is `OpenOb`.
- Negative assertion passed: `bodyText` does **not** contain `UNAUTHORIZED`, `Missing or invalid authentication credentials`, or raw JSON.
- Verified brand logo image renders cleanly with Saint Jackass mark.

### 4. Gate Summary

| Gate Step              | Command                | Result                                                 |
| ---------------------- | ---------------------- | ------------------------------------------------------ |
| ESLint                 | `npm run lint`         | ✅ 0 errors, 8 warnings                                |
| Type Check             | `npm run typecheck`    | ✅ 0 errors (`tsc --build`)                            |
| Vitest Integrity Suite | `npm test`             | ✅ **68 test files passed (429/429 tests)**            |
| Desktop Wrapper Tests  | `npm run test:desktop` | ✅ **2 test files passed (20/20 tests)**               |
| Playwright E2E Suite   | `npm run test:e2e`     | ✅ **38/38 tests passed**                              |
| Full Release Gate      | `npm run verify:full`  | ✅ **100% GREEN (Exit Code 0)**                        |
| Desktop Packaging      | `npm run pack:desktop` | ✅ `release/win-unpacked/OpenOb.exe` generated cleanly |

---

## 4. Conclusion

The packaged Electron desktop application now deterministically bundles and serves the web frontend from `resources/web/`. The application boots cleanly to the full React workspace UI on Windows with the canonical Saint Jackass branding intact and all API security boundaries fully enforced.
