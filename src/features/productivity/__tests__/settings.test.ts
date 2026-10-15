import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAppearance,
  clampFontSize,
  defaultSettings,
  loadSettings,
  resolveSystemTheme,
  saveSettings,
} from '../settings';
import { STORAGE_KEYS } from '../storage';

describe('settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-veilura-theme');
    document.documentElement.removeAttribute('data-veilura-density');
  });

  it('defaults to telemetry off and filter on', () => {
    const defaults = defaultSettings();
    expect(defaults.privacy.telemetry).toBe(false);
    expect(defaults.contentFilterEnabled).toBe(true);
    expect(defaults.theme).toBe('system');
  });

  it('persists and loads settings', () => {
    const next = {
      ...defaultSettings(),
      theme: 'dark' as const,
      fontSizePx: 18,
    };
    saveSettings(next);
    expect(loadSettings().theme).toBe('dark');
    expect(loadSettings().fontSizePx).toBe(18);
  });

  it('never persists telemetry as on, even from crafted storage', () => {
    const crafted = {
      ...defaultSettings(),
      privacy: {
        ...defaultSettings().privacy,
        telemetry: true as unknown as false,
      },
    };
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(crafted));
    expect(loadSettings().privacy.telemetry).toBe(false);
    saveSettings(crafted);
    expect(loadSettings().privacy.telemetry).toBe(false);
  });

  it('applies theme, density, and font size to the document', () => {
    applyAppearance({
      ...defaultSettings(),
      theme: 'forest',
      density: 'compact',
      fontSizePx: 17,
    });
    expect(document.documentElement.getAttribute('data-veilura-theme')).toBe(
      'forest',
    );
    expect(document.documentElement.getAttribute('data-veilura-density')).toBe(
      'compact',
    );
    expect(
      document.documentElement.style.getPropertyValue('--veilura-font-size'),
    ).toBe('17px');
  });

  it('clamps font size', () => {
    expect(clampFontSize(5)).toBe(12);
    expect(clampFontSize(99)).toBe(22);
    expect(clampFontSize(16)).toBe(16);
    expect(clampFontSize(Number.NaN)).toBe(15);
  });

  it('resolves the system theme without throwing', () => {
    expect(['light', 'dark']).toContain(resolveSystemTheme());
  });
});
