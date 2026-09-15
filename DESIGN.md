---
name: Precision Slate
colors:
  surface: '#fcf8f8'
  surface-dim: '#ddd9d8'
  surface-bright: '#fcf8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3f2'
  surface-container: '#f1edec'
  surface-container-high: '#ebe7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#444748'
  inverse-surface: '#313030'
  inverse-on-surface: '#f4f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5e5e5e'
  primary: '#5c5c5c'
  on-primary: '#ffffff'
  primary-container: '#747474'
  on-primary-container: '#fefcfc'
  inverse-primary: '#c7c6c6'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e2'
  on-secondary-container: '#646464'
  tertiary: '#5f5b59'
  on-tertiary: '#ffffff'
  tertiary-container: '#787371'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3e2e2'
  primary-fixed-dim: '#c7c6c6'
  on-primary-fixed: '#1b1c1c'
  on-primary-fixed-variant: '#464747'
  secondary-fixed: '#e3e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e8e1de'
  tertiary-fixed-dim: '#ccc5c3'
  on-tertiary-fixed: '#1e1b1a'
  on-tertiary-fixed-variant: '#4a4644'
  background: '#fcf8f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.025em
  body-lg:
    fontFamily: Work Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.005em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system embodies high-craft digital utility: calm, silent, and exceptionally reliable. Engineered for professionals handling high-value digital assets and workspace documents, the interface withdraws into the background so the user's content remains paramount.

The design movement combines **Scandinavian minimalism** with **Linear-grade engineering precision** and **Apple-like quietude**. Visual noise is treated as a defect. The experience feels crisp, instant, and frictionless, relying on absolute typographic discipline, exact alignment, and subtle tactile shifts rather than ornament or decorative illustration.

## Colors

The palette is disciplined and restrained:
- **Canvas & Surfaces:** Pure `#FFFFFF` for working cards, floating dialogs, and detail inspectors. Canvas foundations use `#F8F9FA` to delineate layout regions without requiring heavy dividers.
- **Ink Tiers:** Primary content and headers use deep ink slate `#0F172A`. Secondary labels, metadata (file dimensions, timestamps, collaborator names) use muted neutral `#64748B`. Tertiary borders and structure lines leverage `#E2E8F0` and `#F1F5F9`.
- **Accent (Monochrome):** `#777777` is strictly functional. It designates selection rings, primary creation triggers, inline focus indicators, and upload progression. It is never used decoratively.
- **Critical / Danger:** Muted coral `#EF4444` reserved strictly for destructive actions (e.g., permanent file deletion, revoking workspace access).

## Typography

Typography relies on `Space Grotesk` for headlines, `Work Sans` for body copy, and `Inter` for labels, with font feature settings configured for enterprise data: `cv02`, `cv03`, `cv04`, `cv11`, and `tnum` (tabular numerals).

- Display headings employ negative letter spacing (`-0.025em` to `-0.015em`) to create dense, authoritative optical units.
- Metadata rows, storage capacity stats, file sizes, and timestamps strictly utilize tabular figures (`font-variant-numeric: tabular-nums`) to prevent jittering during active updates and maintain vertical alignment in file lists.

## Layout & Spacing

The layout is built on a rigid 8px baseline rhythm (with a 4px sub-unit for tight inline micro-elements).

- **Grid Architecture:** 
  - **Desktop (1024px+):** Fluid content grid flanked by a collapsible 240px navigation rail and an optional 320px contextual inspector sidebar. Main file view utilizes an auto-fill CSS grid (`minmax(180px, 1fr)`) for gallery view, or a single full-width flex table for list view.
  - **Tablet (768px - 1023px):** Sidebars collapse into overlay slide-overs; main workspace takes full width with `1.25rem` gutters.
  - **Mobile (< 768px):** Single-column stack. Bottom-anchored action bar replaces top utility bars. Padding compresses to `margin: 1rem` and `gutter: 0.75rem`.

## Elevation & Depth

Visual order is established through **low-contrast outlines** paired with **whispering ambient drop shadows**. Heavy, high-opacity black drop shadows are forbidden.

- **Level 0 (Flat Canvas):** `#F8F9FA` background with 0px elevation.
- **Level 1 (Cards, File Tiles, Rows):** `#FFFFFF` surface bounded by a 1px solid hairline border (`#E2E8F0`). Shadow: `0 1px 2px 0 rgba(15, 23, 42, 0.03)`.
- **Level 2 (Dropdowns, Context Menus, Hover States):** `#FFFFFF` surface with hairline border (`#CBD5E1`). Shadow: `0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -1px rgba(15, 23, 42, 0.03)`.
- **Level 3 (Modals, Command K Palettes):** `#FFFFFF` surface with hairline border (`#94A3B8`/30%). Shadow: `0 16px 32px -8px rgba(15, 23, 42, 0.08), 0 4px 8px -2px rgba(15, 23, 42, 0.04)`. Accompanied by an ultra-subtle backdrop scrim of `rgba(15, 23, 42, 0.2)` with a 2px blur.

## Shapes

The design uses a clean, controlled corner geometry balancing human softness with architectural structure:
- **Base Geometry:** Standard components (inputs, interactive list items, dropdown menus) use `rounded` (0.5rem / 8px).
- **Surface Geometry:** Containers, file cards, modals, and file preview viewports scale to `rounded-lg` (0.625rem to 0.75rem / 10px to 12px).
- **Pill Formats:** Status pills, active filter chips, and circular icon triggers use 9999px full rounding.

## Components

### Buttons
- **Primary:** Solid `#777777` fill, white `#FFFFFF` text, 0.5rem radius, height 36px (desktop). Inset micro-highlight top border `inset 0 1px 0 rgba(255, 255, 255, 0.2)`. Hover: `#555555`.
- **Secondary / Ghost:** Transparent surface with hairline `#E2E8F0` border, text `#0F172A`. Hover: `#F1F5F9` background with no border shift.
- **Destructive:** Background `#FEF2F2`, border 1px solid `#FCA5A5`, text `#DC2626`. Hover: `#FEE2E2`.

### File Cards & List Rows
- **Card View:** 1px hairline border, 8px padding, `#FFFFFF` surface. Displays icon/thumbnail, file title (truncated with ellipsis), and tabular metadata footer. Hover triggers subtle border darken to `#CBD5E1` and micro-elevation. Selected state triggers 1px solid `#777777` border and `#F8F9FA` background tint.
- **List View:** Table-like row, 40px height, border-bottom 1px solid `#F1F5F9`. Hover activates neutral wash `#F8FAFC`.

### Input Fields & Search
- **Search Bar:** Height 36px, `#F1F5F9` background, zero outer border in resting state with shortcut badge (`⌘K`). Focus state transforms background to `#FFFFFF`, surrounded by a 1px border `#777777` and `0 0 0 3px rgba(119, 119, 119, 0.1)`.

### Chips & Filter Tags
- **Style:** Height 26px, padding 0 10px, font-size 12px, rounded-full. Inactive: `#F1F5F9` fill with `#475569` text. Active: `#F8F9FA` background, `#777777` text, and `#CBD5E1` hairline border.

### Modals & Dialogs
- **File Inspector & Previewer:** Minimal header with title, quick actions (Share, Download, More), separated by a 1px hairline divider. Body provides clean asset preview on neutral `#F8F9FA` canvas.

### Selection Controls
- **Checkboxes & Radios:** 16px square/circle, border 1px solid `#CBD5E1`, background `#FFFFFF`. Selected state fills with `#777777` with crisp white SVG check/dot icon.