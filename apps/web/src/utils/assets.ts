/**
 * Resolves a public asset path against Vite's configured BASE_URL (import.meta.env.BASE_URL).
 * Ensures compatibility across local dev (/), Electron packaging (./), and GitHub Pages (/OpenOb/).
 */
export function getPublicAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `${cleanBase}${cleanPath}`;
}
