/**
 * Output section (features 13–18): read-aloud / TTS, copy code blocks,
 * regenerate variants, token/cost stats, citations, stop generation.
 *
 * Regeneration is real: the parent supplies `onRegenerate`, which issues a
 * fresh inference turn for the same prompt. This component keeps every
 * variant and lets the user switch between them. Token stats come from the
 * engine's reported usage (never invented) via props or the backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addVariant,
  clampTtsRate,
  clampVariantIndex,
  computeTokenStats,
  extractCodeBlocks,
  formatTokenStats,
  isSafeCitationUrl,
  parseCitations,
  sanitizeTtsText,
} from './pure';
import type { ReplyVariant, TokenStats } from './types';
import {
  loadTokenTotals,
  loadTtsSettings,
  loadVariants,
  saveTokenTotals,
  saveTtsSettings,
  saveVariants,
} from './store';
import {
  getLastTokenStatsBackend,
  speakBackend,
  stopGenerationBackend,
  stopSpeakingBackend,
} from './backend';

interface OutputSectionProps {
  /** The assistant reply currently displayed. */
  replyText: string;
  /** Stable key for this conversation (variants persist per conversation). */
  conversationKey: string;
  /** Engine-reported usage for the current reply, when available. */
  engineUsage: { promptTokens: number; completionTokens: number; elapsedMs: number } | null;
  /** Issue a fresh inference turn for the same prompt; resolves to the new reply. */
  onRegenerate: () => Promise<string>;
  /** Called when the user stops generation (parent aborts its request too). */
  onStop: () => void;
  /** AbortSignal the parent's in-flight request listens to (optional). */
  abortSignal?: AbortSignal | null;
}

