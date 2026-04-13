# Design System Strategy: The Financial Atelier

Source: user-provided design note (stored for ongoing UI/UX improvements).

## 1. Overview & Creative North Star
This design system moves away from the "data-dense spreadsheet" aesthetic typical of fintech. Our Creative North Star is **"The Precision Curator."** We treat financial data not as a wall of noise, but as a high-end editorial experience.

By combining the high-contrast authority of editorial typography (Manrope) with the functional clarity of Swiss-style UI (Inter), we create an environment that feels both sophisticated and effortless. We break the traditional grid through **Intentional Asymmetry**—utilizing generous white space and overlapping layers to guide the user’s eye to what matters most: the trade.

## 2. Color & Atmospheric Depth
We do not use lines to define space; we use light and tone. The palette is anchored in a vibrant, trustworthy blue, supported by a sophisticated range of "Surface" tokens that allow for organic layering.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. Traditional dividers feel restrictive and "cheap." Instead, boundaries must be defined solely through background color shifts.
* *Example:* A `surface-container-low` section sitting on a `surface` background provides all the separation necessary for the human eye.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine paper.
* **Base:** Use `surface` (#f5f7f9) for the primary application background.
* **Nesting:** Use `surface-container-lowest` (#ffffff) for high-priority cards or "floating" modules to create a natural lift.
* **Recessing:** Use `surface-container-high` (#dfe3e6) for utility bars or secondary navigation to "sink" them into the background.

### The Glass & Gradient Rule
To ensure the app feels "energetic" and "vibrant":
* **CTAs:** Use a subtle linear gradient from `primary` (#0052d0) to `primary_container` (#799dff) at a 135-degree angle. This adds a "soul" to buttons that flat colors cannot achieve.
* **Floating Elements:** For overlays (Modals, Hover states), use `surface_container_lowest` with a 80% opacity and a 20px `backdrop-blur`.

## 3. Typography
Our typography is a dialogue between **Authority (Manrope)** and **Utility (Inter).**

* **Display & Headlines (Manrope):** These are used for portfolio balances, stock symbols, and section headers. The wider aperture of Manrope conveys a modern, premium feel. Use `headline-lg` for the primary portfolio balance to make it feel like a statement.
* **Body & Labels (Inter):** Reserved for financial data, ticker descriptions, and transactional details. Inter’s tall x-height ensures that even at `body-sm` (12px), a complex trade execution remains legible.
* **Tonal Emphasis:** Avoid "Black" (#000000) for text. Use `on_surface` (#2c2f31) for primary text and `on_surface_variant` (#595c5e) for metadata to create a softer, more professional contrast.

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are often a crutch for poor spatial design. This system prioritizes **Tonal Layering** first.

* **The Layering Principle:** Depth is achieved by stacking. A card using `surface-container-lowest` placed atop a `surface` background creates a "Ghost Lift" that feels cleaner than a shadow.
* **Ambient Shadows:** When a true float is required (e.g., a "Buy" button bar), use a multi-layered shadow: `0px 4px 20px rgba(44, 47, 49, 0.04), 0px 8px 40px rgba(44, 47, 49, 0.08)`. The shadow must be tinted with the `on_surface` color to feel natural.
* **The "Ghost Border" Fallback:** If a border is required for accessibility in data tables, use the `outline_variant` token at **10% opacity**. It should be felt, not seen.

## 5. Components

### Buttons
* **Primary:** Gradient from `primary` to `primary_container`. Radius: `md` (0.75rem). No shadow, unless hovered.
* **Secondary:** `surface-container-highest` background with `primary` text. This creates a "soft" button that doesn't compete with the main action.
* **Tertiary:** No background. Bold `primary` text with a subtle underline appearing only on hover.

### The "Trade Card" (Custom Component)
Forbid the use of dividers between the stock name, the sparkline, and the price. Use `surface-container-low` for the card background and `surface-container-lowest` for the "Action" area within the card. Use `tertiary` (Emerald) for positive trends and `error` (Coral) for negative.

### Input Fields
* **Style:** Minimalist. No bottom line. A soft `surface-container-low` fill with a `md` (0.75rem) corner radius.
* **Focus State:** The background shifts to `surface-container-lowest` and gains a 2px "Ghost Border" of `primary` at 40% opacity.

### Sparklines & Charts
Charts should not have visible X/Y axis lines. Use a `surface-variant` fill for the area under the curve with a 20% opacity gradient. This emphasizes the *shape* of the data over the *grid* of the data.

## 6. Do’s and Don’ts

### Do
* **Do** use `xl` (1.5rem) corner radius for large dashboard containers to emphasize the "friendly" and "accessible" mood.
* **Do** use "Optical Centering"—sometimes financial figures need to be shifted 1-2px to the left to account for currency symbols.
* **Do** leverage `tertiary_container` for positive price changes to provide a soft, legible background for emerald text.

### Don’t
* **Don’t** use pure black for text or pure grey for shadows; it kills the "vibrant" and "refreshing" intent.
* **Don’t** use a divider line to separate list items. Use 16px or 24px of vertical whitespace (`spacing-md/lg`) instead.
* **Don’t** cram data. If a screen feels full, increase the `surface` area and move secondary data to a "Details" disclosure.

## 7. Token Summary Reference
* **Core Roundness:** `md` (0.75rem) for buttons/inputs; `xl` (1.5rem) for main cards.
* **Primary Action:** `primary` (#0052d0).
* **Positive Sentiment:** `tertiary` (#006a34) on `tertiary_container` (#86fea7).
* **Negative Sentiment:** `error` (#b31b25) on `error_container` (#fb5151).
* **Main Background:** `surface` (#f5f7f9).

