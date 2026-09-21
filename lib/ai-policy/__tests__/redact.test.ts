// lib/ai-policy/__tests__/redact.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_USER_TEXT_CHARS, redactUserText } from '../redact';

describe('redactUserText', () => {
  it.each([
    ['account number', 'What about 5WX12345 exposure?', '5WX12345'],
    ['long digit run', 'acct 123456789012 please', '123456789012'],
    ['email', 'send to trader@example.com now', 'trader@example.com'],
    ['bearer token', 'header Bearer abc123.DEF456-ghi789 leaked', 'abc123.DEF456-ghi789'],
    ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end', 'eyJhbGciOiJIUzI1NiJ9'],
    ['hex run', 'key 0123456789abcdef0123456789abcdef0123 ok', '0123456789abcdef0123456789abcdef'],
    ['base64 run', 'blob QWxhZGRpbjpvcGVuIHNlc2FtZVFXRVJUWVVJT1A= here', 'QWxhZGRpbjpvcGVuIHNlc2FtZQ'],
  ])('removes %s', (_name, text, secret) => {
    const result = redactUserText(text);
    expect(result.text).not.toContain(secret);
    expect(result.text).toContain('[redacted]');
    expect(result.redacted).toBe(true);
  });

  it('leaves ordinary questions alone', () => {
    const result = redactUserText('Why is this candidate not ready?');
    expect(result).toEqual({ text: 'Why is this candidate not ready?', truncated: false, redacted: false });
  });

  it('keeps short numbers and OCC-like symbols', () => {
    expect(redactUserText('What is the delta on the 2027 350 call?').redacted).toBe(false);
  });

  it('strips control and zero-width characters and collapses whitespace', () => {
    expect(redactUserText('a\u0000b\u200bc\n\n d\t e').text).toBe('abc d e');
  });

  it('enforces the length bound by code points', () => {
    const result = redactUserText('😀'.repeat(MAX_USER_TEXT_CHARS + 50));
    expect(Array.from(result.text).length).toBe(MAX_USER_TEXT_CHARS);
    expect(result.truncated).toBe(true);
  });

  it('handles empty and non-string input', () => {
    expect(redactUserText('   ').text).toBe('');
    expect(redactUserText(undefined as unknown as string).text).toBe('');
  });
});
