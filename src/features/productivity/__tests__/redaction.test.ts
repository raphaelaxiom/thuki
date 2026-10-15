import { describe, expect, it } from 'vitest';
import { redactPrompt, redactionSummary } from '../redaction';

describe('redactPrompt', () => {
  it('returns the prompt untouched when disabled', () => {
    const result = redactPrompt(
      'key ghp_abcdefghij1234567890abcdefghij1234',
      false,
    );
    expect(result.redacted).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.text).toContain('ghp_');
  });

  it('redacts a GitHub token and reports its kind', () => {
    const token = 'ghp_abcdefghij1234567890abcdefghij1234';
    const result = redactPrompt(`token ${token} here`, true);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('ghp_');
    expect(result.text).toContain('[REDACTED]');
    expect(result.hits).toEqual([{ kind: 'github_token', count: 1 }]);
  });

  it('redacts AWS, OpenAI, bearer, and Slack secrets in one prompt', () => {
    const result = redactPrompt(
      'AKIAIOSFODNN7EXAMPLE sk-abcdefghij1234567890abcdefghij1234 Bearer abcdefgh12345678 xoxb-123456789012-abcdefghij',
      true,
    );
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('AKIA');
    expect(result.text).not.toContain('sk-');
    expect(result.text).not.toContain('xoxb-');
    expect(result.hits).toHaveLength(4);
  });

  it('labels Anthropic keys correctly, not as OpenAI keys', () => {
    const result = redactPrompt(
      'key sk-ant-abcdefghij1234567890abcdefghij1234',
      true,
    );
    expect(result.hits).toEqual([{ kind: 'anthropic_key', count: 1 }]);
  });

  it('redacts only the value of a credential assignment', () => {
    const result = redactPrompt('api_key = "supersecretvalue"', true);
    expect(result.text).toContain('api_key');
    expect(result.text).not.toContain('supersecretvalue');
    expect(result.hits).toEqual([{ kind: 'credential_assignment', count: 1 }]);
  });

  it('does not redact prose without a separator or tiny values', () => {
    expect(redactPrompt('the token is abc', true).redacted).toBe(false);
    expect(redactPrompt('token: ab', true).redacted).toBe(false);
  });

  it('redacts a private-key block and a JWT', () => {
    const block =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----';
    const keyResult = redactPrompt(`key:\n${block}`, true);
    expect(keyResult.redacted).toBe(true);
    expect(keyResult.text).not.toContain('MIIBOgIBAAJBAK');
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactPrompt(`auth ${jwt}`, true).text).not.toContain('eyJ');
  });

  it('leaves clean text untouched', () => {
    const result = redactPrompt(
      'Hello, please summarise this paragraph.',
      true,
    );
    expect(result.redacted).toBe(false);
    expect(result.text).toBe('Hello, please summarise this paragraph.');
  });

  it('summarises hits', () => {
    const result = redactPrompt('ghp_abcdefghij1234567890abcdefghij1234', true);
    expect(redactionSummary(result)).toBe(
      'Redacted 1 secret (github_token ×1).',
    );
    expect(redactionSummary(redactPrompt('clean', true))).toBe(
      'No secrets detected.',
    );
  });
});
