import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RemindersPanel } from '../panels/RemindersPanel';
import { loadReminders } from '../reminders';

describe('RemindersPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adds a reminder and marks it done', () => {
    render(<RemindersPanel />);
    fireEvent.change(screen.getByLabelText('Reminder title'), {
      target: { value: 'Call back' },
    });
    fireEvent.change(screen.getByLabelText('Due time'), {
      target: { value: '2026-10-17T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));
    expect(screen.getByText('Call back')).toBeInTheDocument();
    expect(loadReminders()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(loadReminders()[0].done).toBe(true);
  });

  it('fills the title from a pasted message', () => {
    render(<RemindersPanel />);
    fireEvent.change(screen.getByLabelText('Source message'), {
      target: { value: 'Follow up with QUDI\nabout the bot' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Use message as title' }),
    );
    expect(screen.getByLabelText('Reminder title')).toHaveValue(
      'Follow up with QUDI',
    );
  });

  it('rejects an empty title', () => {
    render(<RemindersPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));
    expect(
      screen.getByText('Enter a title and a valid due time.'),
    ).toBeInTheDocument();
    expect(loadReminders()).toHaveLength(0);
  });
});
