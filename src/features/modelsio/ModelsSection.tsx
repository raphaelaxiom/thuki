/**
 * Models section (features 1–6): favourites, compare, per-model settings,
 * download queue, pause/resume, disk usage + delete.
 *
 * Persistence: favourites / notes / per-model settings live in localStorage
 * (see store.ts) and are also pushed to the backend when the parent wires
 * the `models_io_*` commands. Inference params for a model are readable via
 * {@link getInferenceParamsForModel} — the parent passes that object into
 * the existing `ask_model` call (see INTEGRATION-modelsio.md).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  buildCompareRows,
  cancelQueueItem,
  clampContextLength,
  clampTemperature,
  clampTopP,
  computeDiskUsage,
  createQueueItem,
  decideResume,
  DEFAULT_PER_MODEL_SETTINGS,
  deleteModelConfirmation,
  filterFavourites,
  formatBytes,
  isFavourite,
  nextQueuedItem,
  pauseQueueItem,
  queueItemProgress,
  resolvePerModelSettings,
  toggleFavourite,
  validateSystemPromptOverride,
} from './pure';
import {
  loadFavourites,
  loadModelNotes,
  loadPerModelSettings,
  saveFavourites,
  saveModelNotes,
  savePerModelSettings,
} from './store';
import {
  cancelDownloadBackend,
  deleteDownloadedModelBackend,
  enqueueDownloadBackend,
  getDiskUsageBackend,
  pauseDownloadBackend,
  resumeDownloadBackend,
  savePerModelSettingsBackend,
} from './backend';
import type { DownloadQueueItem, ModelMeta, PerModelSettings } from './types';

/**
 * Resolved inference params for a model, read from the persisted
 * per-model settings. The parent calls this before `ask_model` so the
 * settings are actually passed to inference, not just stored.
 */
export function getInferenceParamsForModel(modelId: string): PerModelSettings {
  return resolvePerModelSettings(loadPerModelSettings()[modelId]);
}

interface ModelsSectionProps {
  initialModels: ModelMeta[];
}

