# The ChatGPT interface, measured: icons, layout and what Zuri should copy

Deep dive, 2026-10-28. Companion to `docs/chatgpt-parity.md`, which covers
behaviour and feature gaps. This one covers what makes the product *look* like
ChatGPT: the icon set, the measured layout, and what of each fits the
infrastructure Zuri already pays for.

Two kinds of statement, kept apart:

- **Measured**: taken from a published, itemised comparison of OpenAI's own icon
  package against Lucide (755 glyphs, MIT), and from a design teardown that lists
  ChatGPT's tokens as values rather than impressions.
- **Read from this repository**: the Zuri column, with the file each claim came
  from.

Anything I could not confirm is in section 6 and should not be quoted as fact.

---

## 1. The icon set, in numbers

This is the most copied and least understood part of the look. OpenAI does not
ship a themed icon font; it ships a hand-drawn set on a strict grid, and the
strictness is the style.

| Property | OpenAI | Lucide default | What it means |
| --- | --- | --- | --- |
| Grid | 24 units | 24 units | Same, so the two can be mixed without rescaling |
| Stroke | 2 units | 1.75 units | At 16px that is 1.33px against 1.17px. The Lucide line looks lighter and more "demo" |
| Caps and joins | round | round | Same |
| Punctuation | filled dot, diameter about 2.3 to 2.5 units | a 1 unit line segment | The reason a ChatGPT "more" or "alert" reads crisply at 16px and a Lucide one does not |
| Corner radius on closed shapes | about 4 units on a triangle, 3.5 on a square, 3 on a hexagon, 1 on an inner corner | 2 to 3, often sharp | Open corners read as "drawn"; sharp ones read as "generated" |
| Distinguishable elements per glyph | at most 3 | often 5 to 8 | A gear with eight teeth is the classic offender |
| Outline and filled twins | 43 pairs, filled by knocking detail out with a mask | none | Filled is the *selected* state, not a second icon |
| Sizes actually used | 16px in chrome, 20px for a large empty state, 24px in a page header | any | A size ladder, not free choice |

Two consequences worth stating plainly:

1. **A heavier stroke and filled punctuation do most of the work.** Swapping a
   gear for a hexagon matters less than fixing a hairline dot at 16px.
2. **Filled twins are a state machine, not decoration.** ChatGPT fills the glyph
   that stands for something switched on. Drawing a second, different icon for
   the same meaning is what makes imitation sets look wrong.

## 2. What Zuri does now

One family, defined once in `src/renderer-react/Icons.jsx`:

- Lucide supplies the geometry, because it is already a dependency and draws on
  the same 24 grid with round caps.
- Every glyph is wrapped by `family()`, which fixes the stroke at 2 units, keeps
  the size on the ladder (`ICON_SIZE.sm|md|lg|xl` = 16/18/20/24), marks the glyph
  `aria-hidden` unless it stands alone, and offers a `filled` state.
- Six glyphs are drawn in the file instead, because Lucide's metaphor is visibly
  different from ChatGPT's: **More** (three filled dots), **Settings** (hexagon
  and ring, not an eight tooth gear), **Spark** (one large star and one small),
  **New chat** (a pencil on a page), **Panel** (a frame with one divider) and
  **Stop** (a filled square).
- `web/src/components/Icons.jsx` re-exports the same family, so the browser and
  the desktop window cannot drift. The web pages that used to import Lucide
  directly now import the family; `scripts/selftest.js` fails the build if a page
  reaches for the package again.

## 3. Layout, measured

From the teardown tokens, with Zuri's state beside each.

| Area | ChatGPT | Zuri today |
| --- | --- | --- |
| Control radius | 10px on buttons, sidebar rows and cards | `--radius-lg` / `--radius-md`, close |
| Separation | hairline borders, essentially no shadows | hairlines, shadows removed in the last pass |
| Ink | near black `#0d0d0d` graphite; no chromatic colour in chrome | dark navy, by request; still no chromatic chrome |
| Hover | a 5% black veil `#0000000d` | `--nav-hover`, equivalent idea |
| Type | system face, 14/16/24, weights 400/500/600 | same family of choices |
| Rhythm | 6px inside a group, 24px between groups | 2 to 4px row gaps, 24px sections |
| Sidebar | new chat, search, library, projects, then history grouped under Today / Yesterday / Previous 7 days / Previous 30 days / Older | search, then history. **Period headings added this turn** |
| Chat row | opens on click; a menu holds rename, share, archive, delete | opens on click; pencil and bin sit on the row itself |
| Main column | about 720 to 768px, centred | capped and centred |
| Composer | attach, tools, model picker, dictation, send, all inside one rounded field | attach, dictation, model chip, send. Matches |

