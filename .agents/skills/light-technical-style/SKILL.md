---
name: light-technical-style
description: Apply a clean, light, technical UI visual style to websites, apps, dashboards, desktop software, and developer-facing interfaces. Use when designing or restyling interfaces to look precise, structured, calm, and engineer-friendly.
---

# Light Technical Style

Use this skill when the user wants an interface to look clean, precise, structured, technical, and engineer-friendly.

The style is **not** a component library. It is a visual direction: colors, lines, borders, radii, surfaces, typography, and spacing.

## Visual Intent

Design the UI as if it belongs to a polished technical tool, observability product, system dashboard, API console, or engineering workspace.

It should feel:

- light
- structured
- calm
- precise
- modular
- slightly code-like
- low-noise
- information-dense

Avoid:

- heavy gradients
- glossy marketing visuals
- oversized hero typography
- playful bubbly shapes
- random decorative colors
- dark terminal aesthetics
- strong glassmorphism
- large soft shadows

## Color System

Use a mostly white and gray interface with a few semantic technical accents.

```css
:root {
  --bg: #ffffff;
  --bg-soft: #f6f8fa;
  --surface: #ffffff;
  --surface-muted: #f0f4f8;

  --text: #1f2328;
  --text-muted: #57606a;
  --text-soft: #6e7781;

  --border: #d0d7de;
  --border-soft: #e5e7eb;

  --blue: #2563eb;
  --purple: #7c3aed;
  --cyan: #0891b2;
  --green: #16a34a;
  --orange: #ea580c;
  --red: #ef4444;
}
```

### Color Usage

- **Blue**: primary action, current state, selected item, active route.
- **Purple**: configuration, identity, metadata, integration, advanced options.
- **Cyan**: input/output, network, interface boundary, gateway, external system.
- **Green**: success, healthy, completed, accepted, positive state.
- **Orange**: warning, pending, expensive operation, persistence, attention needed.
- **Red**: failure, destructive action, blocked state, security risk.

Rules:

- Most UI should be white, gray, and dark text.
- Accent colors must have meaning.
- Do not color every card differently without semantic reason.
- Use red sparingly and only for real risk or destructive action.
- Prefer subtle colored borders, top bars, icons, or badges over full colored backgrounds.

## Surfaces

Use white panels on a white or very light gray background.

Recommended surface treatment:

```css
.panel {
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 10px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.06);
}
```

For softer nested areas:

```css
.subtle-surface {
  background: #f6f8fa;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
```

Rules:

- Use borders more than shadows.
- Shadows should be small and functional, not dramatic.
- Prefer flat white cards with clear edges.
- For important cards, use a thin colored top border or left rail.

## Lines and Borders

Lines are a major part of this style.

Use:

```css
--line: #d0d7de;
--line-soft: #e5e7eb;
--line-strong: #8c959f;
```

Rules:

- Default border width: `1px`.
- Emphasized border width: `1.5px` or `2px`.
- Dividers should be light gray and thin.
- Use straight alignment and grid-like separation.
- Avoid thick decorative outlines unless they indicate focus or selection.

Good patterns:

```css
.card.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.10);
}

.card.warning {
  border-color: #ea580c;
}
```

## Radius

Use modest, technical rounding.

```css
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 10px;
--radius-xl: 12px;
```

Rules:

- Cards and panels: `8px` to `12px`.
- Buttons and inputs: `6px` to `8px`.
- Badges and pills: fully rounded or `999px` is acceptable.
- Avoid overly soft, bubbly `20px+` card corners.

## Typography

Use a clean sans-serif for normal UI and monospace as an accent.

```css
body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2328;
}

.mono {
  font-family: "SFMono-Regular", "Cascadia Code", "Roboto Mono", "Courier New", monospace;
}
```

Use monospace for:

- IDs
- labels
- paths
- timestamps
- commands
- metrics
- technical section names
- compact hints such as `// settings`, `env.production`, `GET /v1/items`

Type scale:

```css
--text-xs: 11px;
--text-sm: 12px;
--text-md: 14px;
--text-lg: 16px;
--text-xl: 20px;
--title: 24px;
```

Rules:

- Body text: `13px` to `15px`.
- Dense tables and metadata: `11px` to `13px`.
- Titles: `20px` to `28px`, weight `650` to `750`.
- Avoid huge marketing-style headings.

## Background

Default background is white.

Optional technical texture:

```css
.technical-bg {
  background-color: #ffffff;
  background-image: radial-gradient(rgba(37, 99, 235, 0.06) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

Rules:

- Dot grid should be extremely subtle.
- Use grid texture for dashboards, empty states, diagram-like screens, or technical landing sections.
- Do not use strong patterns behind dense text.

## Spacing and Layout

Use a strict spacing scale.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
```

Rules:

- Align edges precisely.
- Prefer grid-based layout.
- Keep related items close.
- Use consistent card widths, row heights, and section gaps.
- Use compact density; do not over-space like a marketing page.

## Shape Language

Use simple geometric structure:

- rectangles
- rounded rectangles
- thin rails
- small status dots
- compact badges
- divider lines
- code-like labels

Recommended details:

```css
.section-label {
  font-family: "SFMono-Regular", monospace;
  font-size: 11px;
  font-weight: 700;
  color: #2563eb;
  letter-spacing: 0.02em;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #16a34a;
}
```

Avoid:

- irregular blobs
- heavy illustrations
- excessive icon decoration
- large decorative gradients

## Interaction States

Keep interactions crisp and visible.

```css
.interactive:hover {
  background: #f6f8fa;
  border-color: #8c959f;
}

.interactive:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.selected {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.04);
}
```

Rules:

- Hover states should be subtle.
- Focus states must be clear.
- Selected states should use blue border, pale blue fill, or a small blue rail.
- Disabled states should reduce opacity and avoid strong color.

## Badges and Tags

Badges should be compact, technical, and semantic.

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #d0d7de;
  background: #ffffff;
  font: 600 11px "SFMono-Regular", monospace;
  color: #57606a;
}
```

Rules:

- Use badge color only to encode status.
- Keep labels short: `active`, `queued`, `healthy`, `beta`, `read-only`.
- Prefer border and text color over filled backgrounds.

## Buttons and Inputs

Buttons and inputs should feel precise, not flashy.

```css
.button {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #d0d7de;
  background: #ffffff;
  color: #1f2328;
  font-weight: 600;
}

.button.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.input {
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #d0d7de;
  background: #ffffff;
}
```

Rules:

- Primary action should usually be blue.
- Secondary actions stay white with gray border.
- Destructive action uses red only when necessary.
- Inputs should have clear borders and calm focus states.

## Final Checklist

Before finishing, verify:

- The UI is mostly white, gray, and dark text.
- Accent colors are semantic, not decorative.
- Borders are consistent and thin.
- Radius is modest, usually `6px` to `12px`.
- Shadows are subtle or absent.
- Monospace is used as an accent, not everywhere.
- Layout follows a strict spacing grid.
- The result feels like a precise technical product, not a generic SaaS template.
