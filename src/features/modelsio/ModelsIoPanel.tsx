/**
 * Composite panel assembling the Models / Input / Output sections.
 *
 * The parent mounts this panel (or the routes in `routes.tsx`) inside the
 * main window. All callbacks below are local by default: insert-text and
 * attach-file update the panel's own draft state, and regenerate reuses the
 * displayed reply. When the parent wires the panel into the real chat
 * surface, it passes the real ask-bar / chat callbacks instead — the
 * sections themselves need no changes.
 */

import { useCallback, useState } from 'react';
import { ModelsSection } from './ModelsSection';
import { InputSection } from './InputSection';
import { OutputSection } from './OutputSection';
import type { AttachedFile, ModelMeta } from './types';

export const DEMO_MODELS: ModelMeta[] = [
  {
    id: 'qwen3.5-9b',
    displayName: 'Qwen 3.5 9B',
    sizeBytes: 5_800_000_000,
    paramsB: 9,
    contextLength: 32768,
    quant: 'Q4_K_M',
    vision: false,
    downloaded: true,
    notes: '',
  },
  {
    id: 'gemma-4-12b',
    displayName: 'Gemma 4 12B',
    sizeBytes: 7_400_000_000,
    paramsB: 12,
    contextLength: 32768,
    quant: 'Q4_K_M',
    vision: true,
    downloaded: true,
    notes: '',
  },
  {
    id: 'gpt-oss-20b',
    displayName: 'GPT-OSS 20B',
    sizeBytes: 12_500_000_000,
    paramsB: 20,
    contextLength: 131072,
    quant: 'Q4_K_M',
    vision: false,
    downloaded: false,
    notes: '',
  },
];

interface ModelsIoPanelProps {
  models?: ModelMeta[];
  /** Whether the active model supports vision (gates image attach). */
  modelVision?: boolean;
  /** Initial assistant reply for the Output section. */
  initialReply?: string;
  /** Real regenerate implementation (parent chat); defaults to echo. */
  onRegenerate?: () => Promise<string>;
  /** Real stop implementation (parent chat). */
  onStop?: () => void;
}

export function ModelsIoPanel({
  models = DEMO_MODELS,
  modelVision = false,
  initialReply = 'Hello — this is the current assistant reply.',
  onRegenerate,
  onStop,
}: ModelsIoPanelProps) {
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<AttachedFile[]>([]);
  const [reply, setReply] = useState(initialReply);

  const handleInsertText = useCallback((text: string) => {
    setDraft((prev) => (prev === '' ? text : `${prev}\n${text}`));
  }, []);

  const handleAttachFile = useCallback((file: AttachedFile) => {
    setAttached((prev) => [...prev, file]);
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (onRegenerate) return onRegenerate();
    const next = `${reply} (regenerated variant)`;
    setReply(next);
    return next;
  }, [onRegenerate, reply]);

  return (
    <div>
      <h1>Models, Input &amp; Output</h1>
      <p>
        Draft: {draft === '' ? '(empty)' : draft} · Attached: {attached.length} file(s)
      </p>
      <ModelsSection initialModels={models} />
      <InputSection
        modelVision={modelVision}
        onInsertText={handleInsertText}
        onAttachFile={handleAttachFile}
      />
      <OutputSection
        replyText={reply}
        conversationKey="modelsio-panel"
        engineUsage={null}
        onRegenerate={handleRegenerate}
        onStop={onStop ?? (() => undefined)}
      />
    </div>
  );
}
