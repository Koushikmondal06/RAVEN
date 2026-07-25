---
name: Raven Infrastructure
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353434'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c7c6c6'
  on-secondary: '#303031'
  secondary-container: '#464747'
  on-secondary-container: '#b5b5b5'
  tertiary: '#ffffff'
  on-tertiary: '#2f3131'
  tertiary-container: '#e2e2e2'
  on-tertiary-container: '#636565'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e3e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#141313'
  on-background: '#e5e2e1'
  surface-variant: '#353434'
typography:
  display-lg:
    fontFamily: anybody
    fontSize: 80px
    fontWeight: '900'
    lineHeight: '1.0'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: anybody
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
  headline-lg-mobile:
    fontFamily: anybody
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.1'
  headline-md:
    fontFamily: anybody
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
  body-lg:
    fontFamily: jetbrainsMono
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: jetbrainsMono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: jetbrainsMono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  code-sm:
    fontFamily: jetbrainsMono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
spacing:
  unit: 4px
  container-max: 1440px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system is built on a **High-Contrast Brutalist** aesthetic, engineered to reflect the raw power and transparency of decentralized compute. The target audience consists of developers, node operators, and AI researchers who value performance over ornamentation.

The UI evokes a "Hardened Terminal" feel—a digital environment that is industrial, unapologetic, and hyper-functional. It prioritizes information density and structural clarity, utilizing a strictly monochromatic palette to emphasize the utility of the marketplace. The emotional response is one of absolute reliability, technical sophistication, and "trustless" transparency.

## Colors

The palette is strictly binary, mirroring the logic of the machine.

- **Primary (#FFFFFF):** Used for all critical text, primary actions, and structural borders.
- **Background (#000000):** The void. Used for all base surfaces to ensure maximum contrast and "terminal" immersion.
- **Secondary (#888888):** Reserved for non-essential metadata, disabled states, and auxiliary labels.
- **Functional Accents:** Pure white is used for success; pure white with a 2px border for warnings. No semantic colors (red/green) are used; status is communicated via iconography and text labels.

## Typography

This design system utilizes a high-impact typographic hierarchy. 

**Headings** use **Anybody** in its heaviest weights. It should be set with tight leading and negative letter-spacing to create dense, impactful blocks of text. All headings must be uppercase to maintain the brutalist tone.

**Body and Interface elements** use **JetBrains Mono**. This provides the "Terminal" aesthetic essential for a compute marketplace. Monospaced characters ensure that data tables and machine specifications (RAM, TFLOPS, Price) align perfectly, emphasizing precision and technical rigor.

## Layout & Spacing

The layout is governed by a **strict 12-column fluid grid** with heavy, visible dividers. 

- **Grid Lines:** Vertical and horizontal borders (1px or 2px) should be used to separate sections rather than whitespace.
- **Margins:** Large outer margins (48px+) provide breathing room for the heavy typography.
- **Alignment:** All elements must snap to the grid. Avoid centering; use left-aligned layouts for text and right-aligned for numerical data to mimic data sheets.
- **Mobile:** Reflow to a single column, maintaining the 2px border around the entire viewport to create a "contained" screen effect.

## Elevation & Depth

This system rejects shadows that simulate light and air. Instead, it uses **Hard Brutalist Shadows**.

- **Depth:** Conveyed through "Hard-Drop" shadows—solid #FFFFFF offsets with 100% opacity and 0 blur. This creates a physical, "stacked" appearance.
- **Layers:** Use 2px white borders to define containers. A "raised" element is achieved by shifting the container -4px top/left and adding a +4px solid white shadow to the bottom/right.
- **Inversions:** To highlight a selected state or active area, invert the colors (Black text on White background).

## Shapes

The shape language is **absolute**. Every element—buttons, cards, inputs, and tabs—must have **0px border-radius**. Sharp corners reflect the "hardened" nature of the infrastructure. Any use of curves is strictly prohibited as it dilutes the industrial aesthetic.

## Components

### Buttons
- **Primary:** Solid #FFFFFF background, #000000 text, uppercase JetBrains Mono. On hover: Shift -2px with a solid white shadow.
- **Secondary:** #000000 background, #FFFFFF text, 2px white border. 
- **Active State:** Instant inversion.

### Input Fields
- **Default:** 2px white border, black background. Text is JetBrains Mono.
- **Focus:** The border thickness remains 2px, but the field should trigger a subtle "glitch" or flicker on the label when selected. Use a solid white block for the cursor.

### Cards & Containers
- Cards must use a 2px white border. 
- Headers within cards are separated by a 2px horizontal rule.
- Data points (e.g., GPU Specs) should be formatted as key-value pairs separated by dots (e.g., `RAM.........128GB`).

### Lists & Tables
- Data-heavy. Use 1px white borders between rows. 
- Hovering over a row should invert the entire row (White background, Black text).

### Special Elements
- **Scan Lines:** A persistent, low-opacity (5%) horizontal overlay across the entire UI to simulate a CRT monitor.
- **Glitch Transitions:** When navigating between views, elements should briefly "jitter" or fragment.