import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentFilterPanel } from '../panels/ContentFilterPanel';
import { loadSettings } from '../settings';

describe('ContentFilterPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the redacted preview for the sample prompt', () => {
    render(<ContentFilterPanel />);
    expect(screen.getByText(/Redacted 1 secret/)).toBeInTheDocument();
    expect(screen.getByText(/github_token/)).toBeInTheDocument();
  });

  it('shows the raw secret when the filter is off', () => {
    render(<ContentFilterPanel />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(loadSettings().contentFilterEnabled).toBe(false);
    expect(screen.getByText(/No secrets detected/)).toBeInTheDocument();
  });

  it('redacts a pasted secret live', () => {
    render(<ContentFilterPanel />);
    fireEvent.change(screen.getByLabelText('Sample prompt'), {
      target: { value: 'key AKIAIOSFODNN7EXAMPLE' },
    });
    expect(screen.getByText(/aws_access_key/)).toBeInTheDocument();
  });
});
