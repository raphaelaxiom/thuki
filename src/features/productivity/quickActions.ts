/**
 * Quick actions: one-click actions on a selection.
 *
 * Each action builds the exact prompt that is sent through the existing
 * chat pipeline (see `dispatchQuickAction` + INTEGRATION). The prompt is
 * real text the model can answer — no stub, no fake response.
 */

import type { QuickActionKind, QuickActionRequest } from './types';

export const QUICK_ACTION_LABELS: Record<QuickActionKind, string> = {
  summarise: 'Summarise',
  rewrite: 'Rewrite',
  translate: 'Translate',
  explain: 'Explain',
};

/**
 * Builds the prompt sent to the model for a quick action. The selection
 * is quoted verbatim inside the prompt so the model works on exactly what
 * the user selected.
 */
export function buildQuickActionPrompt(request: QuickActionRequest): string {
  const selection = request.selection.trim();
  switch (request.kind) {
    case 'summarise':
      return `Summarise the following text concisely, keeping all key facts and numbers. Do not add information that is not in the text.\n\n"""\n${selection}\n"""`;
    case 'rewrite':
      return `Rewrite the following text to be clearer and more concise. Keep the original meaning, facts, and tone. Do not add new information.\n\n"""\n${selection}\n"""`;
    case 'translate':
      return `Translate the following text into ${request.targetLanguage?.trim() || 'English'}. Keep the meaning, formatting, and any names or numbers unchanged.\n\n"""\n${selection}\n"""`;
    case 'explain':
      return `Explain the following text in plain language. Define any jargon or abbreviations, and give a short example where that helps understanding. Do not add facts beyond what is needed to explain it.\n\n"""\n${selection}\n"""`;
  }
}

export function validateQuickAction(
  request: QuickActionRequest,
): string | null {
  if (request.selection.trim() === '') return 'Select some text first.';
  if (request.selection.length > 20000) {
    return 'Selection is too long (max 20,000 characters).';
  }
  if (
    request.kind === 'translate' &&
    (request.targetLanguage?.trim() ?? '') === ''
  ) {
    return 'Enter a target language.';
  }
  return null;
}

/**
 * Dispatches a quick action to the chat pipeline. The parent wires the
 * `veilura:quick-action` window event (or the `submit_quick_action` Tauri
 * command) to the existing send path — see INTEGRATION-productivity.md.
 * Returns true when a listener handled the event (by calling
 * `preventDefault()` on the cancelable event).
 */
export function dispatchQuickAction(
  prompt: string,
  kind: QuickActionKind,
): boolean {
  try {
    const event = new CustomEvent('veilura:quick-action', {
      detail: { kind, prompt },
      cancelable: true,
    });
    return !window.dispatchEvent(event);
  } catch {
    return false;
  }
}

/** Copies the prompt so the user can paste it into chat as a fallback. */
export async function copyQuickActionPrompt(prompt: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch {
    return false;
  }
}
