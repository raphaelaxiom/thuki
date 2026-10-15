import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuickActions } from '../panels/QuickActions';

describe('QuickActions', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows a prompt preview and sends it', async () => {
    render(<QuickActions />);
    fireEvent.change(screen.getByLabelText('Selected text'), {
      target: { value: 'Hello world' },
    });
    const preview = screen.getByLabelText(
      'Prompt preview',
    ) as HTMLTextAreaElement;
    expect(preview.value).toContain('Summarise');
    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }));
    // The mocked invoke resolves, so the panel reports the send.
    await waitFor(() => {
      expect(screen.getByText('Sent: Summarise.')).toBeInTheDocument();
    });
  });

  it('redacts secrets in the preview when the filter is on', () => {
    render(<QuickActions />);
    fireEvent.change(screen.getByLabelText('Selected text'), {
      target: { value: 'key ghp_abcdefghij1234567890abcdefghij1234' },
    });
    const preview = screen.getByLabelText(
      'Prompt preview',
    ) as HTMLTextAreaElement;
    expect(preview.value).toContain('[REDACTED]');
    expect(screen.getByText(/github_token/)).toBeInTheDocument();
  });

  it('requires a selection', () => {
    render(<QuickActions />);
    expect(screen.getByText('Select some text first.')).toBeInTheDocument();
  });
});
