# Veilura Design System

This document is the single source of truth for Veilura's visual and interaction design.
Use the color tokens, typography, and motion principles exactly as specified.

---

## 1. Product Identity

**Website:** [veilura.online](https://veilura.online/)

**Name:** Veilura (pronounced "VAY-loo-rah"; veil = privacy + aura = presence)

**Tagline:** _A context-aware floating AI assistant for macOS. Fully local, free, works everywhere._

**One-liner:** Double-tap Control and Veilura pops up right on top of whatever you're
working on, even fullscreen apps. Ask a question, get an answer, toss the convo, back
to work. All in one Space.

**Personality:** Calm, minimal, precise. Personal, not corporate. Built by someone who
wanted this tool and couldn't find it. The vibe is a focused utility that respects your
attention and your privacy. Think: Arc browser meets macOS Spotlight.

**Target audience:** Developers and power users who want fast AI answers without
switching apps, creating accounts, or sending data to a server.

**Core differentiator:** Floats above every app, including fullscreen ones. Highlight
any text first and Veilura opens with it pre-filled as context. Your favorite AI chat
apps can't do either of those things.

**Tech:** Ships its own local AI engine (bundled llama.cpp) and downloads a starter
model during onboarding. No API keys, no subscriptions, no telemetry. Conversations
stored in a local SQLite database. Free and open source under Apache 2.0.

---

## 2. Color Palette

Use these exact values. No substitution. The Veilura palette is deep
indigo/violet + aurora teal/mint accent, with a warm off-white light theme.
Tokens live in `src/App.css` `@theme` (`--color-*`); this doc mirrors them —
do not invent new hexes in components, extend the tokens instead.

### Brand Colors

| Token     | Hex       | Role                              |
| --------- | --------- | --------------------------------- |
| Primary   | `#7c6cf0` | CTAs, accents, glow, highlights   |
| Secondary | `#4f46e5` | Depth gradients, pressed states   |
| Tertiary  | `#2dd4bf` | Accent pops, secondary highlights |
| Neutral   | `#12102a` | Background fallback (deep indigo) |

### Veilura Brand Tokens

| Token        | Hex       | Role                                              |
| ------------ | --------- | ------------------------------------------------- |
| Aurora Teal  | `#2dd4bf` | Aurora accent, active glints, focus details       |
| Aurora Mint  | `#5eead4` | Aurora highlight, success-adjacent accents         |
| Veil Indigo  | `#312e81` | Deep indigo field, logo + DMG backgrounds         |
| Veil Deep    | `#1b1838` | Darkest indigo, icon gradient end                 |
| Paper        | `#faf7f2` | Warm off-white light-theme base                   |

### Surface Colors

| Token            | Value                      | Role                                                |
| ---------------- | -------------------------- | --------------------------------------------------- |
| Surface Base     | `rgba(24, 22, 48, 0.98)`   | Main window background (near-black, indigo undertone) |
| Surface Elevated | `rgba(40, 36, 74, 0.60)`   | Cards, elevated panels                              |
| Surface Border   | `rgba(124, 108, 240, 0.16)` | Window edge, subtle violet rim                     |

### Text Colors

| Token          | Hex       | Role                          |
| -------------- | --------- | ----------------------------- |
| Text Primary   | `#f2f1fb` | Body text, labels             |
| Text Secondary | `#9a97b8` | Metadata, hints, placeholders |

### Glow / Ambient Effects

- Top edge of the window has a subtle horizontal gradient glow:
  `linear-gradient(90deg, transparent, rgba(124, 108, 240, 0.5), transparent)`
  spanning 70% of the width, 1px tall, sitting flush at the very top of the window frame.
- Background of the window has a soft radial ambient:
  `radial-gradient(ellipse 70% 40% at 50% 0%, rgba(124, 108, 240, 0.12) 0%, transparent 65%)`
- These two effects give the window an aurora glow from the top — violet
  with a teal/mint shimmer in the logo and accents. Critical to reproduce.

### Shadows

- **Bar mode:** `0 6px 20px -6px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,108,240,0.16)`
- **Chat mode:** `0 4px 14px -3px rgba(0,0,0,0.5), 0 1px 4px -1px rgba(0,0,0,0.3), 0 0 0 1px rgba(124,108,240,0.16)`

---

## 3. Typography

**Sole typeface:** Nunito (loaded via `@fontsource/nunito`). Used for all UI chrome and AI prose. The `--font-sans` CSS variable in `@theme` is the single source of truth; every surface inherits from it. Weights 400, 500, 600, and 700 are loaded. Fall back to `-apple-system, BlinkMacSystemFont, sans-serif`.

There is no secondary reading face. Nunito handles both the compact bar UI and the expanded chat bubbles.

| Use                 | Weight | Approx size |
| ------------------- | ------ | ----------- |
| Input / chat body   | 400    | 14-16px     |
| UI labels, buttons  | 500    | 13px        |
| Section headers     | 600    | 24-36px     |
| Hero / display text | 700    | 48-72px     |

---

## 4. Window Dimensions and Layout

Veilura has two distinct visual states. Both are centered on screen (or near the cursor).

### Bar Mode (compact, Spotlight-style)

- Width: 600px logical
- Height: ~80px
- Border radius: 16px
- Content: Veilura logo (left) + text input (center) + send button (right)
- The window background is nearly opaque indigo-tinted dark with the ambient top glow.
- Feels like macOS Spotlight: minimal, surgical, focused.

### Chat Mode (expanded)

- Width: 600px (same)
- Height: up to 648px (600px content + 48px padding)
- Border radius: 16px (same, no jarring reflow)
- Content: window chrome (top bar with controls, history, new-chat) + scrollable message list + input bar (bottom)
- The bar-to-chat transition is a smooth spring-based morph: the container grows downward.

### Window Controls (chat mode only)

Small row at top of chat window: close button (left), history button (center-left),
new conversation button (right). Minimal macOS-native feel.

---

## 5. Chat Bubble Design

### User Bubble

- Background: `linear-gradient(135deg, #7c6cf0 0%, #4f46e5 100%)`
- Shadow: `0 2px 12px -2px rgba(124, 108, 240, 0.35), inset 0 1px 0 rgba(255,255,255,0.15)`
- Text color: white
- Alignment: right side
- Border radius: 12px (pill-ish on right, flat on bottom-right to indicate "sent")

### AI Bubble

- Background: `rgba(32, 29, 60, 0.95)` with `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(255,255,255,0.06)`, top border slightly violet `rgba(124,108,240,0.15)`
- Shadow: `0 2px 8px -2px rgba(0,0,0,0.3)`
- Text color: `#f2f1fb`
- Alignment: left side
- Renders markdown: code blocks have dark backgrounds with violet-tinted borders.

### Typing Indicator

Three dots, violet `#7c6cf0`, pulsing in sequence. Shown while AI is generating.

---

## 6. Motion and Animation Principles

**Framework in the real app:** Framer Motion (React). Replicate the feel, not the code.

### Key easing

The morphing container uses: `cubic-bezier(0.12, 0.8, 0.2, 1.18)` over `500ms`.
This is a slight overshoot spring: it grows just a hair past its target then settles.
Use this feel for major state transitions in the video.

### Principles

- **Minimal, purposeful motion.** Nothing bounces for the sake of bouncing.
- **Spring-forward, snap-back.** Entrances have a subtle overshoot. Exits are clean cuts or fast fades.
- **Stagger reveals.** When multiple elements appear (e.g., chat bubbles), stagger each by ~60-80ms.
- **No rotation effects.** No 3D flips, no spinning logos. Clean 2D.
- **Opacity + Y-translate for entrances.** Elements fade in while sliding up 8-12px.

### The signature morph

The bar expanding into chat mode is Veilura's signature interaction. The window grows
downward from 80px to ~640px over 500ms with the slight overshoot spring. This should
be shown prominently in the video and feel satisfying.

---

## 7. Logo

- Use on dark backgrounds only. The logo is designed for the indigo-dark Veilura surface.
- The mark is original to Veilura: layered veil / aurora arcs + a spark, drawn from scratch (see `assets/logo.svg`). Do not reuse the old Thuki mark.
- In bar mode: appears at the left side of the input bar, smaller (24-32px).
- In onboarding and hero contexts: can be displayed larger (120-200px) centered.
- Do not add drop shadows or heavy glow effects to the logo itself.
