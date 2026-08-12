# Handoff: STC Design System

## Overview

A general purpose interface library for Stockport Truck Centre. It is product
agnostic in the same way ShadCN is: nothing in it assumes a CRM, a marketing
tool or any particular domain. It supplies the tokens, primitives, composed
components and page shapes for any internal tool STC builds.

Light and dark themes, compact density, 4px corner language.

## About the design files

The files in `reference/` are **design references created in HTML**. They are
prototypes showing intended look and behaviour, not production code to lift.

The task is to **recreate these designs in the target codebase's existing
environment** using its established patterns and libraries. If no environment
exists yet, choose the most appropriate framework and implement there.

`tokens.css` and `tailwind.config.js` in the root of this bundle ARE meant to
be used directly. They are the contract; the HTML is the illustration.

## Fidelity

**High fidelity.** Exact colours, typography, spacing, states and interaction
behaviour are all specified. Recreate the UI faithfully using the codebase's
own component primitives.

---

## Getting started

1. Copy `tokens.css` into the app and import it before anything else.
2. Copy `fonts/` and `assets/` alongside it. Panton is licensed — self-host,
   never load from a CDN. Inter comes from Google Fonts (weights 400/500/600/700).
3. Merge `tailwind.config.js` into the existing config.
4. Theme switching is one attribute on `<html>`:
   `document.documentElement.setAttribute('data-stc-theme', 'dark')`.
   Persist to `localStorage` under `stc-ui-theme`. No class sweep, no re-render.

---

## The four rules the system depends on

1. **Navy acts, red points.** Navy carries primary actions and structure. Red is
   the single most important action on a screen, plus destructive intent. A
   screen with three red buttons has none.
2. **Density is a feature.** 32px controls, 36px table rows, 14px base text.
   Whitespace goes between groups, not inside them.
3. **Borders before shadows.** Structure comes from 1px rules and honest
   alignment. Elevation is only for things that genuinely float.
4. **Panton earns its size.** Panton for headings, numbers and labels that need
   authority. Everything read at length is Inter. Never set Panton below 11px.

A fifth rule matters for dark mode: **in light, shadow carries elevation; in
dark, surface tint carries it.** A black shadow on a navy field does almost
nothing, so each floating layer steps one rung up the navy scale
(`--surface-sunken` → `--bg` → `--surface` → `--surface-raised`) and always
carries a hairline so its edge reads.

---

## Design tokens

Full values are in `tokens.css`. Summary:

### Brand
| Token | Value | Role |
|---|---|---|
| STC Navy | `#09163A` | Primary actions, structure, headings, dark canvas |
| STC Red | `#CF2417` | One key action per screen, accents, destructive |
| Paper | `#F7F7F5` | Light canvas |
| Ink | `#050D26` | Dark canvas |

### Semantic tokens (light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F7F5` | `#050D26` | Page canvas |
| `--bg-subtle` | `#EFEFEC` | `#13224F` | Table headers, hover fills |
| `--surface` | `#FFFFFF` | `#09163A` | Cards, panels, inputs, menus |
| `--surface-raised` | `#FFFFFF` | `#1E2F63` | Dialogs, popovers |
| `--surface-sunken` | `#F7F7F5` | `#050D26` | Wells, code blocks, disabled fills |
| `--surface-inverse` | `#09163A` | `#FFFFFF` | Contrast blocks, tooltips |
| `--border` | `#E2E2DE` | `#1E2F63` | Default hairline |
| `--border-strong` | `#CBCBC6` | `#2B3F78` | Interactive outlines at rest |
| `--border-emphasis` | `#09163A` | `#5A6DA8` | Section rules, active underline |
| `--text` | `#09163A` | `#FFFFFF` | Primary reading colour |
| `--text-muted` | `#46527A` | `#B4BDD8` | Secondary copy, helper text |
| `--text-subtle` | `#7A7A74` | `#8492C0` | Metadata, placeholders, captions |
| `--primary` | `#09163A` | `#FFFFFF` | Primary button, active nav fill |
| `--accent` | `#CF2417` | `#E03B2E` | The one key action, destructive |
| `--focus` | `#3D5290` | `#8492C0` | Focus ring |
| `--success` | `#1F9E3C` | `#3ECF6B` | Passed, complete, in compliance |
| `--warning` | `#C77A06` | `#E8A33D` | Due soon, needs attention |
| `--danger` | `#B31F14` | `#EC6055` | Failed, overdue, destructive |
| `--info` | `#2B3F78` | `#8492C0` | Neutral notice |

