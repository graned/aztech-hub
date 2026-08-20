# OpenCode Workspace Manager Design System

## 1. Atmosphere & Identity

A calm local command center for people who move between repositories and tools. The signature is a warm paper-like canvas with precise ink-blue accents: practical, quiet, and ready for work without pretending the workspace is already configured.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | `--surface-primary` | `#F7F8FA` | `#111418` | App background |
| Surface/secondary | `--surface-secondary` | `#FFFFFF` | `#191E24` | Intro panel |
| Surface/elevated | `--surface-elevated` | `#FFFFFF` | `#20262D` | Future popovers |
| Text/primary | `--text-primary` | `#17212B` | `#F3F5F7` | Headings and body |
| Text/secondary | `--text-secondary` | `#5D6874` | `#AAB4BF` | Supporting copy |
| Text/tertiary | `--text-tertiary` | `#87919B` | `#7D8995` | Metadata |
| Border/default | `--border-default` | `#DCE1E6` | `#303943` | Structural edges |
| Border/subtle | `--border-subtle` | `#E9EDF0` | `#242B33` | Quiet separation |
| Accent/primary | `--accent-primary` | `#2B5F8A` | `#8DB9DF` | Links and focus |
| Accent/hover | `--accent-hover` | `#214A6C` | `#B1D2EC` | Hover state |
| Status/success | `--status-success` | `#287A55` | `#71C79D` | Healthy status |
| Status/warning | `--status-warning` | `#9A641E` | `#E2B36A` | Cautions |
| Status/error | `--status-error` | `#A84242` | `#E28A8A` | Errors |
| Status/info | `--status-info` | `#2B5F8A` | `#8DB9DF` | Informational state |

### Rules

- Accent is reserved for interaction and status, not decoration.
- Surfaces use tonal contrast first; borders are structural only.
- Dark mode is token-ready but the foundation ships with the system color preference.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | `48px / 3rem` | 700 | 1.1 | -0.02em | Future hero title |
| H1 | `36px / 2.25rem` | 700 | 1.2 | -0.015em | Page title |
| H2 | `28px / 1.75rem` | 600 | 1.3 | -0.01em | Section title |
| H3 | `22px / 1.375rem` | 600 | 1.4 | 0 | Panel title |
| Body/lg | `18px / 1.125rem` | 400 | 1.6 | 0 | Intro copy |
| Body | `16px / 1rem` | 400 | 1.6 | 0 | Default text |
| Body/sm | `14px / 0.875rem` | 400 | 1.5 | 0 | Supporting text |
| Caption | `12px / 0.75rem` | 500 | 1.4 | 0.02em | Labels |

### Font Stack

- Primary: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

## 4. Spacing & Layout

All spacing uses a 4px base unit. Use Tailwind spacing tokens from `1` through `16` and avoid arbitrary values.

- Max content width: `1120px` (`max-w-7xl` with a restrained content column)
- Grid: 12-column desktop, single-column mobile
- Breakpoints: `sm 640px`, `md 768px`, `lg 1024px`, `xl 1280px`
- Page gutters: `16px` mobile, `32px` desktop

## 5. Components

### Foundation panel

- **Structure**: semantic `section` with a title, supporting copy, and optional action
- **Variants**: primary, quiet
- **Spacing**: `space-4` to `space-8`
- **States**: default, focus-visible for interactive descendants
- **Accessibility**: semantic headings, visible focus ring, readable contrast
- **Motion**: 200ms opacity/transform transitions only

## 6. Motion & Interaction

- Micro interactions: 120ms ease-out
- Standard transitions: 220ms ease-in-out
- Animate only opacity and transform.
- Respect `prefers-reduced-motion` by disabling non-essential transitions.
- Every future interactive control must expose hover, active, and focus-visible states.

## 7. Depth & Surface

Strategy: **tonal-shift with structural borders**.

Use the primary canvas, secondary panel, and elevated surface tokens to create depth. Borders communicate grouping and focus, never decoration. Avoid drop shadows in the foundation.
