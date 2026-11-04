# Zuri design direction

Applies to the web UI mockups in `docs/mockups/heroui.html`. Mockup only; no app code follows this yet.

## Colour: white, blue, navy and bronze only
| Role | Value |
|---|---|
| Page background | #ffffff (pure white, everywhere) |
| Soft fill (cards, composer, hover) | #f3f6fc, then #e6edfa and #d3def5 for stronger fills |
| Text and solid buttons (navy) | #0d1b3a |
| Muted text | #55627f, faint #7f8aa3 |
| Blue (selected row, user bubble fill, links, progress, switches) | #2f6fed, soft #e8effc, ink #1b47b8 |
| Bronze (admin marker, plan badge, warnings, approvals, highlights) | #9a6830, soft #f6ede2, ink #7a4f1f |

No green, red, violet, coral or amber. Status uses blue for good, bronze for attention, navy for urgent.
No dark theme in these mockups: the page is always white.

## Structure
- Normal users see a ChatGPT-style view only: history sidebar (New chat, Tasks and reminders, Projects, Recents, account menu), a centred conversation and one message box. No dashboard, no stats, no side panel.
- The dashboard, user list, plans, models, usage and billing live in an Admin area. Only admins can open it. A normal user who reaches an admin address sees a "This area is for admins" page.
- Admins get "Switch to admin view" in the account menu and in Settings. The admin sidebar has "Switch to user view" at the top.
- Phone: the sidebar becomes a bottom tab bar that is always on screen (Chat, History, Tasks, Settings, plus Admin for admins).

## Shape and rules
- Cards and buttons: no border, no shadow. Only floating menus cast a shadow.
- Radii: cards 20px, composer 28px, inputs 14px, buttons and chips fully rounded.
- Tap targets at least 44px on touch. Nothing scrolls sideways. Bars span the full width.
- No em dashes, no emojis.

## Implementation brief (real apps)
Reference mockup: `docs/mockups/heroui.html` with `heroui.js` (open it through a static server). Match its look and structure.

- Web app (`web/`): one stylesheet, `web/src/styles.css`. Desktop app (`src/renderer-react/`): one stylesheet, `src/renderer-react/app.css`. Do not add a CSS file, style block or per-component stylesheet. New markup uses Tailwind utility classes and the Flowbite components the project already uses.
- Keep existing class names, props, routes, IPC channels and API calls working. This is a visual and navigation change, not a data change.
- Light theme is the default and is pure white (#ffffff) with blue, navy and bronze only. The existing dark theme may stay as an optional choice, but it must also use only navy, blue and bronze (no violet, green, red or amber hues).
- Status colours: blue = good or selected, bronze = attention or warning, navy = urgent or destructive. Errors may use navy text on a pale bronze fill with a warning icon.
- Cards and buttons: no border and no shadow. Floating menus and drawers may cast a shadow.
- Navigation for normal users has no dashboard. The old Overview, Usage, Plans, Billing and Account screens move into a Settings area. The Admin area (people, models, plans, platform health) is reachable only by admins, via "Switch to admin view" in the account menu, with "Switch to user view" to return. A non-admin who opens an admin address sees "This area is for admins". The server stays the real authority.
- Phones (below 900px on the web): a bottom tab bar that is always on screen, fixed to the bottom, padded with env(safe-area-inset-bottom). No hamburger-only navigation. Content scrolls and has bottom padding of at least the bar height plus the safe area.
