/**
 * Conversations panel: search, pin, folders, tags, rename, duplicate,
 * export (Markdown / JSON / print-to-PDF), import, archive, bulk actions.
 *
 * The panel owns its list state after mount (initialised from the
 * `conversations` prop) and reports every change through
 * `onConversationsChanged` / `onImportConversation` so the parent can
 * persist to SQLite. Organisation state (folders, pins, archive flags,
 * tags) lives in the localStorage store until the parent wires the
 * `conversations_ext.rs` backend commands.
 *
 * Full-text search covers titles immediately and message bodies once
 * `loadMessages` has loaded them (cached per conversation). Export,
 * duplicate, and bulk-export need `loadMessages`; those buttons are
 * disabled with an explanatory tooltip when it is absent rather than
 * exporting metadata disguised as a conversation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessageLike, ConversationMeta } from './types';
import {
  addFolder,
  addTag,
  allTags,
  deleteFolder,
  loadExtState,
  moveConversationToFolder,
  newId,
  removeTag,
  renameFolder,
  saveExtState,
  setArchived,
  setPinned,
  type ExtState,
} from './storage';
import {
  filterByArchived,
  filterByFolder,
  filterByTag,
  searchConversations,
  sortConversations,
} from './search';
import {
  conversationToJson,
  conversationToMarkdown,
  displayTitle,
  downloadTextFile,
  exportFilename,
  parseConversationImport,
  printConversation,
} from './exportImport';

export interface ConversationsPanelProps {
  /** Initial conversation list. The panel owns the list after mount. */
  readonly conversations: readonly ConversationMeta[];
  /** Loads messages for one conversation (search / export / duplicate). */
  readonly loadMessages?: (
    conversationId: string,
  ) => Promise<ChatMessageLike[]>;
  readonly onOpenConversation?: (conversationId: string) => void;
  readonly onConversationsChanged?: (next: ConversationMeta[]) => void;
  /** Fired for imported / duplicated conversations with their messages. */
  readonly onImportConversation?: (
    meta: ConversationMeta,
    messages: ChatMessageLike[],
  ) => void;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  fontFamily: 'inherit',
  color: 'inherit',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 8,
};

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