Danger is deliberately red-700 in light, one step heavier than the brand accent,
so an accent button and a destructive button never render identically.

### Typography
Panton (display) and Inter (interface). Base 14px.

| Step | Size / line / tracking | Font |
|---|---|---|
| display | 44 / 1.05 / -0.04em | Panton 800 |
| h1 | 30 / 1.15 / -0.03em | Panton 800 |
| h2 | 22 / 1.2 / -0.025em | Panton 800 |
| h3 | 17 / 1.3 / -0.02em | Panton 700 |
| body-lg | 15 / 1.6 / -0.01em | Inter 400 |
| body | 14 / 1.55 / -0.01em | Inter 400 |
| body-sm | 13 / 1.5 / -0.01em | Inter 400 |
| caption | 12 / 1.45 / 0 | Inter 400 |
| label | 11 / 1 / +0.16em, uppercase | Panton 700 |

Numbers in tables, metrics and any aligned column use `font-variant-numeric: tabular-nums`.

### Spacing (4px base)
4, 8, 12, 16, 20, 24, 32, 40, 56.
4 icon-to-label · 8 within a control · 12 label-to-field, list row padding ·
16 card padding, between fields · 24 between cards · 32 between sections ·
40 page gutter · 56 major section break.

### Sizing (compact)
Controls 28 / **32** / 38px. Table rows **36px**, 44px when a row holds an avatar.
Sidebar 232px (56px collapsed rail). Top bar 52px. Content max width 1440px.

### Radius
2 tags and swatches · **4 default** (buttons, inputs, badges, menu items) ·
6 cards, panels, popovers · 8 dialogs, drawers · full for avatars, status dots, switches.

### Elevation
`shadow-1` cards at rest · `shadow-2` hovered cards, sticky headers ·
`shadow-3` menus, popovers, dropdowns · `shadow-4` dialogs, drawers, dragged items.

### Motion
120ms hover/colour/border · 160ms popovers, tooltips, menus · 220ms dialogs,
drawers, panel slides. One curve: `cubic-bezier(0.2, 0, 0, 1)`.

### Focus
`2px solid var(--focus)` at `2px` offset on every interactive element.
Deliberately navy, not red, so focus is never mistaken for an error.

### Chart palette (use in order)
`#09163A` `#CF2417` `#3D5290` `#E0C63F` `#1F9E3C` `#8492C0` `#7A150D` `#A3A39D`.
Single series uses chart-1 navy. Reserve chart-2 red for the series carrying the
message: the target line, the variance, the outlier. Never colour a whole chart red.

---

## Component inventory

### 02 Forms and inputs — `reference/02-forms.html`
Button (7 variants × 3 sizes × 6 states: rest, hover, active, focus, loading,
disabled; with icon, icon-only, full width), button group, segmented control,
split button, toggle button, text input (7 states, leading/trailing icon, prefix
and suffix text, clearable), grouped addon, textarea with character count,
password with strength meter, one-time-code input, inline edit, select, open
select menu with grouped options, combobox with search and empty result,
multi-select tokens, checkbox (on/off/indeterminate/focus/disabled, with
description), radio, radio cards, switch (2 sizes), number stepper, currency and
unit inputs, single and dual range, date, date range, time, quick range chips,
file dropzone, upload list (success, in progress, error), form layouts (two
column, label-left, sticky action bar), validation summary.

**Button variants:** `primary` (navy solid), `accent` (red solid), `secondary`
(surface + border-strong), `outline`, `ghost`, `danger`, `danger-ghost`, `link`.

### 03 Data display — `reference/03-data.html`
Table (sortable headers, row selection, right-aligned tabular numerics, status
badges, row action menu, footer pagination), bulk action bar, filter toolbar,
zebra and 28px compact variants, table skeleton, KPI stat cards (with delta,
sparkline, icon), stat strip, progress bar, stacked bar, progress ring, bar
chart, line chart with target series, donut with legend, activity heatmap,
sparklines in context, badges (9 tones, 2 sizes, with dot, with icon,
removable), inline status dots, avatars (4 sizes, with presence, stacked group,
with name and role), list rows, description list, kanban column and card
(rest/hover/dragging), activity timeline, empty states (no data, no results,
error), card and list skeletons.

### 04 Navigation — `reference/04-navigation.html`
Full application shell, sidebar (groups, active marker, badge counts, nested
children, disabled item, 56px collapsed rail), top bar with search trigger and
notification bell, tabs (underline, pill, vertical), breadcrumbs (full and
collapsed), command palette, dropdown menu, sort menu, account menu, pagination,
rows-per-page, horizontal stepper, vertical progress stepper.

