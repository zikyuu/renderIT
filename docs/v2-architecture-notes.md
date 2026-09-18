# V2 Architecture Notes: Design-to-Website

Design discussion for a considered V2 direction — not yet built. V1 takes a text prompt and validates the LLM's JSON output against a schema before rendering, single page, no routing. V2 explores swapping the input to a tagged design screenshot, adding multi-page routing with tracked transitions, and a direct-editing UI for images/colors — while staying true to the same core thesis as V1: an unreliable component's output is never trusted until validated.

## V1 vs. V2, side by side

```
V1 (built)                              V2 (this document)
──────────────────────                  ──────────────────────────────────
Text prompt                             Canva screenshot, per page
   │                                    (tagged with N/H/S/F symbols)
   ▼                                       │
LLM (text-only)                            ▼
   │                                    Vision-LLM
   ▼                                       │
JSON (LayoutSpec)                          ▼
   │                                    JSON (LayoutSpec) — same schema
   ▼                                       │
Validate (Zod)                             ▼
 ├─ retry once                         Validate (Zod)
 ├─ fallback                            ├─ retry once
 └─ valid → continue                    └─ fallback → valid → continue
   │                                       │
   ▼                                       ▼
Render (deterministic)                  Linking canvas (manual, no AI):
   │                                     ├─ blue curve: component → page (routing)
   ▼                                     └─ red curve: component → component (tracked transition)
Single static HTML page                    │
                                            ▼
                                         Multi-page site: real routing +
                                         FLIP-style transitions for tracked
                                         elements + simple CSS entrance
                                         animation for untracked new ones
                                            │
                                            ▼
                                         Shipped, safeguarded website
                                         (HTML-escaped, safe URL schemes,
                                          API key never leaves the backend)
```

Everything left of "Validate (Zod)" in V2 is new engineering. Everything from "Validate (Zod)" onward reuses the exact same schema, safeguard, and renderer V1 already has — the retry/fallback pipeline doesn't care whether the JSON came from a text prompt or a vision-LLM reading a screenshot.

## Does this still need the safeguard, or can it just be a direct-editing app?

Raised early: if the entire interaction became "click a cell, drag an image into it," there's no unpredictable input to interpret — the user's actions *are* the structured data, so there's nothing for an LLM/CV step to infer and nothing for a safeguard to catch. That would be a different project (a drag-and-drop page builder), not an extension of this one.

**Resolution: both coexist, at different steps.**
- **Screenshot → JSON structure** (per page): still unreliable input → still needs the same validate/retry/fallback pipeline as V1, unchanged.
- **Direct editing** (drag-drop images, color picking, manual route/transition-wiring): doesn't need the safeguard, because UI constraints make invalid states structurally impossible — a drag target only accepts an image, a curve can only connect to a node that's visibly already on screen. Nothing to validate against failure because there's no failure mode.

## Classical CV vs. a vision-capable LLM

"Computer vision" doesn't have to mean classical CV (OpenCV, trained object detectors). For messy hand-drawn symbol recognition that path is genuinely hard — effectively its own ML project (data collection, labeling, training a custom detector).

**Decision: use a vision-capable LLM** (Claude/GPT-4o, both take image input) with a prompt describing the symbol conventions, outputting the same JSON schema already validated in V1. Reuses ~90% of the existing architecture — same schema, same safeguard, same renderer, just swapping "text prompt" for "image + prompt."

## Input medium: hand-drawn sketch → Canva screenshot

Rescoped from photographing a hand-drawn sketch to using a Canva design screenshot, tagged with small symbols. A digitally-rendered screenshot is a much easier CV problem than a photo of handwriting — clean edges, consistent fonts, no lighting/angle noise — which makes the vision-LLM route more reliable, and would also make a "train your own small classifier" approach (considered earlier, not chosen — see below) far more tractable if ever revisited.

## Symbol vocabulary — NHSF, card is the default

Five type-symbols narrowed to four:

