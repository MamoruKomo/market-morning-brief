# The Design System: Tactical Precision & Tonal Depth

## 1. Overview & Creative North Star
**Creative North Star: "The Obsidian Command"**

This design system is engineered for the high-frequency environment of professional day trading. Unlike consumer fintech apps that prioritize "friendliness," this system focuses on **Executive Authority** and **Tactical Precision**. We move beyond the "template" look by treating the interface as a physical dashboard of dark, layered glass—minimizing visual noise to ensure that the user’s cognitive load is reserved entirely for market fluctuations.

To achieve this, we employ **Organic Brutalism**: a philosophy that utilizes sharp, technical edges (4px radius) paired with sophisticated tonal layering. We avoid the "flat" look of standard web apps by using a density-first approach where information hierarchy is defined by light and depth rather than lines and boxes.

## 2. Colors: The Tonal Spectrum
The palette is rooted in an ultra-dark `#0e0e0e` foundation, designed to make the high-contrast data accents "pop" without causing ocular fatigue during 12-hour sessions.

### The "No-Line" Rule
**Borders are a relic of low-density design.** In this system, explicit 1px solid borders for sectioning are strictly prohibited. Boundaries between the Order Book, Charting, and Watchlist must be defined solely through background color shifts. Use `surface-container-low` for secondary panels against the `surface` background to create a "recessed" or "elevated" feel without a single line of stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked, precision-cut plates.
*   **Base Layer:** `surface` (#0e0e0e) for the global background.
*   **Secondary Panels:** `surface-container-low` (#131313) for large layout blocks.
*   **Active Interaction Areas:** `surface-container-high` (#20201f) for focused modules.
*   **Popovers/Floating Menus:** `surface-container-highest` (#262626) to bring elements into the foreground.

### The "Glass & Gradient" Rule
To add a premium, "High-End Editorial" feel to a technical tool, primary actions and active states should utilize subtle gradients. A transition from `primary` (#89acff) to `primary-dim` (#0f6df3) provides a sense of depth that feels "machined" rather than "drawn." For floating panels, apply `backdrop-blur: 12px` to semi-transparent surface tokens to allow the pulse of the market charts to bleed through the UI subtly.

## 3. Typography: Data as Narrative
We utilize **Inter** specifically for its technical neutrality and superior legibility at small sizes.

*   **Display & Headline (The Narrative):** Use `display-sm` to `headline-lg` for portfolio totals. These should feel authoritative and immovable.
*   **The Data Core (Tabular Figures):** All numerical data—prices, deltas, and volumes—**must** use tabular lining figures (`font-variant-numeric: tabular-nums`). This prevents the horizontal "shiver" of numbers as they tick up and down.
*   **Labels:** `label-sm` (#0.6875rem) is used extensively in this dense layout. To maintain readability, increase letter-spacing by 0.02em for all uppercase labels.

## 4. Elevation & Depth: Tonal Stacking
We reject traditional drop shadows in favor of **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by placing `surface-container-lowest` cards onto a `surface-container-low` section. This creates a "milled" effect, as if the UI has been carved out of a single block of obsidian.
*   **Ambient Shadows:** For critical floating elements (like a Trade Confirmation modal), use a highly diffused shadow: `box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5)`. The shadow should feel like a soft glow of darkness rather than a hard edge.
*   **The "Ghost Border" Fallback:** If a separation is required for accessibility in complex data tables, use the `outline-variant` token at **15% opacity**. This creates a "Ghost Border" that guides the eye without cluttering the technical density.

## 5. Components: Engineered for Performance

### Buttons (Tactical Trigger)
*   **Primary:** A gradient of `primary` to `primary-dim`. 4px radius. No border. Text is `on-primary-fixed` (Black) for maximum contrast.
*   **Secondary/Ghost:** `surface-bright` background with no border. This keeps the focus on the primary execution buttons.

### Cards & Modules (The "No-Divider" List)
*   **Execution:** Forbid the use of horizontal dividers in watchlists. Instead, use a 4px vertical margin (`spacing-sm`) or a subtle background hover state using `surface-container-highest`.
*   **Density:** Maximize data. A single list item should utilize `body-sm` for secondary data (Volume/Cap) and `title-sm` for the Ticker symbol.

### High-Contrast Indicators (The Pulse)
*   **Gains:** Use `secondary` (#9df197) for positive movement. In "Heatmap" components, use a subtle glow (`primary-container` at 20% opacity) to highlight top performers.
*   **Losses:** Use `error` (#ff716c) for negative movement. Avoid heavy blocks of red; use "sharp" red text or thin 2px indicators to keep the UI from feeling "bloody."

### Input Fields (Technical Entry)
*   **Style:** `surface-container-lowest` backgrounds with a "Ghost Border" that becomes `primary` on focus.
*   **Data Entry:** Use `body-lg` for price entry inputs to ensure no mistakes are made during high-volatility execution.

## 6. Do's and Don'ts

### Do:
*   **Use Asymmetry:** Place the most critical "Buy/Sell" module off-center or in a primary visual "anchor" position to break the monotony of a standard grid.
*   **Prioritize Scan-ability:** Use `on-surface-variant` (gray) for labels and `on-surface` (white) for the actual data. The eye should hit the numbers first, labels second.
*   **Maintain 4px Discipline:** Every corner, button, and input must adhere to the `DEFAULT` roundedness (4px). Any deviation breaks the "technical tool" illusion.

### Don't:
*   **Never use 100% white (#FFFFFF) for large text blocks.** It causes "halation" (glowing effect) against the dark background. Use `on-surface` which is slightly dialed back.
*   **Avoid standard 1px Dividers.** If you feel the need to add a line, try adding 8px of whitespace instead.
*   **No Rounded UI:** Avoid `lg`, `xl`, or `full` roundedness for any structural components. This is a high-performance machine, not a social app.