export function ConversationsPanel(props: ConversationsPanelProps) {
  const {
    loadMessages,
    onOpenConversation,
    onConversationsChanged,
    onImportConversation,
  } = props;
  const [list, setList] = useState<ConversationMeta[]>([
    ...props.conversations,
  ]);
  const [ext, setExt] = useState<ExtState>(() => loadExtState());
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string | 'all' | 'unfiled'>(
    'all',
  );
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [folderRenamingId, setFolderRenamingId] = useState<string | null>(null);
  const [folderRenameDraft, setFolderRenameDraft] = useState('');
  const [folderDeleteArmedId, setFolderDeleteArmedId] = useState<string | null>(
    null,
  );
  const [newFolderName, setNewFolderName] = useState('');
  const [tagDrafts, setTagDrafts] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [messagesCache, setMessagesCache] = useState<
    Readonly<Record<string, readonly ChatMessageLike[]>>
  >({});
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateExt = (next: ExtState) => {
    setExt(next);
    saveExtState(next);
  };

  const commitList = (next: ConversationMeta[]) => {
    setList(next);
    onConversationsChanged?.(next);
  };

  // Merged view: organisation state is the source of truth for
  // pinned / archived / folder / tags.
  const merged = useMemo<ConversationMeta[]>(
    () =>
      list.map((c) => ({
        ...c,
        pinned: ext.pinnedIds.includes(c.id),
        archived: ext.archivedIds.includes(c.id),
        folder_id: ext.folderByConversation[c.id] ?? null,
        tags: ext.tagsByConversation[c.id] ?? [],
      })),
    [list, ext],
  );

  // Load message bodies for full-text search when a query is typed.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || !loadMessages) return;
    let cancelled = false;
    void Promise.all(
      list.map(async (c) => {
        if (messagesCache[c.id]) return;
        try {
          const messages = await loadMessages(c.id);
          if (!cancelled) {
            setMessagesCache((prev) =>
              prev[c.id] ? prev : { ...prev, [c.id]: messages },
            );
          }
        } catch {
          // Search falls back to titles for conversations that fail to load.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [searchQuery, list, loadMessages, messagesCache]);

  const visible = useMemo(() => {
    let items = filterByArchived(merged, showArchived);
    items = filterByFolder(items, folderFilter);
    items = filterByTag(items, tagFilter);
    if (searchQuery.trim()) {
      return searchConversations(items, messagesCache, searchQuery).map(
        (hit) => ({ meta: hit.conversation, snippet: hit.snippets[0] }),
      );
    }
    return sortConversations(items).map((meta) => ({
      meta,
      snippet: undefined as string | undefined,
    }));
  }, [
    merged,
    showArchived,
    folderFilter,
    tagFilter,
    searchQuery,
    messagesCache,
  ]);

  const tags = useMemo(() => allTags(ext), [ext]);
  const selected = useMemo(
    () => merged.filter((c) => selectedIds.has(c.id)),
    [merged, selectedIds],
  );

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadMessagesOrWarn = async (
    id: string,
  ): Promise<ChatMessageLike[] | null> => {
    if (!loadMessages) {
      setStatus(
        'Message loading is not available, so this needs the parent to pass loadMessages.',
      );
      return null;
    }
    try {
      return await loadMessages(id);
    } catch {
      setStatus('Could not load messages for that conversation.');
      return null;
    }
  };

  const handleRenameCommit = (meta: ConversationMeta) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title || title === (meta.title ?? '')) return;
    commitList(list.map((c) => (c.id === meta.id ? { ...c, title } : c)));
    setStatus(`Renamed conversation to “${title}”.`);
  };

  const handleDuplicate = async (meta: ConversationMeta) => {
    const messages = await loadMessagesOrWarn(meta.id);
    if (!messages) return;
    const copy: ConversationMeta = {
      ...meta,
      id: newId(),
      title: `${displayTitle(meta)} (copy)`,
      updated_at: Date.now(),
      message_count: messages.length,
      pinned: false,
      archived: false,
    };
    commitList([copy, ...list]);
    onImportConversation?.(copy, messages);
    setStatus(`Duplicated “${displayTitle(meta)}” as “${displayTitle(copy)}”.`);
  };

  const handleDelete = (meta: ConversationMeta) => {
    commitList(list.filter((c) => c.id !== meta.id));
    updateExt(setArchived(setPinned(ext, meta.id, false), meta.id, false));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(meta.id);
      return next;
    });
    setStatus(`Deleted “${displayTitle(meta)}”.`);
  };

  const handleExport = async (
    meta: ConversationMeta,
    format: 'md' | 'json' | 'pdf',
  ) => {
    const messages = await loadMessagesOrWarn(meta.id);
    if (!messages) return;
    const data = { title: meta.title, model: meta.model, messages };
    if (format === 'md') {
      downloadTextFile(
        exportFilename(meta.title, 'md'),
        conversationToMarkdown(data),
        'text/markdown',
      );
      setStatus(`Exported “${displayTitle(meta)}” as Markdown.`);
    } else if (format === 'json') {
      downloadTextFile(
        exportFilename(meta.title, 'json'),
        conversationToJson(data),
        'application/json',
      );
      setStatus(`Exported “${displayTitle(meta)}” as JSON.`);
    } else {
      const opened = printConversation(data);
      setStatus(
        opened
          ? `Print dialog opened for “${displayTitle(meta)}” — choose “Save as PDF”.`
          : `Popup was blocked, so the print dialog could not open for “${displayTitle(meta)}”.`,
      );
    }
  };

  const handleBulk = async (
    action: 'delete' | 'archive' | 'unarchive' | 'md' | 'json',
  ) => {
    if (selected.length === 0) return;
    if (action === 'delete') {
      commitList(list.filter((c) => !selectedIds.has(c.id)));
      let next = ext;
      for (const c of selected) {
        next = setArchived(setPinned(next, c.id, false), c.id, false);
      }
      updateExt(next);
      setSelectedIds(new Set());
      setStatus(`Deleted ${selected.length} conversation(s).`);
      return;
    }
    if (action === 'archive' || action === 'unarchive') {
      let next = ext;
      for (const c of selected) {
        next = setArchived(next, c.id, action === 'archive');
      }
      updateExt(next);
      setSelectedIds(new Set());
      setStatus(
        action === 'archive'
          ? `Archived ${selected.length} conversation(s).`
          : `Unarchived ${selected.length} conversation(s).`,
      );
      return;
    }
    // Bulk export: needs message bodies.
    if (!loadMessages) {
      setStatus('Bulk export needs the parent to pass loadMessages.');
      return;
    }
    try {
      if (action === 'md') {
        const parts: string[] = [];
        for (const meta of selected) {
          const messages = await loadMessages(meta.id);
          parts.push(
            conversationToMarkdown({
              title: meta.title,
              model: meta.model,
              messages,
            }),
          );
        }
        downloadTextFile(
          `veilura-chats-${selected.length}.md`,
          parts.join('\n\n---\n\n'),
          'text/markdown',
        );
      } else {
        const payload = [];
        for (const meta of selected) {
          const messages = await loadMessages(meta.id);
          payload.push(
            JSON.parse(
              conversationToJson({
                title: meta.title,
                model: meta.model,
                messages,
              }),
            ) as unknown,
          );
        }
        downloadTextFile(
          `veilura-chats-${selected.length}.json`,
          JSON.stringify(payload, null, 2),
          'application/json',
        );
      }
      setStatus(`Exported ${selected.length} conversation(s).`);
      setSelectedIds(new Set());
    } catch {
      setStatus('Bulk export failed while loading messages.');
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseConversationImport(text, file.name);
      const meta: ConversationMeta = {
        id: newId(),
        title: parsed.title,
        model: parsed.model,
        updated_at: Date.now(),
        message_count: parsed.messages.length,
      };
      commitList([meta, ...list]);
      onImportConversation?.(meta, parsed.messages);
      setStatus(
        `Imported “${parsed.title ?? 'Untitled conversation'}” with ${parsed.messages.length} message(s).`,
      );
    } catch (error) {
      setStatus(
        `Import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const needsMessages = !loadMessages;
  const messagesHint = needsMessages
    ? 'Export and duplicate need message loading (parent passes loadMessages).'
    : undefined;

  return (
    <div style={panelStyle} data-testid="conversations-panel">
      <h2 style={{ margin: 0 }}>Conversations</h2>

      <input
        type="search"
        aria-label="Search conversations"
        placeholder="Search titles and messages…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid rgba(128,128,128,0.4)',
        }}
      />

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          aria-pressed={!showArchived}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          aria-pressed={showArchived}
        >
          Archived
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.json,application/json,text/markdown"
          hidden
          aria-label="Import conversation file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Folders */}
        <aside style={{ minWidth: 150 }} aria-label="Folders">
          <strong>Folders</strong>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 6,
            }}
          >
            <button
              type="button"
              onClick={() => setFolderFilter('all')}
              aria-pressed={folderFilter === 'all'}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFolderFilter('unfiled')}
              aria-pressed={folderFilter === 'unfiled'}
            >
              Unfiled
            </button>
            {ext.folders.map((folder) =>
              folderRenamingId === folder.id ? (
                <span key={folder.id} style={{ display: 'flex', gap: 4 }}>
                  <input
                    aria-label="Rename folder"
                    value={folderRenameDraft}
                    autoFocus
                    onChange={(e) => setFolderRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateExt(
                          renameFolder(ext, folder.id, folderRenameDraft),
                        );
                        setFolderRenamingId(null);
                      }
                      if (e.key === 'Escape') setFolderRenamingId(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateExt(
                        renameFolder(ext, folder.id, folderRenameDraft),
                      );
                      setFolderRenamingId(null);
                    }}
                  >
                    Save
                  </button>
                </span>
              ) : (
                <span
                  key={folder.id}
                  style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                >
                  <button
                    type="button"
                    onClick={() => setFolderFilter(folder.id)}
                    aria-pressed={folderFilter === folder.id}
                    style={{ flex: 1, textAlign: 'left' }}
                  >
                    {folder.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename folder ${folder.name}`}
                    onClick={() => {
                      setFolderRenamingId(folder.id);
                      setFolderRenameDraft(folder.name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={
                      folderDeleteArmedId === folder.id
                        ? `Confirm delete folder ${folder.name}`
                        : `Delete folder ${folder.name}`
                    }
                    onClick={() => {
                      if (folderDeleteArmedId === folder.id) {
                        updateExt(deleteFolder(ext, folder.id));
                        if (folderFilter === folder.id) setFolderFilter('all');
                        setFolderDeleteArmedId(null);
                      } else {
                        setFolderDeleteArmedId(folder.id);
                      }
                    }}
                  >
                    {folderDeleteArmedId === folder.id ? 'Confirm?' : '🗑'}
                  </button>
                </span>
              ),
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <input
              aria-label="New folder name"
              placeholder="New folder…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  updateExt(addFolder(ext, newFolderName));
                  setNewFolderName('');
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!newFolderName.trim()) return;
                updateExt(addFolder(ext, newFolderName));
                setNewFolderName('');
              }}
            >
              Add
            </button>
          </div>
        </aside>

        {/* List */}
        <div
          style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {tags.length > 0 && (
            <div
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
              aria-label="Filter by tag"
            >
              <span>Tags:</span>
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                aria-pressed={tagFilter === null}
              >
                All
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  aria-pressed={tagFilter === tag}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: 8,
                border: '1px solid rgba(128,128,128,0.4)',
                borderRadius: 8,
              }}
              aria-label="Bulk actions"
            >
              <span>{selectedIds.size} selected</span>
              <button type="button" onClick={() => void handleBulk('archive')}>
                Archive
              </button>
              <button
                type="button"
                onClick={() => void handleBulk('unarchive')}
              >
                Unarchive
              </button>
              <button type="button" onClick={() => void handleBulk('delete')}>
                Delete
              </button>
              <button
                type="button"
                disabled={needsMessages}
                title={messagesHint}
                onClick={() => void handleBulk('md')}
              >
                Export Markdown
              </button>
              <button
                type="button"
                disabled={needsMessages}
                title={messagesHint}
                onClick={() => void handleBulk('json')}
              >
                Export JSON
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          )}

          {visible.length === 0 && (
            <p>
              {showArchived
                ? 'No archived conversations.'
                : 'No conversations here. Import one, or start a chat and it will appear here.'}
            </p>
          )}

          {visible.map(({ meta, snippet }) => {
            const checked = selectedIds.has(meta.id);
            const expanded = expandedId === meta.id;
            return (
              <div key={meta.id} style={rowStyle}>
                <input
                  type="checkbox"
                  aria-label={`Select conversation ${displayTitle(meta)}`}
                  checked={checked}
                  onChange={() => toggleSelected(meta.id)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === meta.id ? (
                    <input
                      aria-label="Conversation title"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCommit(meta);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => handleRenameCommit(meta)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenConversation?.(meta.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: meta.pinned ? 700 : 400,
                        textAlign: 'left',
                        padding: 0,
                      }}
                      title={formatDate(meta.updated_at)}
                    >
                      {displayTitle(meta)}
                    </button>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {meta.message_count} message(s) ·{' '}
                    {formatDate(meta.updated_at)}
                    {meta.tags && meta.tags.length > 0 && (
                      <> · {meta.tags.map((t) => `#${t}`).join(' ')}</>
                    )}
                  </div>
                  {snippet && (
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                        fontStyle: 'italic',
                      }}
                    >
                      {snippet}
                    </div>
                  )}
                  {expanded && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                        marginTop: 6,
                      }}
                    >
                      <select
                        aria-label={`Move ${displayTitle(meta)} to folder`}
                        value={meta.folder_id ?? ''}
                        onChange={(e) =>
                          updateExt(
                            moveConversationToFolder(
                              ext,
                              meta.id,
                              e.target.value || null,
                            ),
                          )
                        }
                      >
                        <option value="">Unfiled</option>
                        {ext.folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Add tag to ${displayTitle(meta)}`}
                        placeholder="Add tag…"
                        value={tagDrafts[meta.id] ?? ''}
                        onChange={(e) =>
                          setTagDrafts((prev) => ({
                            ...prev,
                            [meta.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (
                            e.key === 'Enter' &&
                            (tagDrafts[meta.id] ?? '').trim()
                          ) {
                            updateExt(
                              addTag(ext, meta.id, tagDrafts[meta.id] ?? ''),
                            );
                            setTagDrafts((prev) => ({
                              ...prev,
                              [meta.id]: '',
                            }));
                          }
                        }}
                      />
                      {(meta.tags ?? []).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          aria-label={`Remove tag ${tag} from ${displayTitle(meta)}`}
                          onClick={() =>
                            updateExt(removeTag(ext, meta.id, tag))
                          }
                        >
                          #{tag} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={
                    meta.pinned
                      ? `Unpin ${displayTitle(meta)}`
                      : `Pin ${displayTitle(meta)}`
                  }
                  title={meta.pinned ? 'Unpin' : 'Pin'}
                  onClick={() =>
                    updateExt(setPinned(ext, meta.id, !meta.pinned))
                  }
                >
                  {meta.pinned ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  aria-label={`${meta.archived ? 'Unarchive' : 'Archive'} ${displayTitle(meta)}`}
                  onClick={() =>
                    updateExt(setArchived(ext, meta.id, !meta.archived))
                  }
                >
                  {meta.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  aria-label={`Actions for ${displayTitle(meta)}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : meta.id)}
                >
                  ⋯
                </button>
                {expanded && (
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(meta.id);
                        setRenameDraft(meta.title ?? '');
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={needsMessages}
                      title={messagesHint}
                      onClick={() => void handleDuplicate(meta)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      disabled={needsMessages}
                      title={messagesHint}
                      onClick={() => void handleExport(meta, 'md')}
                    >
                      Export MD
                    </button>
                    <button
                      type="button"
                      disabled={needsMessages}
                      title={messagesHint}
                      onClick={() => void handleExport(meta, 'json')}
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      disabled={needsMessages}
                      title={messagesHint}
                      onClick={() => void handleExport(meta, 'pdf')}
                    >
                      Export PDF
                    </button>
                    <button type="button" onClick={() => handleDelete(meta)}>
                      Delete
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div aria-live="polite" style={{ minHeight: 20, fontSize: 13 }}>
        {status}
      </div>
    </div>
  );
}
