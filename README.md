# LAYOUTry

A plain-English page description → a validated JSON layout → a rendered page. The LLM never touches HTML directly.

## Main learning objective

This was a project to learn how to design a *contract* for an unreliable, non-deterministic component (an LLM) so it's safe to depend on — schema design, prompt design, and a validate/retry/fallback safeguard, the same shape as tool-use/function-calling. The model's language understanding isn't the interesting part (that's pretrained capability); the interesting part is constraining it to a fixed vocabulary the model can reliably hit and a renderer can exhaustively handle.

## Pipeline

```
prompt → LLM (fills the JSON schema) → validate (Zod)
   ├─ invalid → retry once with the error fed back
   ├─ still invalid → fall back to a hardcoded default (never a raw error)
   └─ valid → render (pure code, dispatches on "type") → HTML
```

## Learning notes

Design iterations, roughly in order — full reasoning in [`docs/schema-design-decisions.md`](docs/schema-design-decisions.md):

**1. Position: 3×3 named-zone enum** — simplest, but a section spanning multiple cells has nowhere to go:

```
┌─────────────┬─────────────┬─────────────┐
│  top-left   │ top-center  │  top-right  │
├─────────────┼─────────────┼─────────────┤
│ middle-left │middle-center│ middle-right│
├─────────────┼─────────────┼─────────────┤
│ bottom-left │bottom-center│ bottom-right│
└─────────────┴─────────────┴─────────────┘

┌─────────────────────────────────────────┐
│     "top half" — spans all 3 top cells    │  ← no single enum value for this
├─────────────┬─────────────┬─────────────┤
│ bottom-left │bottom-center│ bottom-right│
└─────────────┴─────────────┴─────────────┘
```
Broke immediately.

**2. Position: coordinates + span** (`rowStart`/`rowEnd`/`colStart`/`colEnd`, like real CSS Grid) — fixed spanning:

```
        col 1     col 2     col 3
      ┌─────────────────────────────┐  row 1
      │     hero (colStart:1,        │
      │      colEnd:4 → spans 3)     │
      ├─────────┬─────────┬──────────┤  row 2
      │   new    │  best   │ contact │
      │ arrivals │ sellers │ service │
      └─────────┴─────────┴──────────┘
```
Still one level deep — a cell can't contain more cells — and asking the model for 4 correct numbers per section is a harder generation task than picking a label.

**3. Position: recursive tree** — a `grid` section whose children (`row` or `column`) can themselves be `grid`s:

```
sections: [                                    ┌───────────────────────────┐
  banner (height: 2)                           │       hero banner          │
                                                ├─────────┬─────────┬────────┤
  grid (direction: row)                        │   new   │  best   │contact │
    ├─ card-group "New Arrivals"               │ arrivals│ sellers │service │
    ├─ card-group "Best Sellers"                └─────────┴─────────┴────────┘
    └─ contact-block "Customer Service"
]
```
Any depth, any spanning, at the cost of needing `z.lazy()` to handle the schema referencing itself (a `grid`'s children are `Section`s, and `Section` includes `grid`).

**4. Sizing: named fractions → weighted ratios** — `"half"`/`"third"`/`"quarter"` hit a wall: a narrow sidebar needs `"three-quarters"` to pair with `"quarter"`, and that's true for every fraction, forever. Switched to small integer weights (`1`–`5`) rendered via `flex-grow` — same idea as CSS `fr` units, so any ratio (`1:4`, `1:2:1`, ...) works with zero new schema.

**5. Content: 5 typed sections vs. 1 generic `block`** — a generic block with optional fields would've pushed "which combination of fields means nav vs. footer" out of Zod (typed, exhaustive) and into untyped if/else in the renderer. Kept 5 types.

## Setup

```bash
git clone https://github.com/zikyuu/LAYOUTry.git
cd LAYOUTry
npm install
cp .env.example .env   # then paste in your own Anthropic key
```

## Running it

```bash
npx tsx src/dev.ts          # full pipeline, real LLM call → output.html
npx tsx src/retry-test.ts   # proves the retry/fallback logic works, in isolation
```

No API key handy? Paste the system prompt from `src/llm.ts` + your own page description into Claude/ChatGPT's chat, save the JSON it returns as `manual-spec.json`, then:
```bash
npx tsx src/manual-test.ts
```

## Demo

Three prompts, chosen deliberately: one straightforward, one phrased unlike the system prompt's own example (generalization, not memorization), one that stresses the recursive nesting.

### Prompt 1
```
<!-- prompt goes here -->
```
![demo 1](docs/screenshots/demo-1.png)

### Prompt 2
```
<!-- prompt goes here -->
```
![demo 2](docs/screenshots/demo-2.png)

### Prompt 3
```
<!-- prompt goes here -->
```
![demo 3](docs/screenshots/demo-3.png)

## Tech stack

TypeScript, Zod (schema + validation), Anthropic API. Renderer is hand-written HTML/CSS flexbox, no frontend framework — the point of this project is the contract around the LLM, not UI polish.

## Project structure

```
src/
  schema.ts       - Zod schema (6 section types, recursive grid nesting)
  renderer.ts      - validated Section → HTML, pure functions
  llm.ts           - Anthropic client + system prompt
  retry.ts         - getValidatedSpec: the retry/fallback safeguard
  dev.ts           - full pipeline entry point
  manual-test.ts   - validate/render a pasted JSON spec, no API needed
  retry-test.ts    - proves the safeguard in isolation
docs/
  schema-design-decisions.md - full reasoning behind every tradeoff above
```

## What's next (KIV)

"Edit" prompts to modify an existing layout, rather than generate fresh each time. Deliberately deferred — same pipeline, different prompt, not a new skill demonstrated. Reasoning in `docs/schema-design-decisions.md`.
