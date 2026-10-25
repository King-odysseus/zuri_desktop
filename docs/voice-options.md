# Voice in Zuri: what it does today and what it could use

Research note, 2026-10-25. Kept so the price work does not have to be redone when
voice comes up again.

## What voice does today

The microphone button in the composer is browser dictation, not a model call.
`ChatPanel.jsx` creates `window.SpeechRecognition` (or `webkitSpeechRecognition`),
streams the interim transcript into the draft, and stops there. Consequences:

- There is no provider key involved, no cost per use, and no model in the path.
- It only writes text into the composer. Zuri never speaks a reply back.
- It depends on Chromium's speech service, so quality and language support are
  whatever that build offers, and an offline or locked-down machine gets nothing.
- Nothing is stored: the transcript is ordinary draft text from that point on.

So "voice chat" as a person would recognise it, meaning you talk and Zuri talks
back and you can interrupt it, does not exist yet.

## Which suppliers can actually do voice

| Supplier | In Zuri today | Voice capability |
| --- | --- | --- |
| OpenAI | yes | Full: dictation, speech out, live realtime conversation |
| DeepSeek | yes | No audio endpoints |
| Moonshot (Kimi) | yes | None. Kimi's own API help page states TTS and ASR are not supported and suggests pairing with a third-party voice service |
| Anthropic | yes | No voice models |
| Z.ai (GLM) | yes | Not verified. A voice endpoint may exist but could not be confirmed from a current price list, so do not quote it until checked |
| Google (Gemini) | no | Full: Gemini Live with native audio in and out |
| ElevenLabs | no | Full: speech in, speech out, and hosted voice agents |
| Deepgram | no | Speech in (and out) only, very cheap |

Read that as: Zuri's two cheapest chat models cannot be spoken to directly. Voice
has to be its own lane that hands a transcript to whichever chat model is chosen,
or a realtime model that replaces chat for the duration of the conversation.

## The three lanes, with prices

List prices from supplier pages at research time. Naira figures use the 1,600
naira-per-dollar rate the server already defaults to (`USD_NGN_RATE`). A minute of
speech does not tokenise identically on every supplier, so treat per-minute Naira
as an estimate to be confirmed, not a billing fact. The catalogue in
`server/src/models.js` already carries a warning that supplier prices are
placeholders to verify.

### Lane 1: better dictation

Turns speech into text, then the normal chat route answers in text.

- Deepgram Nova-3, streaming: about 0.0048 to 0.0077 USD per minute, so roughly
  8 to 12 naira per minute. Cheapest credible live dictation.
- OpenAI speech-to-text on the existing key: usable today with no new supplier.
- Browser dictation: free, stays as the fallback when no key is present.

### Lane 2: spoken answers

Reads Zuri's reply aloud. This is the cheapest visible upgrade and it works with
every chat model, including DeepSeek and Kimi.

- OpenAI speech: cents per answer on the key Zuri already supports.
- ElevenLabs Flash: about 0.04 USD per 1,000 characters, so roughly 64 naira per
  minute of speech. Noticeably better sounding than most alternatives.
- Operating system or browser voices: free, but flat.

### Lane 3: realtime conversation

Speech in and speech out in one session, with interruptions.

- Google Gemini Live, native audio: about 3 USD per million audio input tokens and
  12 USD per million audio output tokens, which works out near 48 naira a minute
  for a normal back-and-forth. Cheapest realtime option by a wide margin, but
  Google is not a Zuri supplier yet, so it needs a new supplier entry, a new key,
  and a catalogue row.
- OpenAI Realtime: roughly 0.06 USD a minute of the person's speech and about
  0.24 USD a minute of Zuri's, so call it 300 to 500 naira a minute of two-way
  talk. Most natural and most controllable, and the key is already supported.
- ElevenLabs voice agents: about 0.08 USD per minute, roughly 128 naira, plus the
  model cost on top.

## Recommendation, when this is picked up

Two steps, cheapest first.

1. Lane 2 plus a paid dictation fallback from Lane 1, on the OpenAI key. This
   upgrades voice for every chat model without adding a supplier, and gives the
   person something they can feel immediately.
2. Lane 3 afterwards, on whichever of Google or OpenAI wins on measured cost. Do
   not build both.

## Decision on 2026-10-25

Voice stays as browser dictation for now. The research above is kept on record and
nothing in the app changed. Revisit when voice moves up the list.

## What to check before implementing

- Confirm Z.ai's voice position directly, since it was not verified here.
- Confirm the per-minute Naira figure on the supplier's current price list before
  a row goes into the catalogue, and record which supplier tokens a minute of
  audio actually consumes.
- Decide whether voice is billed to the Zuri plan like chat, which needs a usage
  meter that counts seconds rather than tokens.
- Microphone permission is currently granted to Zuri in `main.js` for the existing
  dictation. Any new capture path must reuse that, not widen it.