- **N** — nav
- **H** — hero/banner
- **S** — sidebar
- **F** — footer
- *(no explicit symbol)* — **anything unlabeled defaults to a card.** Most page designs have many repeated card-like elements (product tiles, article previews); requiring an explicit tag on every one of them would be repetitive and tedious. Let the common case be free, only require a tag for the four exceptions — same principle already applied elsewhere in this project (optional `subtext`, weighted ratios instead of naming every fraction).
- `grid` needs no symbol at all — a box subdivided into smaller boxes already *is* a grid; the nesting itself communicates that.

Plus two content-level markers, different in kind from the four above:
- **Underlined text** — a link (the underline sits directly on the text it applies to, inherently unambiguous)
- **Eye icon** — image placeholder, sized to fill the actual image region (not corner-pinned like the type symbols, since its job is showing *where*, not labeling *what type*)

**Placement: small, fixed corner (e.g. always top-left) inside the box, not an external callout with a line pointing in.** An external line-to-box callout reintroduces the same "which line points to which box" ambiguity already rejected for cross-page link codes (below) — crossed lines, a forgotten line, two labels drawn close together. A symbol drawn *inside* a box is unambiguously that box's, no tracing required. Keeping it small and cornered (rather than centered) reserves the rest of the box for actual content, solving the clutter concern without giving up unambiguous containment.

