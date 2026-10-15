import { describe, expect, it, vi } from 'vitest';
import {
  buildQuickActionPrompt,
  dispatchQuickAction,
  validateQuickAction,
} from '../quickActions';

describe('quick actions', () => {
  it('builds a real prompt quoting the selection for each action', () => {
    const summarise = buildQuickActionPrompt({
      kind: 'summarise',
      selection: 'Hello world',
    });
    expect(summarise).toContain('Summarise');
    expect(summarise).toContain('Hello world');

    const rewrite = buildQuickActionPrompt({
      kind: 'rewrite',
      selection: 'Hello world',
    });
    expect(rewrite).toContain('Rewrite');

    const translate = buildQuickActionPrompt({
      kind: 'translate',
      selection: 'Hello world',
      targetLanguage: 'Hindi',
    });
    expect(translate).toContain('Hindi');

    const explain = buildQuickActionPrompt({
      kind: 'explain',
      selection: 'Hello world',
    });
    expect(explain).toContain('plain language');
  });

  it('validates selection and language', () => {
    expect(
      validateQuickAction({ kind: 'summarise', selection: '  ' }),
    ).toContain('Select');
    expect(
      validateQuickAction({
        kind: 'translate',
        selection: 'hi',
        targetLanguage: '  ',
      }),
    ).toContain('language');
    expect(
      validateQuickAction({ kind: 'summarise', selection: 'ok' }),
    ).toBeNull();
  });

  it('dispatch returns true only when a listener handles the event', () => {
    // No listener: the event goes unhandled.
    expect(dispatchQuickAction('prompt', 'summarise')).toBe(false);
    // A listener that preventDefaults claims the event.
    const handler = (e: Event) => e.preventDefault();
    window.addEventListener('veilura:quick-action', handler);
    try {
      expect(dispatchQuickAction('prompt', 'summarise')).toBe(true);
    } finally {
      window.removeEventListener('veilura:quick-action', handler);
    }
    // A passive listener does not claim it.
    const passive = vi.fn();
    window.addEventListener('veilura:quick-action', passive);
    try {
      expect(dispatchQuickAction('prompt', 'summarise')).toBe(false);
      expect(passive).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('veilura:quick-action', passive);
    }
  });
});