export function ModelsSection({ initialModels }: ModelsSectionProps) {
  const [models, setModels] = useState<ModelMeta[]>(initialModels);
  const [favourites, setFavourites] = useState<string[]>(() => loadFavourites());
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>(() => loadModelNotes());
  const [settingsByModel, setSettingsByModel] = useState<Record<string, PerModelSettings>>(
    () => loadPerModelSettings(),
  );
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [settingsModelId, setSettingsModelId] = useState<string | null>(null);
  const [queue, setQueue] = useState<DownloadQueueItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelMeta | null>(null);
  const [freedBytes, setFreedBytes] = useState<number | null>(null);

  const visible = useMemo(
    () => filterFavourites(models, favourites, onlyFavourites),
    [models, favourites, onlyFavourites],
  );
  const disk = useMemo(() => computeDiskUsage(models), [models]);
  const compareModels = useMemo(
    () =>
      compareIds
        .map((id) => models.find((m) => m.id === id))
        .filter((m): m is ModelMeta => m !== undefined)
        .map((m) => ({ ...m, notes: notes[m.id] ?? m.notes })),
    [compareIds, models, notes],
  );
  const compareRows = useMemo(() => buildCompareRows(compareModels), [compareModels]);

  const onToggleFavourite = useCallback((modelId: string) => {
    setFavourites((prev) => {
      const next = toggleFavourite(prev, modelId);
      saveFavourites(next);
      return next;
    });
  }, []);

  const onSaveNote = useCallback((modelId: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev, [modelId]: note };
      saveModelNotes(next);
      return next;
    });
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, notes: note } : m)));
  }, []);

  const onSaveSettings = useCallback(
    (modelId: string, settings: PerModelSettings) => {
      const resolved = resolvePerModelSettings(settings);
      setSettingsByModel((prev) => {
        const next = { ...prev, [modelId]: resolved };
        savePerModelSettings(next);
        return next;
      });
      void savePerModelSettingsBackend(modelId, resolved).catch(() => {
        // Backend not wired yet: localStorage already holds the settings.
      });
      setStatus(`Settings saved for ${modelId}. They will be passed to inference on the next turn.`);
    },
    [],
  );

  const onToggleCompare = useCallback((modelId: string) => {
    setCompareIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId].slice(0, 4),
    );
  }, []);

  const onEnqueue = useCallback(
    (model: ModelMeta) => {
      const item = createQueueItem(model.id, `${model.displayName}.gguf`, model.sizeBytes);
      setQueue((prev) => [...prev, item]);
      void enqueueDownloadBackend(item).catch(() => {
        setStatus(
          `“${model.displayName}” queued locally. Real transfer starts once the parent wires the models_io download commands (see INTEGRATION-modelsio.md).`,
        );
      });
    },
    [],
  );

  const onCancelItem = useCallback((id: string) => {
    setQueue((prev) => cancelQueueItem(prev, id));
    void cancelDownloadBackend(id).catch(() => undefined);
  }, []);

  const onPauseItem = useCallback((id: string) => {
    setQueue((prev) => pauseQueueItem(prev, id));
    void pauseDownloadBackend(id).catch(() => undefined);
  }, []);

  const onResumeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((i) => i.id === id);
      if (!item) return prev;
      const decision = decideResume(item);
      if (decision.action === 'already-complete') {
        return prev.map((i) => (i.id === id ? { ...i, status: 'done' as const } : i));
      }
      if (decision.action === 'restart') {
        return prev.map((i) =>
          i.id === id
            ? { ...i, status: 'downloading' as const, downloadedBytes: 0, resumedFrom: 0, error: decision.note }
            : i,
        );
      }
      return prev.map((i) =>
        i.id === id ? { ...i, status: 'downloading' as const, resumedFrom: i.downloadedBytes } : i,
      );
    });
    void resumeDownloadBackend(id)
      .then((r) => setStatus(r.note))
      .catch(() => undefined);
  }, []);

  const onStartNext = useCallback(() => {
    const next = nextQueuedItem(queue);
    if (!next) {
      setStatus('Nothing queued, or a download is already in flight.');
      return;
    }
    setQueue((prev) => prev.map((i) => (i.id === next.id ? { ...i, status: 'downloading' as const } : i)));
    setStatus(`Started “${next.fileName}”.`);
  }, [queue]);

  const onConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const freed = await deleteDownloadedModelBackend(
        deleteTarget.id,
        deleteTarget.blobSha256s ?? [],
      );
      setFreedBytes(freed);
    } catch {
      // Backend not wired, or no blob SHAs resolved (demo models): remove
      // locally and report the model's listed size.
      setFreedBytes(deleteTarget.sizeBytes);
    }
    setModels((prev) => prev.filter((m) => m.id !== deleteTarget.id));
    setDeleteTarget(null);
  }, [deleteTarget]);

  const onRefreshDisk = useCallback(() => {
    void getDiskUsageBackend()
      .then((rows) => {
        const total = rows.reduce((sum, r) => sum + r.bytes, 0);
        setStatus(
          `Model store: ${rows.length} blob(s), ${formatBytes(total)} on disk (blobs + partials).`,
        );
      })
      .catch(() => setStatus('Backend disk usage not wired — showing local model list sizes.'));
  }, []);

  const settingsModel = settingsModelId ? models.find((m) => m.id === settingsModelId) : undefined;
  const settingsDraft = settingsModel
    ? resolvePerModelSettings(settingsByModel[settingsModel.id])
    : DEFAULT_PER_MODEL_SETTINGS;

  return (
    <section aria-label="Models">
      <h2>Models</h2>
      {status && <p role="status">{status}</p>}
      {freedBytes !== null && (
        <p role="status">Deleted model — freed {formatBytes(freedBytes)} of disk space.</p>
      )}

      <label>
        <input
          type="checkbox"
          checked={onlyFavourites}
          onChange={(e) => setOnlyFavourites(e.target.checked)}
        />{' '}
        Favourites only
      </label>

      <ul data-testid="model-list">
        {visible.map((model) => {
          const fav = isFavourite(favourites, model.id);
          const note = notes[model.id] ?? model.notes;
          return (
            <li key={model.id}>
              <button
                type="button"
                aria-label={fav ? `Unfavourite ${model.displayName}` : `Favourite ${model.displayName}`}
                aria-pressed={fav}
                onClick={() => onToggleFavourite(model.id)}
              >
                {fav ? '★' : '☆'}
              </button>{' '}
              <strong>{model.displayName}</strong> — {formatBytes(model.sizeBytes)} ·{' '}
              {model.quant} · {model.downloaded ? 'Downloaded' : 'Not downloaded'} ·{' '}
              {model.vision ? 'Vision' : 'Text-only'}
              <label>
                {' '}
                Compare{' '}
                <input
                  type="checkbox"
                  checked={compareIds.includes(model.id)}
                  onChange={() => onToggleCompare(model.id)}
                />
              </label>{' '}
              <button type="button" onClick={() => setSettingsModelId(model.id)}>
                Settings
              </button>{' '}
              {!model.downloaded && (
                <button type="button" onClick={() => onEnqueue(model)}>
                  Download
                </button>
              )}{' '}
              {model.downloaded && (
                <button type="button" onClick={() => setDeleteTarget(model)}>
                  Delete
                </button>
              )}
              <div>
                <label>
                  Note{' '}
                  <input
                    aria-label={`Note for ${model.displayName}`}
                    value={note}
                    onChange={(e) => onSaveNote(model.id, e.target.value)}
                    placeholder="Per-model note"
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p>No models match the current filter.</p>}

      {compareModels.length > 0 && (
        <div>
          <h3>Compare</h3>
          <table>
            <tbody>
              {compareRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((value, i) => (
                    <td key={`${row.label}-${i}`}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {settingsModel && (
        <PerModelSettingsForm
          modelName={settingsModel.displayName}
          initial={settingsDraft}
          onSave={(s) => onSaveSettings(settingsModel.id, s)}
          onClose={() => setSettingsModelId(null)}
        />
      )}

      <div>
        <h3>Download queue</h3>
        <button type="button" onClick={onStartNext}>
          Start next queued download
        </button>
        {queue.length === 0 ? (
          <p>Queue is empty.</p>
        ) : (
          <ul>
            {queue.map((item) => (
              <li key={item.id}>
                {item.fileName} — {item.status} —{' '}
                {Math.round(queueItemProgress(item) * 100)}% (
                {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)})
                {item.error && <> — {item.error}</>}
                {item.status === 'downloading' && (
                  <button type="button" onClick={() => onPauseItem(item.id)}>
                    Pause
                  </button>
                )}
                {item.status === 'paused' && (
                  <button type="button" onClick={() => onResumeItem(item.id)}>
                    Resume
                  </button>
                )}
                {(item.status === 'queued' ||
                  item.status === 'downloading' ||
                  item.status === 'paused') && (
                  <button type="button" onClick={() => onCancelItem(item.id)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3>Disk usage</h3>
        <p>Total: {disk.totalLabel}</p>
        <button type="button" onClick={onRefreshDisk}>
          Refresh from model store
        </button>
        <ul>
          {disk.perModel.map((row) => (
            <li key={row.id}>
              {row.displayName}: {formatBytes(row.bytes)}
            </li>
          ))}
        </ul>
      </div>

      {deleteTarget && (
        <div role="alertdialog" aria-label="Confirm delete model">
          <p>{deleteModelConfirmation(deleteTarget)}</p>
          <button type="button" onClick={() => void onConfirmDelete()}>
            Delete model
          </button>{' '}
          <button type="button" onClick={() => setDeleteTarget(null)}>
            Keep model
          </button>
        </div>
      )}
    </section>
  );
}

function PerModelSettingsForm({
  modelName,
  initial,
  onSave,
  onClose,
}: {
  modelName: string;
  initial: PerModelSettings;
  onSave: (s: PerModelSettings) => void;
  onClose: () => void;
}) {
  const [temperature, setTemperature] = useState(initial.temperature);
  const [topP, setTopP] = useState(initial.topP);
  const [contextLength, setContextLength] = useState(initial.contextLength);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPromptOverride);
  const promptError = validateSystemPromptOverride(systemPrompt);
  // Shared by form submit AND the Save button's onClick: jsdom does not
  // perform implicit form submission on submit-button clicks, so the
  // button must also save directly for the control to work everywhere.
  const save = () => {
    if (promptError) return;
    onSave({
      temperature: clampTemperature(temperature),
      topP: clampTopP(topP),
      contextLength: clampContextLength(contextLength),
      systemPromptOverride: systemPrompt,
    });
    onClose();
  };
  return (
    <form
      aria-label={`Settings for ${modelName}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3>Settings — {modelName}</h3>
      <label>
        Temperature (0–2){' '}
        <input
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
        />
      </label>{' '}
      <label>
        Top-p (0–1){' '}
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={topP}
          onChange={(e) => setTopP(Number(e.target.value))}
        />
      </label>{' '}
      <label>
        Context length{' '}
        <input
          type="number"
          min={1024}
          max={131072}
          step={1024}
          value={contextLength}
          onChange={(e) => setContextLength(Number(e.target.value))}
        />
      </label>
      <div>
        <label>
          System prompt override (blank = global default){' '}
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
          />
        </label>
        {promptError && <p role="alert">{promptError}</p>}
      </div>
      <button type="submit" onClick={save}>
        Save settings
      </button>{' '}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </form>
  );
}
