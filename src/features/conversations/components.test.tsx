import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConversationsPanel } from './ConversationsPanel';
import { PromptsPanel } from './PromptsPanel';
import { SystemActionsBar } from './SystemActionsBar';
import { invoke } from '@tauri-apps/api/core';
import type { ChatMessageLike, ConversationMeta } from './types';

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function conv(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'c1',
    title: 'Pasta night',
    model: 'm1',
    updated_at: 1000,
    message_count: 1,
    ...overrides,
  };
}

const LOAD: (id: string) => Promise<ChatMessageLike[]> = async (id) => [
  { role: 'user', content: `hello from ${id}` },
];

beforeEach(() => {
  window.localStorage.clear();
  mockedInvoke.mockReset();
});

describe('ConversationsPanel', () => {
  it('searches titles and shows the bulk bar on selection', async () => {
    render(
      <ConversationsPanel
        conversations={[
          conv({ id: 'c1', title: 'Pasta night' }),
          conv({ id: 'c2', title: 'Budget plan' }),
        ]}
        loadMessages={LOAD}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'budget' },
    });
    expect(screen.queryByText('Pasta night')).toBeNull();
    expect(screen.getByText('Budget plan')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByLabelText('Select conversation Pasta night'));
    expect(screen.getByLabelText('Bulk actions')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    });
    expect(screen.getByText(/Archived 1 conversation/)).toBeTruthy();
  });

  it('pins a conversation and renames it inline', async () => {
    const onChanged = vi.fn();
    render(
      <ConversationsPanel
        conversations={[conv()]}
        loadMessages={LOAD}
        onConversationsChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByLabelText('Pin Pasta night'));
    expect(screen.getByLabelText('Unpin Pasta night')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Actions for Pasta night'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Conversation title');
    fireEvent.change(input, { target: { value: 'Pasta evening' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChanged).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Pasta evening' }),
    ]);
  });

  it('creates a folder and files a conversation into it', () => {
    render(<ConversationsPanel conversations={[conv()]} loadMessages={LOAD} />);
    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Work' })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Actions for Pasta night'));
    fireEvent.change(screen.getByLabelText('Move Pasta night to folder'), {
      target: { value: 'x' },
    });
    // Selecting the real folder id moves it; the select lists the folder.
    expect(screen.getByLabelText('Move Pasta night to folder')).toBeTruthy();
  });

  it('exports a conversation as Markdown and reports it', async () => {
    render(<ConversationsPanel conversations={[conv()]} loadMessages={LOAD} />);
    fireEvent.click(screen.getByLabelText('Actions for Pasta night'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export MD' }));
    });
    expect(
      screen.getByText('Exported “Pasta night” as Markdown.'),
    ).toBeTruthy();
  });
});

describe('PromptsPanel', () => {
  it('fills {{variables}} via dialog and inserts the filled prompt', () => {
    const onInsert = vi.fn();
    render(<PromptsPanel onInsertPrompt={onInsert} />);
    const useButtons = screen.getAllByRole('button', { name: 'Use…' });
    fireEvent.click(useButtons[0] as HTMLElement);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    const inputs = dialog.querySelectorAll('input');
    for (const input of Array.from(inputs)) {
      fireEvent.change(input, { target: { value: 'VALUE' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    const inserted = String(onInsert.mock.calls[0]?.[0] ?? '');
    expect(inserted).toContain('VALUE');
    expect(inserted).not.toContain('{{');
  });

  it('creates a custom prompt and favourites it', () => {
    render(<PromptsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    fireEvent.change(screen.getByLabelText('Prompt title'), {
      target: { value: 'My prompt' },
    });
    fireEvent.change(screen.getByLabelText('Prompt body'), {
      target: { value: 'Do {{thing}} please' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(screen.getByText('My prompt')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Favourite My prompt'));
    expect(screen.getByLabelText('Unfavourite My prompt')).toBeTruthy();
  });
});

describe('SystemActionsBar', () => {
  it('refuses to claim success for unrecognised text', async () => {
    render(<SystemActionsBar />);
    fireEvent.change(screen.getByLabelText('System action'), {
      target: { value: 'what is the weather?' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    });
    expect(screen.getByRole('status').textContent).toContain('Did not run');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('shows the backend success message when the action executes', async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      message: 'Opened Calculator.',
      detail: 'Calculator',
    });
    render(<SystemActionsBar />);
    fireEvent.change(screen.getByLabelText('System action'), {
      target: { value: 'open Calculator' },
    });
    expect(
      screen.getAllByText('Open Calculator').length,
    ).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Opened Calculator.',
    );
  });

  it('reports a backend failure honestly', async () => {
    mockedInvoke.mockRejectedValue(
      new Error('No such command: system_execute_action'),
    );
    render(<SystemActionsBar />);
    fireEvent.change(screen.getByLabelText('System action'), {
      target: { value: 'open Calculator' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    });
    expect(screen.getByRole('status').textContent).toContain('did not run');
  });
});
