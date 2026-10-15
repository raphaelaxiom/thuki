/**
 * Prompt library panel: built-in + custom prompts (CRUD), `{{variable}}`
 * templates filled via a dialog before sending, favourites, and an
 * insert-from-palette flow.
 *
 * `onInsertPrompt` receives the filled prompt text — the parent decides
 * what "insert" means (ask-bar input, clipboard, …). The "Copy" button
 * writes the filled text to the clipboard. Nothing is sent anywhere by
 * this panel itself.
 */

import { useMemo, useState } from 'react';
import type { PromptItem } from './types';
import {
  allPrompts,
  extractVariables,
  fillTemplate,
  filterPrompts,
  missingVariables,
  validatePrompt,
} from './prompts';
import {
  deleteCustomPrompt,
  loadExtState,
  newId,
  saveExtState,
  setPromptFavourite,
  upsertCustomPrompt,
  type ExtState,
} from './storage';

export interface PromptsPanelProps {
  /** Receives the filled prompt text when the user chooses Insert. */
  readonly onInsertPrompt?: (filledText: string) => void;
}

export function PromptsPanel(props: PromptsPanelProps) {
  const [ext, setExt] = useState<ExtState>(() => loadExtState());
  const [query, setQuery] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [usingPrompt, setUsingPrompt] = useState<PromptItem | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');

  const updateExt = (next: ExtState) => {
    setExt(next);
    saveExtState(next);
  };

  const prompts = useMemo(
    () => allPrompts(ext.customPrompts, ext.favouriteBuiltinIds),
    [ext.customPrompts, ext.favouriteBuiltinIds],
  );
  const visible = useMemo(
    () => filterPrompts(prompts, query, favouritesOnly),
    [prompts, query, favouritesOnly],
  );

  const startNew = () => {
    setEditingId('new');
    setTitleDraft('');
    setBodyDraft('');
    setFormError('');
  };

  const startEdit = (prompt: PromptItem) => {
    setEditingId(prompt.id);
    setTitleDraft(prompt.title);
    setBodyDraft(prompt.body);
    setFormError('');
  };

  const saveEditing = () => {
    const error = validatePrompt(titleDraft, bodyDraft);
    if (error) {
      setFormError(error);
      return;
    }
    if (editingId === 'new') {
      updateExt(
        upsertCustomPrompt(ext, {
          id: newId(),
          title: titleDraft.trim(),
          body: bodyDraft,
          favourite: false,
          builtin: false,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      );
      setStatus(`Created prompt “${titleDraft.trim()}”.`);
    } else if (editingId) {
      const existing = ext.customPrompts.find((p) => p.id === editingId);
      if (!existing) return;
      updateExt(
        upsertCustomPrompt(ext, {
          ...existing,
          title: titleDraft.trim(),
          body: bodyDraft,
        }),
      );
      setStatus(`Updated prompt “${titleDraft.trim()}”.`);
    }
    setEditingId(null);
  };

  const openUseDialog = (prompt: PromptItem) => {
    setUsingPrompt(prompt);
    setVariableValues({});
  };

  const variables = usingPrompt ? extractVariables(usingPrompt.body) : [];
  const filled = usingPrompt
    ? fillTemplate(usingPrompt.body, variableValues)
    : '';
  const missing = usingPrompt
    ? missingVariables(usingPrompt.body, variableValues)
    : [];

  const handleInsert = () => {
    if (!usingPrompt) return;
    if (missing.length > 0) {
      setStatus(`Fill in: ${missing.join(', ')}`);
      return;
    }
    props.onInsertPrompt?.(filled);
    setStatus(`Inserted prompt “${usingPrompt.title}”.`);
    setUsingPrompt(null);
  };

  const handleCopy = async () => {
    if (!usingPrompt) return;
    if (missing.length > 0) {
      setStatus(`Fill in: ${missing.join(', ')}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(filled);
      setStatus(`Copied prompt “${usingPrompt.title}”.`);
    } catch {
      setStatus('Could not copy to clipboard.');
    }
    setUsingPrompt(null);
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}
      data-testid="prompts-panel"
    >
      <h2 style={{ margin: 0 }}>Prompt library</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="search"
          aria-label="Search prompts"
          placeholder="Search prompts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.4)', flex: 1 }}
        />
        <button
          type="button"
          aria-pressed={favouritesOnly}
          onClick={() => setFavouritesOnly(!favouritesOnly)}
        >
          {favouritesOnly ? 'Show all' : 'Favourites only'}
        </button>
        <button type="button" onClick={startNew}>
          New prompt
        </button>
      </div>

      {editingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 8, padding: 12 }}>
          <input
            aria-label="Prompt title"
            placeholder="Title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
          />
          <textarea
            aria-label="Prompt body"
            placeholder="Prompt body — use {{variable}} for fill-in values"
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            rows={5}
          />
          {formError && <span role="alert">{formError}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={saveEditing}>
              {editingId === 'new' ? 'Create prompt' : 'Save prompt'}
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {visible.length === 0 && <p>No prompts match.</p>}

      {visible.map((prompt) => (
        <div
          key={prompt.id}
          style={{ border: '1px solid rgba(128,128,128,0.35)', borderRadius: 8, padding: 10 }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>{prompt.title}</strong>
            {prompt.builtin && <span style={{ fontSize: 12, opacity: 0.7 }}>(built-in)</span>}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              aria-label={prompt.favourite ? `Unfavourite ${prompt.title}` : `Favourite ${prompt.title}`}
              aria-pressed={prompt.favourite}
              onClick={() => updateExt(setPromptFavourite(ext, prompt, !prompt.favourite))}
            >
              {prompt.favourite ? '★' : '☆'}
            </button>
            <button type="button" onClick={() => openUseDialog(prompt)}>
              Use…
            </button>
            {!prompt.builtin && (
              <>
                <button type="button" onClick={() => startEdit(prompt)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateExt(deleteCustomPrompt(ext, prompt.id));
                    setStatus(`Deleted prompt “${prompt.title}”.`);
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: '8px 0 0' }}>
            {prompt.body}
          </pre>
        </div>
      ))}

      {usingPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fill in ${usingPrompt.title}`}
          style={{ border: '2px solid rgba(128,128,128,0.6)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <strong>Use “{usingPrompt.title}”</strong>
          {variables.length === 0 && (
            <p style={{ margin: 0 }}>This prompt has no variables — insert it as-is.</p>
          )}
          {variables.map((name) => (
            <label key={name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {name}
              <input
                aria-label={`Value for ${name}`}
                value={variableValues[name] ?? ''}
                onChange={(e) =>
                  setVariableValues((prev) => ({ ...prev, [name]: e.target.value }))
                }
              />
            </label>
          ))}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>{filled}</pre>
          {missing.length > 0 && (
            <span>Missing: {missing.join(', ')}</span>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleInsert}>
              Insert
            </button>
            <button type="button" onClick={() => void handleCopy()}>
              Copy
            </button>
            <button type="button" onClick={() => setUsingPrompt(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div aria-live="polite" style={{ minHeight: 20, fontSize: 13 }}>
        {status}
      </div>
    </div>
  );
}
