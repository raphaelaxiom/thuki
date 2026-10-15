/**
 * Secret redaction for outbound prompts (frontend mirror of the Rust
 * `redact_text` in `src-tauri/src/productivity.rs`).
 *
 * Same contract: when enabled, known secret shapes are replaced with the
 * literal `[REDACTED]`; the preview reports kinds + counts, never the
 * secret values themselves.
 */

export interface RedactionHit {
  kind: string;
  count: number;
}

export interface RedactionResult {
  text: string;
  redacted: boolean;
  hits: RedactionHit[];
}

/** One redaction pattern: a global regex + its family name. */
interface RedactionPattern {
  kind: string;
  regex: RegExp;
}

/**
 * Keep in sync with the Rust side (same families, same replacement).
 * Assignment patterns redact only the value; the key name stays visible.
 */
const PATTERNS: RedactionPattern[] = [
  {
    kind: 'github_token',
    regex: /\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/g,
  },
  { kind: 'slack_token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws_access_key', regex: /\bAKIA[A-Z0-9]{16}\b/g },
  // Anthropic first: `sk-ant-…` also matches the `sk-…` shape.
  { kind: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { kind: 'openai_key', regex: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'google_api_key', regex: /\bAIza[A-Za-z0-9_-]{20,}/g },
  { kind: 'bearer_token', regex: /\bBearer [A-Za-z0-9_~+/.-]{8,}/g },
  {
    kind: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  },
  {
    kind: 'private_key',
    regex:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    kind: 'credential_assignment',
    // `api_key = "…"`, `token: abc…`, `password=…` — value only (group 1).
    regex:
      /\b(?:api_key|apikey|api-key|secret|token|password|passwd|auth_token)\s*["']?\s*[=:]\s*["']?([^\s"',;}]{4,})/gi,
  },
];

/**
 * Redacts secrets in `prompt`. The credential-assignment pattern keeps the
 * key name and redacts only the captured value; every other pattern
 * redacts the whole match.
 */
export function redactPrompt(
  prompt: string,
  enabled: boolean,
): RedactionResult {
  if (!enabled) {
    return { text: prompt, redacted: false, hits: [] };
  }
  // Collect non-overlapping matches across all patterns, then splice once
  // so one pattern's replacement can never be re-matched by another.
  interface Span {
    start: number;
    end: number;
    kind: string;
  }
  const spans: Span[] = [];
  for (const { kind, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      if (kind === 'credential_assignment') {
        const value = match[1];
        const valueIndex = match[0].indexOf(
          value,
          match[0].length - value.length,
        );
        spans.push({
          start: match.index + valueIndex,
          end: match.index + valueIndex + value.length,
          kind,
        });
      } else {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          kind,
        });
      }
      // Guard against zero-length matches looping forever.
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const span of spans) {
    if (kept.length > 0 && span.start < kept[kept.length - 1].end) continue;
    kept.push(span);
  }
  if (kept.length === 0) {
    return { text: prompt, redacted: false, hits: [] };
  }
  let out = '';
  let cursor = 0;
  const hits: RedactionHit[] = [];
  for (const span of kept) {
    out += prompt.slice(cursor, span.start) + '[REDACTED]';
    cursor = span.end;
    const hit = hits.find((h) => h.kind === span.kind);
    if (hit) hit.count += 1;
    else hits.push({ kind: span.kind, count: 1 });
  }
  out += prompt.slice(cursor);
  return { text: out, redacted: true, hits };
}

/** One-line preview: "Redacted 2 secrets (github_token ×1, …)". */
export function redactionSummary(result: RedactionResult): string {
  if (!result.redacted) return 'No secrets detected.';
  const total = result.hits.reduce((sum, h) => sum + h.count, 0);
  const parts = result.hits.map((h) => `${h.kind} ×${h.count}`).join(', ');
  return `Redacted ${total} secret${total === 1 ? '' : 's'} (${parts}).`;
}
