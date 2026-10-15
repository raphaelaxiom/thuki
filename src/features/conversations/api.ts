/**
 * Typed Tauri invoke wrappers for the backend commands in
 * `src-tauri/src/conversations_ext.rs` and `src-tauri/src/system_actions.rs`.
 *
 * The parent wires those modules into the invoke handler (see
 * INTEGRATION-conversations.md); until then these wrappers throw the
 * usual Tauri "unknown command" error, which callers surface honestly.
 * The panels in this folder work without the backend (localStorage
 * organisation state + `systemActions.executeSystemAction` for the
 * system-action path); this module is the typed seam the parent uses to
 * switch persistence to SQLite.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  ConversationMeta,
  ConversationFolder,
  PromptItem,
  SystemActionRequest,
  SystemActionResult,
} from './types';

export interface ExtConversationSummary extends ConversationMeta {
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly folder_id: string | null;
  readonly tags: readonly string[];
}

export interface ConversationExportPayload {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly messages: readonly { role: string; content: string }[];
}

export interface ImportConversationPayload {
  readonly title: string | null;
  readonly model: string;
  readonly messages: readonly { role: string; content: string }[];
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke(cmd, args) as Promise<T>;
}

/** Full-text search across titles + message bodies (SQLite LIKE). */
export function convSearch(
  query: string,
  includeArchived = false,
  folderId: string | null = null,
  tag: string | null = null,
): Promise<ExtConversationSummary[]> {
  return call('conv_ext_search', {
    query,
    includeArchived,
    folderId,
    tag,
  });
}

export function convSetPinned(
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  return call('conv_ext_set_pinned', { conversationId, pinned });
}

export function convSetArchived(
  conversationId: string,
  archived: boolean,
): Promise<void> {
  return call('conv_ext_set_archived', { conversationId, archived });
}

export function convRename(
  conversationId: string,
  title: string,
): Promise<void> {
  return call('conv_ext_rename', { conversationId, title });
}

export function convDuplicate(conversationId: string): Promise<string> {
  return call('conv_ext_duplicate', { conversationId });
}

export function convBulkArchive(
  conversationIds: string[],
  archived: boolean,
): Promise<number> {
  return call('conv_ext_bulk_archive', { conversationIds, archived });
}

export function convBulkDelete(conversationIds: string[]): Promise<number> {
  return call('conv_ext_bulk_delete', { conversationIds });
}

export function convExport(
  conversationId: string,
): Promise<ConversationExportPayload> {
  return call('conv_ext_export', { conversationId });
}

export function convImport(
  payload: ImportConversationPayload,
): Promise<string> {
  return call('conv_ext_import', { payload });
}

export function convListFolders(): Promise<ConversationFolder[]> {
  return call('conv_ext_list_folders');
}

export function convCreateFolder(name: string): Promise<ConversationFolder> {
  return call('conv_ext_create_folder', { name });
}

export function convRenameFolder(
  folderId: string,
  name: string,
): Promise<void> {
  return call('conv_ext_rename_folder', { folderId, name });
}

export function convDeleteFolder(folderId: string): Promise<void> {
  return call('conv_ext_delete_folder', { folderId });
}

export function convMoveToFolder(
  conversationId: string,
  folderId: string | null,
): Promise<void> {
  return call('conv_ext_move', { conversationId, folderId });
}

export function convAddTag(conversationId: string, tag: string): Promise<void> {
  return call('conv_ext_add_tag', { conversationId, tag });
}

export function convRemoveTag(
  conversationId: string,
  tag: string,
): Promise<void> {
  return call('conv_ext_remove_tag', { conversationId, tag });
}

export function convListPrompts(): Promise<PromptItem[]> {
  return call('conv_ext_list_prompts');
}

export function convUpsertPrompt(prompt: PromptItem): Promise<PromptItem> {
  return call('conv_ext_upsert_prompt', { prompt });
}

export function convDeletePrompt(promptId: string): Promise<void> {
  return call('conv_ext_delete_prompt', { promptId });
}

export function convSetPromptFavourite(
  promptId: string,
  favourite: boolean,
): Promise<void> {
  return call('conv_ext_set_prompt_favourite', { promptId, favourite });
}

/** Executes one structured system action via the Rust backend. */
export function systemExecuteAction(
  action: SystemActionRequest,
): Promise<SystemActionResult> {
  return call('system_execute_action', { action });
}

/** Parses free text into a structured action on the Rust side. */
export function systemParseAction(
  text: string,
): Promise<SystemActionRequest | null> {
  return call('system_parse_action', { text });
}
