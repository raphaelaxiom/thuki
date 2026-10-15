/** Appearance: themes, font size, density. */
import { useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  applyAppearance,
  clampFontSize,
  DENSITY_LABELS,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  loadSettings,
  saveSettings,
  THEME_LABELS,
} from '../settings';
import type { DensityId, ProductivitySettings, ThemeId } from '../types';
import { buttonStyle, inputStyle, Panel, rowStyle, statusStyle } from './Panel';

/** Theme picker (light / dark / system + 2 accent themes). */
export function ThemesPanel() {
  const [settings, setSettings] = useState<ProductivitySettings>(() =>
    loadSettings(),
  );
  const pick = (theme: ThemeId) => {
    const next = { ...settings, theme };
    setSettings(next);
    saveSettings(next);
    applyAppearance(next);
    appendAuditEntry('setting_change', `Theme set to ${THEME_LABELS[theme]}`);
  };
  return (
    <Panel
      title="Themes"
      description="Pick a theme. It persists and applies across the app."
    >
      <div style={rowStyle}>
        {(Object.keys(THEME_LABELS) as ThemeId[]).map((theme) => (
          <button
            key={theme}
            style={{
              ...buttonStyle,
              fontWeight: settings.theme === theme ? 700 : 400,
            }}
            aria-pressed={settings.theme === theme}
            onClick={() => pick(theme)}
          >
            {THEME_LABELS[theme]}
          </button>
        ))}
      </div>
      <p style={statusStyle}>Current: {THEME_LABELS[settings.theme]}</p>
    </Panel>
  );
}

/** Font-size setting: applies across the app via a CSS variable. */
export function FontSizePanel() {
  const [settings, setSettings] = useState<ProductivitySettings>(() =>
    loadSettings(),
  );
  const setSize = (px: number) => {
    const clamped = clampFontSize(px);
    const next = { ...settings, fontSizePx: clamped };
    setSettings(next);
    saveSettings(next);
    applyAppearance(next);
  };
  return (
    <Panel
      title="Font size"
      description={`Base text size, ${FONT_SIZE_MIN_PX}–${FONT_SIZE_MAX_PX}px. Applies across the app and persists.`}
    >
      <div style={rowStyle}>
        <input
          style={inputStyle}
          aria-label="Font size"
          type="range"
          min={FONT_SIZE_MIN_PX}
          max={FONT_SIZE_MAX_PX}
          step={1}
          value={settings.fontSizePx}
          onChange={(e) => setSize(Number(e.target.value))}
        />
        <input
          style={{ ...inputStyle, width: 64 }}
          aria-label="Font size in pixels"
          type="number"
          min={FONT_SIZE_MIN_PX}
          max={FONT_SIZE_MAX_PX}
          value={settings.fontSizePx}
          onChange={(e) => setSize(Number(e.target.value))}
        />
        <span style={statusStyle}>{settings.fontSizePx}px</span>
      </div>
      <p style={{ ...statusStyle, fontSize: settings.fontSizePx }}>
        Preview: the quick brown fox jumps over the lazy dog.
      </p>
    </Panel>
  );
}

/** Density: compact / comfortable spacing. */
export function DensityPanel() {
  const [settings, setSettings] = useState<ProductivitySettings>(() =>
    loadSettings(),
  );
  const pick = (density: DensityId) => {
    const next = { ...settings, density };
    setSettings(next);
    saveSettings(next);
    applyAppearance(next);
    appendAuditEntry(
      'setting_change',
      `Density set to ${DENSITY_LABELS[density]}`,
    );
  };
  return (
    <Panel
      title="Density"
      description="Compact tightens spacing; Comfortable gives elements room. The change is visible immediately."
    >
      <div style={rowStyle}>
        {(Object.keys(DENSITY_LABELS) as DensityId[]).map((density) => (
          <button
            key={density}
            style={{
              ...buttonStyle,
              fontWeight: settings.density === density ? 700 : 400,
            }}
            aria-pressed={settings.density === density}
            onClick={() => pick(density)}
          >
            {DENSITY_LABELS[density]}
          </button>
        ))}
      </div>
      <p style={statusStyle}>Current: {DENSITY_LABELS[settings.density]}</p>
    </Panel>
  );
}

/** All appearance settings on one screen. */
export function AppearancePanel() {
  return (
    <>
      <ThemesPanel />
      <FontSizePanel />
      <DensityPanel />
    </>
  );
}
