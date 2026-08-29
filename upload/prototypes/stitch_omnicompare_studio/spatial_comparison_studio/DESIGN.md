---
name: Spatial Comparison Studio
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c1c6d7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8b90a0'
  outline-variant: '#414755'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e69'
  primary-container: '#4b8eff'
  on-primary-container: '#00285c'
  inverse-primary: '#005bc1'
  secondary: '#c6c6cb'
  on-secondary: '#2f3034'
  secondary-container: '#46464b'
  on-secondary-container: '#b5b4ba'
  tertiary: '#ffb595'
  on-tertiary: '#571e00'
  tertiary-container: '#ef6719'
  on-tertiary-container: '#4c1a00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#e3e2e7'
  secondary-fixed-dim: '#c6c6cb'
  on-secondary-fixed: '#1a1b1f'
  on-secondary-fixed-variant: '#46464b'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb595'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7c2e00'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  title-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  mono-label:
    fontFamily: jetbrainsMono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 40px
  gutter: 24px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

This design system is built for a professional AI workspace where precision meets clarity. Drawing inspiration from macOS and visionOS, the style is **Spatial Minimalism**—prioritizing content and data through high-fidelity materials rather than heavy UI chrome.

The brand personality is authoritative yet unobtrusive, designed to evoke a sense of focused calm and creative agency. It utilizes a "Liquid Glass" aesthetic, where depth is communicated through light refraction, backdrop blurs, and layered translucency. The interface should feel like a physical studio desk—organized, high-end, and responsive to light.

## Colors

The system uses a sophisticated adaptive palette designed to transition seamlessly between environments.

**Dark Mode (Default):**
- **Base:** `#121212` (Deep Charcoal) provides a neutral, high-contrast foundation for text.
- **Surface:** Semi-transparent glass overlays using white at 5–10% opacity with a 30px backdrop blur.
- **Accents:** A precision blue (`#007AFF`) used sparingly for action states, or monochromatic silver for a more "hardware-inspired" professional feel.

**Light Mode:**
- **Base:** Warm whites and soft grays (`#F5F5F7`) to reduce eye strain.
- **Surface:** Crystal clear glass with subtle 1px inner borders to define edges without adding visual weight.

## Typography

The system utilizes **Inter** for its neutral, systematic character and exceptional legibility at small sizes. For technical comparisons (AI code or data), **JetBrains Mono** is introduced as a secondary functional font.

Hierarchy is maintained through weight rather than size alone. Display sizes use tight letter spacing and semi-bold weights to mimic the premium feel of editorial design. Body copy is optimized at 17px for a "bookish" reading experience, essential for long-form AI content comparison.

## Layout & Spacing

This design system uses a **Spatial Adaptive Grid**. The layout philosophy centers on "Breathable Density"—maximizing the workspace while maintaining significant negative space around primary actions.

- **Desktop:** A flexible 12-column grid with wide 40px outer margins. Content is organized in "Comparison Panes" that can expand or contract.
- **Z-Axis Spacing:** Use the `stack-lg` (48px) to separate major content sections, ensuring the UI feels expansive.
- **Reflow:** On mobile, the multi-column comparison stacks vertically, with the glass material becoming more opaque to ensure legibility on smaller viewports.

## Elevation & Depth

Hierarchy is established via **Material Layering** rather than traditional drop shadows.

1.  **Level 0 (Floor):** Solid neutral base color.
2.  **Level 1 (Workspace):** Large container surfaces with `backdrop-filter: blur(20px)` and a subtle 1px border (`rgba(255,255,255,0.1)` in dark mode).
3.  **Level 2 (Popovers/Modals):** Elevated "Glassmorphism" with a soft, diffused shadow (`0 20px 40px rgba(0,0,0,0.3)`).
4.  **Interaction Depth:** Elements should appear to "sink" slightly on press and "lift" (glow/increase blur) on hover, simulating tactile feedback.

## Shapes

The shape language is defined by **Continuous Curvature**. Large containers and workspace panes use a generous 24px radius, creating an inviting, soft frame for the technical AI content.

Secondary elements like buttons and input fields use a 12px radius, ensuring they feel distinct from the primary containers but part of the same geometric family. Search bars and status indicators use a full pill-shape for maximum distinction.

## Components

**Buttons:** 
- *Primary:* Solid fill (Silver or Blue) with high-contrast text. No border.
- *Secondary/Ghost:* Glass material with a subtle white or black tint. Inner stroke only.

**Comparison Panes (Cards):**
- The core component. Features a 24px corner radius, glass background, and a "title bar" area with mono-spaced labels. Use a 1px vertical divider between side-by-side content to maintain structural clarity.

**Input Fields:**
- Minimalist design. Only a bottom border or a very subtle recessed glass fill. Labels should be small, all-caps, and positioned above the field to maximize vertical scanability.

**AI Status Chips:**
- Pill-shaped with a low-opacity color fill (e.g., green for 'ready', amber for 'processing'). Include a small "pulsing" dot animation for active AI generations.

**Scrollbars:**
- Hidden by default or ultra-thin with rounded ends, appearing only on interaction to maintain the clean, "uncluttered desk" aesthetic.