The period headings are the cheapest large win, because a long history stops
reading as an undifferentiated column. They are drawn from a `data-group`
attribute on the first row of each stretch (`web/src/views/ChatView.jsx`,
`withGroupHeadings`), so the list keeps one map and the styling stays in CSS.

## 4. What the infrastructure can actually carry

This is the part that decides which features are worth building.

**Railway runs the API and the database.** It is the wrong place for file bytes:
a 10MB photo passing through the Node process costs memory and egress on every
upload and every redownload, and it is the first thing to fall over under load.
The rule that follows is simple: **Railway signs, the browser uploads, Cloudinary
stores.** The server issues a signature and a folder for a short window; the
client posts the file straight to Cloudinary; only the resulting URL comes back.
Railway then carries a few hundred bytes per upload instead of megabytes.

**Cloudinary is metered in credits, not gigabytes.** Its free allowance is a
small number of monthly credits where one credit buys roughly a gigabyte of
storage or of bandwidth or a thousand transformations. That is plenty for
documents and screenshots at Zuri's scale, and it is not plenty for video. So:

| Feature | Fits the current tier? | Why |
| --- | --- | --- |
| Image and PDF attachments, capped at 10MB | Yes | A few hundred files is a fraction of the allowance; delivery is a CDN URL |
| Thumbnails for attachments | Yes | One transformation per thumbnail, generated once and cached |
| Voice notes | Only if short and rare | Audio is the worst bytes per minute of anything here |
| Video, or full document preview rendering | No | Both burn credits faster than the plan can absorb |
| Image generation output stored per chat | Careful | Every generated picture is a stored asset; it needs a retention rule |

Square that with a hard fact from `docs/chatgpt-parity.md`: Zuri currently sends
**no** attachment bytes at all. A file's text is extracted on the device, folded
into the prompt, and the turn is marked local-only so it never syncs. That is
honest but limiting, and Cloudinary is exactly the piece that would let an
attachment become a real, shared part of the conversation.

**What should stay on Railway only, unchanged:** the dash rule, conversation
search, provider streaming, plan and quota checks. All of it is text and CPU per
request, which is what a small Node service is for.

## 5. What this turn changed, and what it did not

Done:

1. A single icon family across the web app, the desktop window and the landing
   page, drawn to the measured spec, with the six redrawn metaphors.
2. Period headings in the saved chat list.
3. A house style for replies that forbids em and en dashes, sent as an
   instruction with every conversation and enforced by a rewrite on the way out,
   including the streamed path. Code is left untouched, because a dash inside a
   string literal is the program's own content.
4. The check that guards all three: a parity test proving the server's copy and
   the app's copy of the style agree, and that both sides apply it.

5. **Attachments through Cloudinary.** The account signs an upload in
   `server/src/uploads.js`, the browser posts the file straight to the CDN, and the
   message carries only a delivery URL. The server refuses any URL that is not this
   cloud's own host and folder, because a message that could point anywhere would
   make a chat a way to fetch whatever an attacker chose. A picture is drawn at
   240px in the thread; a PDF is a named row, since a page thumbnail is another paid
   transformation. A text file still travels inside the message, which keeps it
   searchable and costs nothing.
6. **Pin and archive.** Both are flags on the conversation, so the list stays one
   query: pinned first, then most recent, and the archive is left out unless the
   request asks for it with `?archived=1`. Pinning a filed chat lifts it back out,
   because a chat that is both held and filed would sit in neither list.
7. **One actions menu per chat row**, holding rename, pin, archive and a two-step
   delete, replacing the four icons that used to sit beside the title and squeeze it.

Still open:

1. **An archive screen.** The archive can be read through the API but no page shows
   it yet, so a filed chat is currently reachable only by pinning it back.
2. **Filled twins in use.** The family exposes `filled` and the pin now uses it, but
   the bell and the thumbs still do not.
3. **A reply action row in ChatGPT's order**: copy, thumbs up, thumbs down,
   regenerate, then a `more`. Zuri has copy, edit, share and regenerate already, in
   a different order.
4. **Attachment limits as a plan feature.** The cap is one number for everyone.
   Cloudinary credits are real money, so a larger upload should belong to a paying
   plan rather than being free to any account.
