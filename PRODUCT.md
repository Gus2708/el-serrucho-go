# Product

## Register

product

## Users

Hardware store staff at Ferretería El Serrucho (Venezuela): 2 roles — admin and empleado. Used in-store on phones/tablets, often mid-transaction, under ambient retail light. Admin accesses reports, change orders, and presupuestos. Employees handle sales lookups, inventory checks, and WhatsApp bot request resolution. The device is frequently handed back and forth; interactions must be fast and scannable.

## Product Purpose

El Serrucho to GO is a real-time inventory and sales dashboard PWA. It syncs from a local Hybrid POS system via a Python widget to Supabase. The app gives the team live visibility into stock, margins, and daily revenue without touching the POS terminal. Success: staff can answer any product or sales question in under 10 seconds from their phone.

## Brand Personality

Sharp. Functional. Gold.

The gold (#F5B200) is the saw blade from the physical store's logo — it carries every primary action and status signal. The background is near-black (#0C0C0C), not stylized dark mode: it's chosen for legibility in a bright retail environment. JetBrains Mono everywhere signals precision; this is an inventory tool, not a lifestyle app.

## Anti-references

- Consumer apps with soft pastel palettes and rounded everything (Notion, Linear) — wrong register and wrong density for a hardware store
- SaaS dashboard cream/sand backgrounds — wrong for bright retail light and wrong brand
- Any design that feels like "dark mode for aesthetics" rather than "dark for legibility"
- WhatsApp Business green anywhere in the UI (used by the bot flow, must stay isolated to that context)

## Design Principles

1. **Speed over polish** — every interaction is mid-task; transitions earn their time or they don't exist.
2. **State always visible** — sync status, stock levels, and margin signals must be readable at a glance without tapping into anything.
3. **Density without clutter** — 7,200 products in a list; information must be compact but scannable. No cards where a row will do.
4. **Gold is a signal, not decoration** — primary color marks only: current action, active state, call to action. Nowhere else.
5. **Fail visibly, recover fast** — errors and warnings must interrupt enough to be noticed, recover in one tap.

## Accessibility & Inclusion

- High contrast already built in (near-black bg, white text) — must maintain contrast ratios as components are added
- All interactive targets ≥ 44×44px
- No color-only state encoding (always pair color with icon or text)
- Reduced motion: any animation must have a zero-motion fallback
