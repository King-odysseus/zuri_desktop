<!-- kai:agents -->
# Working on this project
This project was planned in the KAI Project Studio. Everything you need to continue is written down in `.kai/spec`, so read it before you change anything.
## Read first
- `.kai/spec/status.md` for what is done, what is in progress and what to do next
- `.kai/spec/brief.md`
- `.kai/spec/prd.md`
- `.kai/spec/stories.md`
- `.kai/spec/stack.md`
- `.kai/spec/flows.md`
- `.kai/spec/design/style-guide.md`
- `.kai/spec/design/tokens.json`
- `.kai/spec/pages.md`
- `.kai/spec/decisions.md`
- `.kai/spec/architecture.md`
- `.kai/spec/conventions.md`
- `.kai/spec/acceptance.md`
- `.kai/spec/risks.md`
- `.kai/spec/glossary.md`
- `.kai/spec/setup.md`
## How to work
- Take one card at a time from the board. If the `kai-project` tools are available, use `get_board`, then `claim_task` before you start and `submit_output` when you finish.
- Never mark a card done yourself. A card reaches done only through a passing check, so hand it over for review instead.
- Follow `.kai/spec/conventions.md` for naming, layout, tests and commands, and respect the decisions in `.kai/spec/decisions.md`: do not reverse one without saying why.
- If the brief or an artifact is wrong or missing something, say so in your summary instead of quietly working around it.

## Building screens
- The page template has <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">. Without it a phone shows a shrunken desktop page.
- Build for the phone first, then widen. The app fills the window: html, body and the root are 100% wide with min-height 100dvh (dvh, not vh, so a phone address bar does not cut it off).
- Full width: the header, top bar and every other bar span the whole window (width 100%, no max-width and no side margin on the bar itself), and the main area fills the rest of the window height. Put any max-width on the content inside the bar or the page, never on the bar or the app shell, so no bare strip is left beside a bar at 1920px.
- Large screens: never leave the content against the left edge with a dead strip on the right. Centre it in a max-width container (about 1200 to 1440px) with equal margins, or let the layout grow into a sidebar and a multi-column grid. 1920px is checked as well as 1280px.
- Phones: an app with two or more top-level destinations keeps its navigation on screen at all times. Use a bottom tab bar of 3 to 5 items, position fixed or sticky at the bottom with padding-bottom: env(safe-area-inset-bottom). Do not hide the navigation behind a hamburger. Below about 768px the desktop sidebar becomes that bar, and extra destinations go under a "More" item.
- Scrolling: the content scrolls and the bar does not. The scrolling area has padding-bottom of at least the bar height plus the safe area, so the last item is never covered. Headers may be sticky. Nothing scrolls sideways at any width. Tap targets are at least 44px.

## Using the browser
- Start with browser_tabs, action "list". If it shows tabs you did not open, other agents are using this browser: open your own with browser_tabs, action "new", and work only in it. Never navigate, resize or close a tab that is not yours. If it shows a single blank tab, use that one.
- Stay in that one tab. Navigate it with browser_navigate and change its size with browser_resize (390, 768, 1280 and 1920 wide) to look at each size. Do not open a second tab or window to compare sizes, do not open links in a new window, and do not start another browser.
- At 390px wide, scroll to the bottom and confirm the navigation is still visible and the last item is not covered. At 1920px wide, confirm no large strip of the screen is empty.
- browser_resize fixes a tab at that size, and the tab then ignores its window: maximising the browser changes nothing in it, and the rest of the window sits empty. So do all your resizing in a tab you opened yourself, never in a tab the person was already looking at, and close it when you finish with browser_tabs, action "close". Closing the tab removes the fixed size. If you used the single blank tab, close that one too.
- When you finish, close the tab you opened with browser_tabs, action "close". Do not call browser_close: the browser is shared and will refuse.

_This file is maintained by KAI while it carries the first line above. Delete that line to take it over._
