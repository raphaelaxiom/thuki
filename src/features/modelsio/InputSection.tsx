/**
 * Input section (features 7–12): clipboard history, drag-and-drop files,
 * image attach with vision gating, screenshot capture + crop, screenshot
 * annotate, voice dictation.
 *
 * The parent passes `onInsertText` / `onAttachFile` so captured content
 * lands in the real ask bar. Screenshot capture uses the backend command
 * when wired; crop/annotate run on a real canvas so the attached image is
 * the edited image, not the original.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canAttachImage,
  classifyAttachedFile,
  dictationAvailability,
  isValidAnnotation,
  MAX_CLIPBOARD_HISTORY,
  normalizeCropRect,
  pushClipboardHistory,
  validateAttachment,
} from './pure';
import type {
  AttachedFile,
  Annotation,
  ClipboardEntry,
  CropRect,
} from './types';
import {
  loadClipboardHistory,
  saveClipboardHistory,
} from './store';
import {
  captureScreenshotBackend,
  dictateBackend,
  readClipboardBackend,
} from './backend';

interface InputSectionProps {
  /** Whether the active model supports vision (feature 9 gating). */
  modelVision: boolean;
  /** Insert text into the ask bar (clipboard history / dictation). */
  onInsertText: (text: string) => void;
  /** Attach a prepared file to the pending message. */
  onAttachFile: (file: AttachedFile) => void;
}

function fileFromBlob(
  name: string,
  mimeType: string,
  sizeBytes: number,
  kind: AttachedFile['kind'],
  textContent?: string,
  dataUrl?: string,
): AttachedFile {
  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    sizeBytes,
    mimeType,
    kind,
    textContent,
    dataUrl,
  };
}