**Does mislabeling actually matter?** Content-wise, a hero banner and a card are nearly the same shape (`heading`/`subtext` vs. `title` — both just text fields). The only real difference is render *treatment*: `renderBanner` gives prominent hero styling, `renderCardGroup` gives smaller repeated-grid styling. So a forgotten `H` tag silently becoming a card is low-stakes and cosmetic — worst case, one element renders with less visual emphasis than intended, not a broken or invalid page. Still worth keeping `H` explicit, but only because there's typically one hero per page — the tagging-burden argument that justified dropping the card tag doesn't apply here (you're not tagging 100 heroes, just 1).

## Cross-page routing: two designs compared

### Option 1 — symbolic link codes embedded in the sketch (considered, rejected)

Underlined text + a reference code (e.g. "Shop → A2") marks a link; the code names a target page labeled elsewhere. Refined with an arity-declaring validation scheme: `A1(2)` declares "2 total targets should exist under group A," letting the pipeline check completeness locally and surface a specific error ("B3 missing, please check routing") if something's absent — a genuinely clever self-validating notation, consistent with this project's existing safeguard philosophy.

**Rejected anyway.** It's still fundamentally "a human wrote a reference that might be wrong" — needs its own validation subsystem to catch typos/omissions, and requires the CV/vision step to understand cross-page semantics on top of single-page structure inference, enlarging the scope of the system's highest-uncertainty component.

### Option 2 — manual node-linking in a visual canvas (chosen)

Generate each page's structure independently (single-page screenshot → structure only, no cross-page awareness needed anywhere). Display all generated pages side by side in an editable canvas; the user manually drags a connection between nodes to wire up routing and transitions.

**Why this wins:**
- Direct-manipulation actions need no validation at all — the UI structurally can't produce an invalid connection, since you can only drag to a node that's visibly already on screen.
- Shrinks the riskiest part of the system: the vision-LLM step only ever solves "infer one page's layout from one screenshot," never cross-page semantics.
- Reuses infrastructure already being built for drag-drop image/color editing.
- An explicit node-graph of drawn connections is directly usable for generating actual routing/animation config, more so than parsing intent back out of sketch symbols.

**Tradeoff acknowledged:** one extra manual step per link vs. "drawn once, inferred automatically." Trading a checkable-after-the-fact system for one that's structurally impossible to get wrong.

## Linking canvas: two curve modes

- **Linking mode (blue curves)**: component → **page**. Declares routing — click this nav item, go to that page.
- **Animation mode (red curves)**: component → **component** on another page. Declares "these are the same logical element" — its start position/size on page A and end position/size on page B, so a transition can be computed between them.

Needs an explicit mode toggle in the canvas UI (a tab/switch) so a drag gesture knows which kind of curve it's creating.

**Why the matching for red curves must also stay manual, not auto-inferred:** matching "same element" by text/visual similarity across pages is a fuzzy-matching problem with real failure modes (reworded text, two unrelated elements sharing a label) — the same category of risk already rejected for routing. Consistent answer: same manual-declaration principle, just capturing position/size as well as identity.

## Transitions and entrance animations

Two different animation needs, two different techniques:

- **Tracked elements (red curve exists)**: known start rect and end rect → compute a transform, animate between them. This is the FLIP technique (First, Last, Invert, Play) or the native CSS View Transitions API — a well-known, well-documented technique (this is how Keynote's Magic Move and Canva's own transitions work under the hood), not a research problem.
- **Untracked new elements (no red curve)**: no prior state to interpolate from, so don't try to track them — just apply a generic entrance effect (slide-in-left/right, fade-in). A handful of hand-written `@keyframes` (~20 lines of CSS) covers this without pulling in a dependency; a library like Animate.css is a fine alternative if preferred, but likely unnecessary for 3-4 simple effects.

## Why this isn't "just rebuilding Figma"

Figma already has connector arrows between frames (≈ the blue curves) and "Smart Animate," which auto-detects same-named layers across frames and transitions between them (≈ the red curves). Worth being honest about that resemblance rather than pretending it doesn't exist.

But the curve-based connector UI itself isn't Figma's IP — it's a well-established, domain-general pattern for "declare a connection between two things," used by node-based tools across many unrelated domains (Unreal Engine Blueprints, Node-RED) long before and after Figma. What actually differs is what happens *after* the connection is drawn: **Figma's curve produces a simulated prototype that never leaves Figma. This project's curve produces a real, safeguarded, compiled, functioning website.** Figma explicitly doesn't do "design → deployed working code" — that gap is exactly why a separate category of commercial tools (Locofy, Anima) exists just to bridge it. That's the honest differentiator, worth stating directly in the README pitch.

## Shipping safely: guardrails

Two distinct concerns, both real and both currently unaddressed in V1's code (not just a V2 thing — worth fixing regardless):

- **HTML/script injection**: `renderer.ts` currently interpolates all content fields into HTML template strings with zero escaping. A heading like `Welcome<script>alert(1)</script>` would execute as real JavaScript when the page opens in a browser — classic XSS, unescaped untrusted content in an HTML context. Fix: an HTML-escape helper applied everywhere content is interpolated, plus rejecting unsafe URL schemes (`javascript:`, `data:`) on `href`/link fields, allowing only `http(s)://` or relative paths. Small — hours, not days.
- **API key exposure**: V1 runs as a Node CLI script, so `.env` is safely server-side-only. The moment this becomes a browser-based editing app, the browser must never hold the real Anthropic key directly — anything shipped to client-side JS is publicly inspectable. Needs a proper client/server split: the browser UI calls a thin backend/API route that holds the real key; the browser never talks to Anthropic directly.

Both connect to the same underlying thesis as the rest of this project: never trust unverified input, and now, also never trust the client to keep a secret.

## Font identification and replication

The problem: a user picks a specific (possibly premium/fancy) font in Canva; replicating it exactly in the deployed site matters for fidelity, but naively falling back to a generic font would look bad, and flattening text to an image (floated as an alternative) kills editability — plus accessibility (screen readers can't read image text), SEO (unindexable), and responsiveness (image text doesn't reflow across screen sizes). Flattening should be a last resort, not a default strategy.

**Two real approaches, meaningfully different in reliability:**

1. **Read font data from the design tool's own export, not from pixels.** If pixel-exact typography matters this much, the more reliable path isn't better image-based font guessing — it's getting the data as ground truth. Figma has a well-documented public REST API that returns exact font-family, size, weight, and color for every text node in a design file — this sidesteps the entire "identify a font from an image" problem, since there's no guessing involved at all. Canva's export/API capabilities for this level of design metadata are less certain (historically more consumer-locked than Figma's developer-first API) — worth verifying directly if font fidelity is a priority, since it may be the deciding factor in which design tool V2 actually targets.
2. **If staying screenshot-only (no data export):** dedicated font-identification services exist (WhatTheFont, Font Squirrel's Matcherator) and a vision-LLM can make a reasonable guess, but font ID from a single flattened image is a genuinely hard problem even for specialized tools — usually "closest match," not certain identification, especially for less common fonts. More honest and tractable: classify into a broad **category** (serif / sans-serif / script / display / monospace) rather than claiming to pinpoint the exact family, and map to the closest-fitting free, properly-licensed web font (Google Fonts has a large, well-categorized library covering all these categories).

**A constraint worth flagging regardless of approach:** many premium/Canva-exclusive fonts aren't licensed for embedding on a separate deployed website even if correctly identified — exact visual replication and legal right to redistribute the font file are two different problems, and only one of them is solved by good font recognition.

**Recommendation:** keep text as real HTML/CSS text always, never flatten to image. If font fidelity matters enough to justify it, seriously consider targeting Figma's API instead of (or alongside) Canva screenshots for the structure-extraction step — it turns an unreliable visual-recognition problem into a data-reading problem.

## Font handling, revised: confirmation-first, not upfront-ask

The section above left one thing unresolved: does the pipeline ask upfront, per element, "do you have a font file for this?" — and how does "closest match" actually get computed without a dedicated trained model? Both resolved below.

**"Closest match" doesn't mean comparing pixels against every font in a library.** That's slow and fragile — any difference in text content, size, kerning, or anti-aliasing throws off a raw pixel diff. Real font-recognition tools (WhatTheFont, and Adobe's published DeepFont architecture) use a trained model that extracts *features* from letterforms (stroke width, curve shape, serif presence) and finds nearest neighbors in that feature space — a real trained model, not something to casually reproduce, and not freely available as a drop-in package.

**The practical fix: don't build or find a dedicated font-recognition model at all.** The vision-LLM is already looking at the screenshot for structure — reuse that same call to classify into a coarse category (serif / sans-serif / script / display / monospace, rough weight) instead of guessing an exact font name. One more field on the same JSON output, zero new infrastructure. A small, hand-curated lookup table (written and controlled by us, not guessed) then maps each category to a specific, properly-licensed Google Font. No further guessing after the category call.

**Do this once per page as a type system, not per individual text element.** Real designs have maybe 4-5 type roles total (title, subtitle, subheading, body, maybe a brand mark) — not a different font per heading instance. Classifying "what's this page's type system" once is both more realistic to how design actually works and cuts the inference/tagging burden dramatically.

**The upfront "do you have a file" question is removed entirely, replaced with a confirmation step.** Rather than asking per-element before processing, the pipeline always generates its best automatic category-match first (per the type-system pass above), then shows a confirmation screen previewing each type role rendered in its matched font. If a match looks wrong for a given role, the user uploads their real file right there to override just that one. Less friction for the common case (most people never need to touch the upload option), full fidelity available for anyone who cares enough to fix a specific mismatch. Show, then correct — not interrogate upfront.

**The `C` tag: reused, not new.** Freed up since "card" became the unlabeled default (no explicit card tag was ever actually used, so no collision) — `C` now means "custom: treat as source of truth, always flatten to transparent PNG, skip font-matching entirely for this element, whether or not a file could theoretically be supplied." This is a deliberate, explicit escape hatch distinct from the upload-override above — for content that was never really "text in a font" to begin with, like a stylized brand logotype/wordmark. Real elements matched via CV/vision-LLM inference don't need this; this tag exists specifically so the user doesn't have to rely on inference for the one case where exact-pixel reproduction is what they actually want.

## Custom / fluid-shaped cards

The problem: not every card in a real design is a plain rectangle — dynamic/organic shapes are common in modern design.

**This is more tractable than the font problem, not less.** CSS already has native mechanisms for non-rectangular regions: `border-radius` for rounded rectangles, `clip-path: polygon(...)` for angular custom shapes, `clip-path` with an SVG path for genuinely organic/freeform outlines. Getting the *shape data* is also a well-established classical CV operation — edge detection + contour tracing (OpenCV's `findContours`, no ML training required) reliably extracts a boundary outline from a clearly-drawn shape against a plain background. This is one of the more reliable classical CV techniques available, unlike messy symbol/handwriting recognition.

**Architectural implication:** every section's shape is currently *implicit* — always a rectangle, entirely determined by `span`/`height`. Supporting custom shapes means adding a new optional schema field (e.g. `clipPath?: string`, an SVG path or polygon coordinate list) that the renderer applies via CSS `clip-path` when present. A real, contained schema/renderer extension — not a rearchitecture — but still additional scope stacked on everything else in this document.

## Content model, revised: collapse to Rectangle + Custom, measured per-element properties

Supersedes the "Symbol vocabulary — NHSF, card is the default" section above, and the pin-per-type discussion that followed it. Worth documenting the reasoning in full since this is a genuine rearchitecture, not a tweak — kept both versions here rather than deleting the old one, same pattern as every other revision in this doc.

**The question that triggered it:** a hero banner and a card are already nearly the same shape (`heading`/`subtext` vs. `title` — both just text fields). Does the type distinction (nav/banner/sidebar/footer/card) need to exist at all, or does everything just collapse to "rectangle vs. custom shape"?

**Shape (rectangle vs. custom) genuinely does collapse to two — this was never really a separate type.** A plain section (no `clipPath`) is implicitly a rectangle; `clipPath` present means custom. Falls straight out of what CV finds when it traces a contour. Nothing changes here.

**Content type looked like it couldn't collapse — and the earlier reasoning for that was right, for the old design.** The 5 typed sections existed to give the renderer an unambiguous content shape (nav needs links, banner needs heading+subtext) without guessing from which optional fields happen to be present. A single generic block was already considered and rejected for exactly that ambiguity: the same field shape could mean different things depending on which optional fields were filled in.

**What actually changes the answer: font size, underline, and image-vs-flat-fill are measured, not guessed.** A footer with subtext, or a hero with no subtext but a small inline link, used to be awkward fits for a fixed field set. Once every text element carries its own measured font size and link status (read directly from the design, via CV), there's no "which type is this" question left to answer — it's just however many text elements actually exist, each sized to what was actually measured. This is different from the earlier-rejected generic-block idea in a specific way: that one was ambiguous because the *same* data shape could mean different things; this one isn't ambiguous, because each element's role is read off a measured property, not inferred from a combination of optional fields.

**New schema shape** (replaces `banner`/`card-group`/`sidebar`/`nav`/`footer` with one type):
```typescript
TextElement:      { text, fontSize, x, y, isLink?, linkTarget? }
ImageRegion:       { x, y, width, height, clipPath?, imageUrl? }
RectangleSection:  { ...BaseSection, type: "rectangle", clipPath?, textElements?, imageRegions? }
Section = RectangleSection | GridSection
```
`grid` is untouched — it was never a content-type question, it's the layout/nesting primitive, a genuinely separate concern from what's inside a leaf.

**What this means for detection, concretely:**
- **Text size** — measured font size from CV, not a forced heading/subtext dichotomy.
- **Links** — underlined text, detected directly; becomes a node the linking canvas can later connect to a page or another element.
- **Images** — detected via *color variance* within a region (a flat fill has low variance across its pixels, a photo has high variance) — a simple statistical measure over pixel values, no model needed, same classical-CV toolchain already in place for custom shapes.

**Open question this surfaces, not yet resolved:** pins were agreed as the mechanism for marking type + location via a UI. With type no longer needing to be manually chosen (it now falls out of measured properties), pins may only be strictly necessary going forward for marking *custom* (non-rectangular) regions — plain rectangles might be auto-detectable via contour *hierarchy* (OpenCV's `RETR_TREE` mode returns which contours are nested inside which, which is also exactly the grouping/nesting signal `grid` structure needs) without a pin at all. Worth a deliberate decision before building the UI, not assumed either way.

**Note on V1:** this model depends on having an actual image to measure properties from — V1's text-prompt pipeline has no equivalent signal (nothing to visually measure font size or color variance from). The original 6-type schema likely still applies to V1 specifically; this is a V2 (image-driven) evolution, not a replacement for the text-prompt path.

## Two separate theses, not one pipeline with two input modes

This crystallizes something that had been building implicitly across every decision above (measured font size, CV-measured position, pins instead of inferred tags, contour-traced shapes) but was never stated outright until now. Supersedes the "Classical CV vs. a vision-capable LLM" decision above and the "V1 vs. V2 side by side" diagram at the top of this document, both of which still routed V2 through a vision-LLM.

**V1's thesis: safely use an unreliable generative component.** A text prompt is inherently unstructured and non-deterministic to interpret — there's no way to get structure out of "a store homepage with a sidebar of filters" except language understanding, which only an LLM provides. The whole point of V1's schema/validate/retry/fallback pipeline is treating that LLM as a flaky, un-trusted third party: constrain its output, verify before use, degrade gracefully on failure. This doesn't change and can't be removed — it's structurally required by what V1 is doing.

**V2's thesis: reproduce a design exactly, via deterministic measurement, not generation.** Once the goal became "treat the mockup as source of truth — exact positioning, fonts, styles, custom cutouts" rather than "safely interpret ambiguous instructions," the vision-LLM stopped being the right tool for structure and content extraction. A vision-LLM *estimates* what it sees; CV and OCR *measure* it. Concretely:

- **CV** (already underway) — measures geometry: contour-detected region boundaries, font size (glyph height), underline presence, image-vs-flat-fill (color variance).
- **OCR** (a dedicated text-recognition engine — Tesseract/EasyOCR, not a language model) — reads the actual text content of each region. This replaces the vision-LLM's role for V2 specifically. Real tradeoff acknowledged: OCR is measurably worse than a vision-LLM at stylized/decorative/script fonts, which are common in the exact kind of designs this project targets — worth watching for in testing, not assumed away.
- **A fine-tuned classifier** (supervised, trained on a labeled dataset built by hand) — font category (serif/sans/script/display/monospace), the one place a trainable model still earns its place, since it's a clean, scoped classification task distinct from geometry measurement.

**What happens to validate/retry/fallback in V2:** it doesn't disappear, it's repurposed. There's no more probabilistic generator to guard against — the JSON gets constructed directly in code from CV+OCR+classifier outputs, so `safeParse` becomes a correctness check on that construction code, not a safeguard against hallucination. The "something went wrong, ask the user to fix it" pattern still applies, just retargeted: not "retry the LLM with the error," but "CV couldn't find a closed outline near this marker, please add a visible border" — already the exact design for the custom-shape-detection failure case, now generalized as the model for every CV/OCR uncertainty in V2, rather than an LLM retry loop.

**Interim state, while CV+OCR aren't fully wired in yet:** `generateSpecFromScreenshot` (vision-LLM) is being kept and run as a baseline/comparison tool during this transition — useful for seeing what a "good enough" result looks like and for testing the new `Rectangle`/`Grid` schema shape end-to-end before CV+OCR replace it. It is not the intended long-term V2 mechanism.

## Status

Exploratory — design reasoning only, not yet implemented. Revisit and re-scope before starting a build.

**Honest scope note:** this document now covers screenshot-based structure inference, NHSF tagging, a two-mode linking canvas, tracked transitions, multi-page routing, injection/API-key guardrails, font fidelity, and custom shapes. That's a large surface area for one project. Worth a deliberate prioritization pass — decide what's core V2 vs. what's KIV for a later phase — before starting to build, the same discipline already applied to V1's own scope.
