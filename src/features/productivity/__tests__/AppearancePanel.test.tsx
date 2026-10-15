import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppearancePanel } from '../panels/AppearancePanel';
import { loadSettings } from '../settings';

describe('AppearancePanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-veilura-theme');
  });

  it('switches theme and persists it', () => {
    render(<AppearancePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Forest' }));
    expect(loadSettings().theme).toBe('forest');
    expect(document.documentElement.getAttribute('data-veilura-theme')).toBe(
      'forest',
    );
  });

  it('changes font size and density', () => {
    render(<AppearancePanel />);
    fireEvent.change(screen.getByLabelText('Font size in pixels'), {
      target: { value: '18' },
    });
    expect(loadSettings().fontSizePx).toBe(18);
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(loadSettings().density).toBe('compact');
    expect(document.documentElement.getAttribute('data-veilura-density')).toBe(
      'compact',
    );
  });
});