export function InputSection({ modelVision, onInsertText, onAttachFile }: InputSectionProps) {
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>(() => loadClipboardHistory());
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [shotStatus, setShotStatus] = useState<string | null>(null);
  const [dictation, setDictation] = useState('');
  const [dictationStatus, setDictationStatus] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    saveClipboardHistory(clipboard);
  }, [clipboard]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const rememberClipboard = useCallback((text: string) => {
    setClipboard((prev) => pushClipboardHistory(prev, text));
  }, []);

  const onReadClipboard = useCallback(async () => {
    try {
      const text = await readClipboardBackend();
      if (text.trim() === '') {
        setClipStatus('Clipboard is empty.');
        return;
      }
      rememberClipboard(text);
      onInsertText(text);
      setClipStatus('Clipboard text inserted into the ask bar.');
    } catch {
      // Backend not wired / denied: fall back to the web clipboard API.
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim() === '') {
          setClipStatus('Clipboard is empty.');
          return;
        }
        rememberClipboard(text);
        onInsertText(text);
        setClipStatus('Clipboard text inserted into the ask bar (web clipboard).');
      } catch {
        setClipStatus(
          'Clipboard access was denied. Grant clipboard permission, or copy the text and paste it manually.',
        );
      }
    }
  }, [onInsertText, rememberClipboard]);

  const readFile = useCallback(
    async (file: File): Promise<AttachedFile | null> => {
      const kind = classifyAttachedFile(file.name, file.type);
      const error = validateAttachment({ name: file.name, sizeBytes: file.size, mimeType: file.type });
      if (error) {
        setAttachStatus(error);
        return null;
      }
      if (kind === 'text') {
        const textContent = await file.text();
        return fileFromBlob(file.name, file.type, file.size, kind, textContent);
      }
      if (kind === 'image') {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(file);
        });
        return fileFromBlob(file.name, file.type, file.size, kind, undefined, dataUrl);
      }
      return fileFromBlob(file.name, file.type, file.size, kind);
    },
    [],
  );

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const attached = await readFile(file);
        if (!attached) continue;
        setAttachments((prev) => [...prev, attached]);
        onAttachFile(attached);
      }
      if (list.length > 0) setAttachStatus(`${list.length} file(s) attached.`);
    },
    [onAttachFile, readFile],
  );

  const visionGate = canAttachImage(modelVision);

  const onCaptureScreenshot = useCallback(async () => {
    try {
      const base64 = await captureScreenshotBackend();
      if (base64 === null) {
        setShotStatus('Screenshot cancelled.');
        return;
      }
      setScreenshot(`data:image/png;base64,${base64}`);
      setShotStatus('Screenshot captured — crop or annotate it, then attach.');
    } catch {
      setShotStatus(
        'Screenshot capture needs the wired models_io backend (macOS screencapture). See INTEGRATION-modelsio.md.',
      );
    }
  }, []);

  const onDictate = useCallback(async () => {
    const availability = dictationAvailability({
      hasBackend: true, // attempted first; failure falls through to Web Speech
      hasWebSpeech:
        typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    });
    if (availability.path === 'none') {
      setDictationStatus('Dictation is unavailable: no speech recogniser on this system.');
      return;
    }
    setListening(true);
    try {
      const text = await dictateBackend();
      setDictation(text);
      onInsertText(text);
      setDictationStatus('Dictated via macOS speech recognition.');
    } catch {
      // Web Speech API fallback — one real working path in the browser.
      const Ctor =
        (window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      if (typeof Ctor !== 'function') {
        setDictationStatus('Dictation is unavailable: no speech recogniser on this system.');
        setListening(false);
        return;
      }
      try {
        const recognition = new (Ctor as new () => {
          lang: string;
          interimResults: boolean;
          onresult: ((e: { results: { transcript: string }[][] }) => void) | null;
          onerror: ((e: unknown) => void) | null;
          onend: (() => void) | null;
          start: () => void;
          stop: () => void;
        })();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognitionRef.current = recognition;
        recognition.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((r) => r[0]?.transcript ?? '')
            .join(' ');
          setDictation(transcript);
          onInsertText(transcript);
          setDictationStatus('Dictated via Web Speech API (browser fallback).');
          setListening(false);
        };
        recognition.onerror = () => {
          setDictationStatus('Dictation failed — microphone or recogniser error.');
          setListening(false);
        };
        recognition.onend = () => setListening(false);
        recognition.start();
      } catch {
        setDictationStatus('Dictation failed to start.');
        setListening(false);
      }
    }
  }, [onInsertText]);

  return (
    <section aria-label="Input">
      <h2>Input</h2>

      <div>
        <h3>Clipboard history</h3>
        <button type="button" onClick={() => void onReadClipboard()}>
          Read clipboard
        </button>{' '}
        {clipStatus && <span role="status">{clipStatus}</span>}
        <p>Last {MAX_CLIPBOARD_HISTORY} clipboard texts — click one to insert it.</p>
        <ul>
          {clipboard.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => onInsertText(entry.text)}>
                {entry.text.slice(0, 80)}
                {entry.text.length > 80 ? '…' : ''}
              </button>
            </li>
          ))}
        </ul>
        {clipboard.length === 0 && <p>No clipboard history yet.</p>}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFiles(e.dataTransfer.files);
        }}
        style={dragOver ? { outline: '2px dashed currentColor' } : undefined}
      >
        <h3>Attach files</h3>
        <p>{dragOver ? 'Drop files here' : 'Drag files onto this area, or choose files:'}</p>
        <input
          type="file"
          multiple
          aria-label="Choose files to attach"
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
          }}
        />
        {attachStatus && <p role="status">{attachStatus}</p>}
        <ul>
          {attachments.map((file) => (
            <li key={file.id}>
              {file.name} — {file.kind}
              {file.kind === 'text' && file.textContent !== undefined && (
                <> — {file.textContent.length} chars of text included</>
              )}
              {file.kind === 'image' && file.dataUrl && (
                <img src={file.dataUrl} alt={`Preview of ${file.name}`} width={64} />
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3>Image attach</h3>
        {!visionGate.allowed ? (
          <p role="status">{visionGate.reason}</p>
        ) : (
          <p>Vision model active — attached images are sent as vision context.</p>
        )}
        <input
          type="file"
          accept="image/*"
          aria-label="Attach an image"
          disabled={!visionGate.allowed}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFiles([file]);
          }}
        />
      </div>

      <div>
        <h3>Screenshot</h3>
        <button type="button" onClick={() => void onCaptureScreenshot()}>
          Capture screenshot
        </button>{' '}
        {shotStatus && <span role="status">{shotStatus}</span>}
        {screenshot && (
          <ScreenshotCropAnnotate
            dataUrl={screenshot}
            onAttach={(dataUrl) => {
              const attached = fileFromBlob(
                'screenshot.png',
                'image/png',
                Math.round((dataUrl.length * 3) / 4),
                'image',
                undefined,
                dataUrl,
              );
              onAttachFile(attached);
              setShotStatus('Screenshot attached as vision context.');
            }}
          />
        )}
      </div>

      <div>
        <h3>Voice dictation</h3>
        <button type="button" onClick={() => void onDictate()} disabled={listening}>
          {listening ? 'Listening…' : 'Start dictation'}
        </button>{' '}
        {dictationStatus && <span role="status">{dictationStatus}</span>}
        {dictation !== '' && <p>Heard: {dictation}</p>}
      </div>
    </section>
  );
}

/**
 * Screenshot crop + annotate (features 10–11). The user drags on the
 * canvas to define a crop rect, optionally draws arrows / places text,
 * then attaches the resulting image. All edits happen on a real canvas;
 * the attached data URL is the edited image.
 */
export function ScreenshotCropAnnotate({
  dataUrl,
  onAttach,
}: {
  dataUrl: string;
  onAttach: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [tool, setTool] = useState<'arrow' | 'text'>('arrow');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState('Look here');
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const loadImage = useCallback(
    () =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = dataUrl;
      }),
    [dataUrl],
  );

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const img = await loadImage();
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      for (const a of annotations) {
        if (!isValidAnnotation(a)) continue;
        if (a.kind === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(a.x1, a.y1);
          ctx.lineTo(a.x2, a.y2);
          ctx.stroke();
        } else {
          ctx.font = '24px sans-serif';
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, a.x, a.y);
        }
      }
    } catch {
      // Canvas preview unavailable (e.g. jsdom): numeric crop still works.
    }
  }, [annotations, loadImage]);

  useEffect(() => {
    void redraw();
  }, [redraw, dataUrl]);

  const canvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = imageSize.width / Math.max(1, rect.width);
    const scaleY = imageSize.height / Math.max(1, rect.height);
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const onAttachCropped = useCallback(async () => {
    const canvas = canvasRef.current;
    const normalized = normalizeCropRect(crop, imageSize.width, imageSize.height);
    if (!canvas || !normalized) {
      onAttach(dataUrl);
      return;
    }
    try {
      const img = await loadImage();
      const out = document.createElement('canvas');
      out.width = normalized.width;
      out.height = normalized.height;
      const ctx = out.getContext('2d');
      if (!ctx) {
        onAttach(dataUrl);
        return;
      }
      ctx.drawImage(
        img,
        normalized.x,
        normalized.y,
        normalized.width,
        normalized.height,
        0,
        0,
        normalized.width,
        normalized.height,
      );
      // Re-apply annotations shifted into crop coordinates.
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      for (const a of annotations) {
        if (!isValidAnnotation(a)) continue;
        if (a.kind === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(a.x1 - normalized.x, a.y1 - normalized.y);
          ctx.lineTo(a.x2 - normalized.x, a.y2 - normalized.y);
          ctx.stroke();
        } else {
          ctx.font = '24px sans-serif';
          ctx.fillStyle = a.color;
          ctx.fillText(a.text, a.x - normalized.x, a.y - normalized.y);
        }
      }
      onAttach(out.toDataURL('image/png'));
    } catch {
      onAttach(dataUrl);
    }
  }, [annotations, crop, dataUrl, imageSize, loadImage, onAttach]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        aria-label="Screenshot to crop and annotate"
        style={{ maxWidth: '100%' }}
        onMouseDown={(e) => setDrawStart(canvasPos(e))}
        onMouseUp={(e) => {
          if (!drawStart) return;
          const end = canvasPos(e);
          if (tool === 'arrow') {
            setAnnotations((prev) => [
              ...prev,
              { kind: 'arrow', x1: drawStart.x, y1: drawStart.y, x2: end.x, y2: end.y, color: '#ff0000' },
            ]);
          } else {
            setAnnotations((prev) => [
              ...prev,
              { kind: 'text', x: drawStart.x, y: drawStart.y, text: noteText, color: '#ff0000' },
            ]);
          }
          setDrawStart(null);
        }}
      />
      <div>
        <label>
          Crop X{' '}
          <input
            type="number"
            aria-label="Crop X"
            value={crop.x}
            onChange={(e) => setCrop((c: CropRect) => ({ ...c, x: Number(e.target.value) }))}
          />
        </label>{' '}
        <label>
          Crop Y{' '}
          <input
            type="number"
            aria-label="Crop Y"
            value={crop.y}
            onChange={(e) => setCrop((c: CropRect) => ({ ...c, y: Number(e.target.value) }))}
          />
        </label>{' '}
        <label>
          Crop width{' '}
          <input
            type="number"
            aria-label="Crop width"
            value={crop.width}
            onChange={(e) => setCrop((c: CropRect) => ({ ...c, width: Number(e.target.value) }))}
          />
        </label>{' '}
        <label>
          Crop height{' '}
          <input
            type="number"
            aria-label="Crop height"
            value={crop.height}
            onChange={(e) => setCrop((c: CropRect) => ({ ...c, height: Number(e.target.value) }))}
          />
        </label>
      </div>
      <div>
        <label>
          Annotation tool{' '}
          <select value={tool} onChange={(e) => setTool(e.target.value as 'arrow' | 'text')}>
            <option value="arrow">Arrow (drag on image)</option>
            <option value="text">Text (click on image)</option>
          </select>
        </label>{' '}
        <label>
          Annotation text{' '}
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} />
        </label>{' '}
        <span>
          {annotations.length} annotation(s) — draw on the image, then attach.
        </span>
      </div>
      <button type="button" onClick={() => void onAttachCropped()}>
        Attach edited screenshot
      </button>{' '}
      <button type="button" onClick={() => setAnnotations([])}>
        Clear annotations
      </button>
    </div>
  );
}
