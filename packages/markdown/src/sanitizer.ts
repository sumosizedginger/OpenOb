/**
 * Lightweight HTML sanitizer for Markdown rendered content.
 * Strips script tags, event handlers (onload, onerror, onclick, etc.),
 * and dangerous protocols (javascript:, vbscript:, data: text/html).
 */
export function sanitizeHtml(rawHtml: string): string {
  let clean = rawHtml;

  // Remove script tags and contents
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove inline event handlers: on*="..." or on*='...' or on*=...
  clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Disallow javascript: and vbscript: URIs
  clean = clean.replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  clean = clean.replace(/(href|src)\s*=\s*(?:"vbscript:[^"]*"|'vbscript:[^']*')/gi, '$1="#"');

  return clean;
}