### 05 Feedback and overlays — `reference/05-feedback.html`
Alerts (info, success, warning, danger; dismissible, with actions), page banner,
toasts (success, danger, info, in-progress with cancel, undo), standard dialog,
destructive confirm with type-to-confirm, right drawer, bottom sheet, tooltips
(plain, with shortcut, rich), popovers (record preview, column picker), spinners
(3 sizes, in button, with label), progress bars (determinate, indeterminate,
segmented, top-of-page route bar).

### 06 Patterns — `reference/06-patterns.html`
Dashboard home (KPI row, revenue vs target chart, pipeline by stage, needs
attention table, activity feed), list and detail split view, page header
variants (title + actions, record header with icon, edit header with back),
settings layout with section rail and permission switches.

---

## Interactions and behaviour

- **Theme:** `data-stc-theme="dark"` on `<html>`, persisted to `localStorage`
  key `stc-ui-theme`. Default light.
- **Hover:** buttons shift background only (`--primary` → `--primary-hover`),
  120ms. Cards lift `shadow-1` → `shadow-2` and border goes to `--border-emphasis`.
- **Active/pressed:** `translateY(1px)`, no colour change.
- **Focus:** 2px `--focus` ring at 2px offset, on every interactive element.
- **Loading buttons:** the spinner replaces the leading icon; the label stays and
  the button keeps its width. Never collapse to a bare spinner.
- **Destructive actions:** name the thing being destroyed, state what goes with
  it, keep the confirm button disabled until the name is typed. Where the action
  is genuinely reversible, use an Undo toast instead of a dialog.
- **Toasts:** bottom right, stacked, self-dismiss after 5s. Never for anything
  the user must act on.
- **Command palette:** ⌘K from anywhere, grouped results, shortcut on every row,
  ↑↓ to navigate, ↵ to select, esc to close.
- **Sidebar active state:** a 2px red left marker plus a tinted fill. Never a
  solid block. The marker persists in the collapsed rail so position is not lost.
- **Empty states:** always say what the thing is, why it is empty, and the single
  action that fills it. Never just "No results".
- **Skeletons:** match the shape of what is loading. If the shape cannot be
  matched, use a spinner.

## State management

Only two pieces of state belong to the design system itself:

| State | Type | Trigger | Persistence |
|---|---|---|---|
| `theme` | `'light' \| 'dark'` | Theme toggle in the top bar | `localStorage['stc-ui-theme']` |
| `sidebarCollapsed` | `boolean` | Rail toggle | `localStorage`, per user |

Everything else (selection, filters, pagination, dialog open state) belongs to
the feature, not the system.

## Assets

- `fonts/Panton-Regular.otf`, `Panton-SemiBold.otf`, `Panton-Bold.ttf`,
  `Panton-ExtraBold.otf` — licensed, self-host only.
- Inter — Google Fonts, weights 400/500/600/700.
- `assets/stc-emblem.png` — STC shield. Coloured shield on light surfaces,
  white-text lockup on dark.
- Icons in the reference files are inline 24×24 stroke SVGs at `stroke-width:2`,
  `currentColor`, rendered at 13–17px. Replace with the codebase's icon library
  (Lucide matches the weight and terminals closely) rather than extracting them.

## Files

| File | What it is |
|---|---|
| `tokens.css` | **Use directly.** All CSS custom properties, both themes, font faces, base reset. |
| `tailwind.config.js` | **Use directly.** Semantic colour, type, radius, shadow, spacing scales. |
| `reference/00-index.html` | Library index and the four principles |
| `reference/01-foundations.html` | Colour scales, semantic tokens, type ramp, spacing, radius, elevation, motion, chart palette |
| `reference/02-forms.html` | Every input control and its state matrix |
| `reference/03-data.html` | Tables, metrics, charts, badges, lists, empty states |
| `reference/04-navigation.html` | Shell, sidebar, tabs, command palette, menus, pagination |
| `reference/05-feedback.html` | Alerts, toasts, dialogs, drawers, popovers, loading |
| `reference/06-patterns.html` | Composed screens: dashboard, list and detail, settings |

The reference pages open in any browser. Each has a light/dark toggle in the top
right and a sticky contents rail. `support.js` beside them is the runtime that
renders them; it is not part of the design system and should not be shipped.

---

*Stockport Truck Centre · stc-uk.com*
