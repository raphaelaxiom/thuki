/**
 * Shared types for the conversations / prompts / system-actions feature set.
 *
 * These types are the contract between the panels in this folder, the
 * `api.ts` invoke wrappers, and the Rust modules `conversations_ext.rs` /
 * `system_actions.rs`. The Rust structs use the same field names (serde
 * snake_case) so JSON round-trips without renaming.
 */

/** One chat message, as the panels consume it (subset of `Message`). */
export interface ChatMessageLike {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

/**
 * Conversation list item. Extends the existing `ConversationSummary` shape
 * with the fields added by `conversations_ext.rs` (pinned / archived /
 * folder_id / tags). All four are optional so lists coming from the legacy
 * `list_conversations` command keep working.
 */
export interface ConversationMeta {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly updated_at: number;
  readonly message_count: number;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly folder_id?: string | null;
  readonly tags?: readonly string[];
}

/** A user-created folder that conversations can be filed into. */
export interface ConversationFolder {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
}

/** A prompt in the prompt library (built-in or custom). */
export interface PromptItem {
  readonly id: string;
  /** Short label shown in the palette / library list. */
  readonly title: string;
  /** Prompt body. May contain `{{variable}}` placeholders. */
  readonly body: string;
  readonly favourite: boolean;
  /** Built-ins ship with the app and cannot be edited or deleted. */
  readonly builtin: boolean;
  readonly created_at: number;
  readonly updated_at: number;
}

/** Structured system action. Never a shell string. */
export type SystemActionRequest =
  | { readonly kind: 'open_app'; readonly app: string }
  | {
      readonly kind: 'create_file';
      readonly filename: string;
      readonly content: string;
      readonly location: 'desktop' | 'documents' | 'app_data';
    }
  | { readonly kind: 'open_url'; readonly url: string }
  | { readonly kind: 'reveal_in_finder'; readonly path: string }
  | {
      readonly kind: 'create_note';
      readonly title: string;
      readonly content: string;
    };

/** Result of executing a system action. `ok === true` means it executed. */
export interface SystemActionResult {
  readonly ok: boolean;
  /** Exact report: what executed (app name / exact file path) or why not. */
  readonly message: string;
  /** Machine-usable detail, e.g. the created file path or resolved app. */
  readonly detail?: string;
}

/** A conversation plus its messages, as produced by import / export. */
export interface ConversationExportData {
  readonly title: string | null;
  readonly model: string;
  readonly messages: readonly ChatMessageLike[];
}
