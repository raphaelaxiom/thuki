/**
 * Productivity settings: defaults, persistence, and applying appearance
 * (theme / font size / density) to the document.
 */

import type { DensityId, ProductivitySettings, ThemeId } from './types';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

export const THEME_LABELS: Record<ThemeId, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
  forest: 'Forest',
  sunset: 'Sunset',
};

export const DENSITY_LABELS: Record<DensityId, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
};

export const FONT_SIZE_MIN_PX = 12;
export const FONT_SIZE_MAX_PX = 22;
export const FONT_SIZE_DEFAULT_PX = 15;

export function defaultSettings(): ProductivitySettings {
  return {
    theme: 'system',
    fontSizePx: FONT_SIZE_DEFAULT_PX,
    density: 'comfortable',
    privacy: {
      clipboardCapture: false,
      // ON by default: the screenshot button is a pre-existing core
      // feature, and an explicit click is consent. The toggle exists so
      // users can turn capture off; defaulting it off would silently
      // kill the button for every user.
      screenCapture: true,
      webSearch: true,
      telemetry: false,
    },
    contentFilterEnabled: true,
    focus: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 },
  };
}

export function loadSettings(): ProductivitySettings {
  const stored = readJson<Partial<ProductivitySettings>>(
    STORAGE_KEYS.settings,
    {},
  );
  const defaults = defaultSettings();
  return {
    ...defaults,
    ...stored,
    // Telemetry can never be turned on: force it off even if a crafted
    // stored value says otherwise.
    privacy: {
      ...defaults.privacy,
      ...(stored.privacy ?? {}),
      telemetry: false,
    },
    focus: { ...defaults.focus, ...(stored.focus ?? {}) },
    contentFilterEnabled:
      stored.contentFilterEnabled ?? defaults.contentFilterEnabled,
  };
}

export function saveSettings(settings: ProductivitySettings): void {
  // Belt and suspenders: never persist telemetry as on.
  writeJson(STORAGE_KEYS.settings, {
    ...settings,
    privacy: { ...settings.privacy, telemetry: false },
  });
}

/**
 * Applies appearance to the document: `data-veilura-theme` + `data-density`
 * attributes and a `--veilura-font-size` CSS variable. The parent app's
 * stylesheet maps these to real colours/spacing; setting the attributes
 * here is what makes the choice take effect app-wide.
 */
export function applyAppearance(settings: ProductivitySettings): void {
  const root = document.documentElement;
  const theme =
    settings.theme === 'system' ? resolveSystemTheme() : settings.theme;
  root.setAttribute('data-veilura-theme', theme);
  root.setAttribute('data-veilura-theme-setting', settings.theme);
  root.setAttribute('data-veilura-density', settings.density);
  root.style.setProperty('--veilura-font-size', `${settings.fontSizePx}px`);
  root.style.setProperty(
    '--veilura-density-spacing',
    settings.density === 'compact' ? '6px' : '12px',
  );
}

export function resolveSystemTheme(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return FONT_SIZE_DEFAULT_PX;
  return Math.min(FONT_SIZE_MAX_PX, Math.max(FONT_SIZE_MIN_PX, Math.round(px)));
}