export function OutputSection({
  replyText,
  conversationKey,
  engineUsage,
  onRegenerate,
  onStop,
}: OutputSectionProps) {
  const [variants, setVariants] = useState<ReplyVariant[]>(() => loadVariants(conversationKey));
  const [variantIndex, setVariantIndex] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [regenStatus, setRegenStatus] = useState<string | null>(null);
  const [tts, setTts] = useState(() => loadTtsSettings());
  const [speaking, setSpeaking] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);
  const [tokenTotals, setTokenTotals] = useState(() => loadTokenTotals());
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const localAbortRef = useRef<AbortController | null>(null);

  const displayed = variants.length > 0 ? variants[clampVariantIndex(variants, variantIndex)].content : replyText;

  useEffect(() => {
    saveVariants(conversationKey, variants);
  }, [conversationKey, variants]);

  useEffect(() => {
    saveTokenTotals(tokenTotals);
  }, [tokenTotals]);

  useEffect(() => {
    saveTtsSettings(tts);
  }, [tts]);

  // Refresh token stats whenever a new reply / usage arrives.
  useEffect(() => {
    const apply = (usage: { promptTokens: number; completionTokens: number; elapsedMs: number }) => {
      setTokenTotals((prev) => {
        const next = {
          totalPromptTokens: prev.totalPromptTokens + usage.promptTokens,
          totalCompletionTokens: prev.totalCompletionTokens + usage.completionTokens,
        };
        setStats(
          computeTokenStats({
            ...usage,
            totalPromptTokens: next.totalPromptTokens,
            totalCompletionTokens: next.totalCompletionTokens,
          }),
        );
        return next;
      });
    };
    if (engineUsage) {
      apply(engineUsage);
      return;
    }
    void getLastTokenStatsBackend()
      .then((backendStats) => {
        if (!backendStats) return;
        setStats(backendStats);
        setTokenTotals({
          totalPromptTokens: backendStats.totalPromptTokens,
          totalCompletionTokens: backendStats.totalCompletionTokens,
        });
      })
      .catch(() => undefined);
  }, [engineUsage]);

  const onSpeak = useCallback(async () => {
    const clean = sanitizeTtsText(displayed);
    if (clean === '') {
      setTtsStatus('Nothing to read aloud.');
      return;
    }
    setSpeaking(true);
    try {
      await speakBackend(clean, tts.voice, clampTtsRate(tts.rate));
      setTtsStatus('Reading aloud via macOS speech.');
    } catch {
      // Browser fallback: Web Speech synthesis.
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(clean);
        utter.rate = clampTtsRate(tts.rate);
        utter.onend = () => setSpeaking(false);
        utter.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utter);
        setTtsStatus('Reading aloud via browser speech synthesis (fallback).');
      } catch {
        setTtsStatus('Read-aloud is unavailable on this system.');
        setSpeaking(false);
      }
    }
  }, [displayed, tts]);

  const onStopSpeaking = useCallback(async () => {
    try {
      await stopSpeakingBackend();
    } catch {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // No synthesis to cancel.
      }
    }
    setSpeaking(false);
    setTtsStatus('Speech stopped.');
  }, []);

  const onPauseSpeaking = useCallback(() => {
    try {
      window.speechSynthesis.pause();
      setTtsStatus('Speech paused.');
    } catch {
      setTtsStatus('Pause is not supported by the current speech path.');
    }
  }, []);

  const onResumeSpeaking = useCallback(() => {
    try {
      window.speechSynthesis.resume();
      setTtsStatus('Speech resumed.');
    } catch {
      setTtsStatus('Resume is not supported by the current speech path.');
    }
  }, []);

  const onRegenerateClick = useCallback(async () => {
    setRegenerating(true);
    setRegenStatus(null);
    try {
      const next = await onRegenerate();
      setVariants((prev) =>
        addVariant(prev, {
          id: `var-${Date.now().toString(36)}`,
          content: next,
          createdAt: Date.now(),
          promptTokens: 0,
          completionTokens: 0,
          elapsedMs: 0,
        }),
      );
      // The new variant lands at the end (capped at 10); point the selector at it.
      setVariantIndex(Math.min(variants.length, 9));
      setRegenStatus('New variant added — switch between variants below.');
    } catch {
      setRegenStatus('Regeneration failed. Try again.');
    } finally {
      setRegenerating(false);
    }
  }, [onRegenerate, variants.length]);

  const onStopGeneration = useCallback(async () => {
    localAbortRef.current?.abort();
    try {
      await stopGenerationBackend();
    } catch {
      // Backend not wired: local abort + parent callback still stop the UI.
    }
    onStop();
    setStopped(true);
  }, [onStop]);

  const onCopyCode = useCallback(async (code: string, label: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }, []);

  const codeBlocks = extractCodeBlocks(displayed);
  const { citations } = parseCitations(displayed);

  return (
    <section aria-label="Output">
      <h2>Output</h2>

      <div>
        <h3>Read aloud</h3>
        <label>
          Voice (macOS name, blank = default){' '}
          <input
            aria-label="TTS voice"
            value={tts.voice}
            onChange={(e) => setTts((p) => ({ ...p, voice: e.target.value }))}
          />
        </label>{' '}
        <label>
          Speed{' '}
          <input
            type="number"
            aria-label="TTS speed"
            min={0.5}
            max={2}
            step={0.1}
            value={tts.rate}
            onChange={(e) => setTts((p) => ({ ...p, rate: clampTtsRate(Number(e.target.value)) }))}
          />
        </label>{' '}
        <button type="button" onClick={() => void onSpeak()} disabled={speaking}>
          Speak reply
        </button>{' '}
        <button type="button" onClick={() => void onStopSpeaking()}>
          Stop speech
        </button>{' '}
        <button type="button" onClick={onPauseSpeaking}>
          Pause speech
        </button>{' '}
        <button type="button" onClick={onResumeSpeaking}>
          Resume speech
        </button>
        {ttsStatus && <p role="status">{ttsStatus}</p>}
      </div>

      <div>
        <h3>Reply</h3>
        <p>{displayed}</p>
        {codeBlocks.length > 0 && (
          <div>
            <h4>Code blocks</h4>
            <ul>
              {codeBlocks.map((block, i) => (
                <li key={i}>
                  <span>{block.language}</span>{' '}
                  <button
                    type="button"
                    onClick={() => void onCopyCode(block.code, `code-${i}`)}
                  >
                    {copied === `code-${i}` ? 'Copied' : 'Copy code'}
                  </button>
                  <pre>{block.code}</pre>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <h3>Regenerate</h3>
        <button type="button" onClick={() => void onRegenerateClick()} disabled={regenerating}>
          {regenerating ? 'Regenerating…' : 'Regenerate reply'}
        </button>{' '}
        {regenStatus && <span role="status">{regenStatus}</span>}
        {variants.length > 0 && (
          <div>
            <label>
              Variant{' '}
              <select
                aria-label="Reply variant"
                value={clampVariantIndex(variants, variantIndex)}
                onChange={(e) => setVariantIndex(Number(e.target.value))}
              >
                {variants.map((v, i) => (
                  <option key={v.id} value={i}>
                    Variant {i + 1} ({new Date(v.createdAt).toLocaleTimeString()})
                  </option>
                ))}
              </select>
            </label>{' '}
            <span>
              Showing variant {clampVariantIndex(variants, variantIndex) + 1} of {variants.length}
            </span>
          </div>
        )}
      </div>

      <div>
        <h3>Token stats</h3>
        {stats ? (
          <p>{formatTokenStats(stats)}</p>
        ) : (
          <p>The engine reported no usage numbers for this reply — nothing is shown rather than invented figures.</p>
        )}
      </div>

      <div>
        <h3>Sources</h3>
        {citations.length === 0 ? (
          <p>No sources cited in this reply.</p>
        ) : (
          <ol>
            {citations.map((c) => (
              <li key={c.index}>
                {isSafeCitationUrl(c.url) ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    [{c.index}] {c.title}
                  </a>
                ) : (
                  <span>
                    [{c.index}] {c.title} (unsafe URL — not linked)
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h3>Generation</h3>
        <button type="button" onClick={() => void onStopGeneration()}>
          Stop generation
        </button>{' '}
        {stopped && <span role="status">Generation stopped.</span>}
      </div>
    </section>
  );
}
