/**
 * Robust HTML sanitizer for Markdown rendered content.
 * Strips dangerous tags (script, style, iframe, object, embed, link, meta, base),
 * removes inline event handlers, and decodes HTML entities to block
 * unquoted, mixed-case, entity-encoded, or data: pseudo-protocol injections (SEC-01).
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  let clean = rawHtml;

  // 1. Remove dangerous executable and navigation tags completely
  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'meta', 'base', 'form', 'link'];
  for (const tag of dangerousTags) {
    const tagRegex = new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>|<${tag}\\b[^>]*\\/?>`, 'gi');
    clean = clean.replace(tagRegex, '');
  }

  // 2. Remove all inline event handlers: on*="..." or on*='...' or on*=value
  clean = clean.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 3. Decode entities and sanitize href / src / action / formaction / xlink:href attributes
  // Matches href="..." or href='...' or href=unquoted
  const attrRegex = /(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  clean = clean.replace(attrRegex, (_match, attrName, valQuotedDouble, valQuotedSingle, valUnquoted) => {
    const rawVal = valQuotedDouble ?? valQuotedSingle ?? valUnquoted ?? '';
    
    // Decode HTML entities (e.g. &#106;, &#x6a;, &colon;, etc.) and strip control chars/whitespace
    const decodedVal = decodeHtmlEntities(rawVal).replace(/[\u0000-\u001F\s\t\r\n]/g, '').toLowerCase();

    // Check for dangerous URI protocols
    if (
      decodedVal.startsWith('javascript:') ||
      decodedVal.startsWith('vbscript:') ||
      decodedVal.startsWith('data:text/html') ||
      decodedVal.startsWith('data:text/javascript') ||
      decodedVal.startsWith('data:image/svg+xml')
    ) {
      return `${attrName}="#"`;
    }

    // Preserve clean attribute
    return `${attrName}="${rawVal.replace(/"/g, '&quot;')}"`;
  });

  return clean;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);?/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&colon;/gi, ':')
    .replace(/&Tab;/gi, '')
    .replace(/&NewLine;/gi, '');
}
