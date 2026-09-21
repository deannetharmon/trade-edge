// lib/ai-policy/redact.ts
//
// Bounds and redacts user chat text before provider dispatch. Removes account-number-shaped strings, emails,
// bearer/JWT tokens, and >= 32-character hex/base64 runs, strips control characters, and enforces the length bound.
// User text is untrusted data, never instructions.

export const MAX_USER_TEXT_CHARS = 500;
const MARK = '[redacted]';

const PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /[A-Fa-f0-9]{32,}/g,
  /[A-Za-z0-9+/_-]{32,}={0,2}/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\b\d[A-Za-z]{2}\d{5}\b/g,
  /\b\d{8,17}\b/g,
];

export interface RedactionResult {
  text: string;
  truncated: boolean;
  redacted: boolean;
}

export function redactUserText(input: string): RedactionResult {
  let text = String(input ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let redacted = false;
  for (const pattern of PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return MARK;
    });
  }
  const chars = Array.from(text);
  const truncated = chars.length > MAX_USER_TEXT_CHARS;
  if (truncated) text = chars.slice(0, MAX_USER_TEXT_CHARS).join('').trim();
  return { text, truncated, redacted };
}
