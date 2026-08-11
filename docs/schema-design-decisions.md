# Schema Architecture Decisions

Design notes from planning the layout schema for **PromptLayout** — the part of the project that decides how a `Section` in the JSON `LayoutSpec` knows *where* it sits on the page. This is written up on purpose: the schema shape is the actual engineering decision in this project (see the main design notes on "isn't this just a form?"), and the tradeoff below is exactly the kind of reasoning a reader can't see just by looking at the final code.

## The question

Once the LLM outputs a list of `Section` objects, how does each one know where it goes — top, bottom, one-third-width, nested inside another section? Three designs were compared.

---

## Option A — Fixed position enum

Every section picks one label out of a fixed 3×3 grid of named zones.

```typescript
position: z.enum([
  "top-left",    "top-center",    "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]),
```

```
┌─────────────┬─────────────┬─────────────┐
│  top-left   │ top-center  │  top-right  │
├─────────────┼─────────────┼─────────────┤
│ middle-left │middle-center│ middle-right│
├─────────────┼─────────────┼─────────────┤
│ bottom-left │bottom-center│ bottom-right│
└─────────────┴─────────────┴─────────────┘
```

**Where it breaks** — a section that should span multiple cells has no home:

```
┌─────────────────────────────────────────┐
│     "top half" — spans all 3 top cells    │  ← no single enum value for this
│              (no cell for it)             │
├─────────────┬─────────────┬─────────────┤
│ bottom-left │bottom-center│ bottom-right│
└─────────────┴─────────────┴─────────────┘
```

| | |
|---|---|
| **Pros** | Simplest possible schema. No recursion, no `z.lazy()`. One field, one value, easy for the LLM to hit reliably. |
| **Cons** | Fixed at 3×3 resolution. Cannot express a section spanning more than one cell. Cannot express nesting (a cell containing more cells). |
| **Verdict** | Good enough *only* if every demo prompt maps cleanly to one of the 9 named zones with no spanning and no nested splits. |

---

## Option B — Coordinate + span (CSS Grid–style)

Sections get explicit row/column start and end points on a fixed-size grid, the same model real CSS Grid uses (`grid-row`, `grid-column`).

```typescript
rowStart: z.number().int(),
rowEnd: z.number().int(),
colStart: z.number().int(),
colEnd: z.number().int(),
```

```
        col 1     col 2     col 3
      ┌─────────────────────────────┐  row 1
      │       hero  (colStart:1,     │
      │        colEnd:4 → spans 3)   │
      ├─────────┬─────────┬──────────┤  row 2
      │   new    │  best   │ contact │
      │ arrivals │ sellers │ service │
      └─────────┴─────────┴──────────┘
```

This fixes Option A's spanning problem — "top half" is just `rowStart:1, rowEnd:2, colStart:1, colEnd:4`.

| | |
|---|---|
| **Pros** | Handles spanning and uneven sizes cleanly. Still just one grid, no recursion. |
| **Cons** | Still exactly one level — a cell can't itself contain more cells. LLM has to output correct *numbers* (four coordinates per section) instead of picking from a short list, which is a harder, more error-prone generation task than an enum. |
| **Verdict** | Rejected for now — solves spanning but not nesting, at the cost of a harder inference task for the model. |

---

## Option C — Recursive tree (order + nesting) — **chosen for now, see caveat below**

No coordinates at all. A page is an **ordered list** of sections; position is implicit from array order (first section = rendered first) plus each section's fractional size (`"full"` / `"half"` / `"third"`). A section can itself be a `grid` containing more sections — recursively, to any depth — which is what lets "one third of the hero banner" be expressed as a grid *inside* what used to be a single banner cell.

```typescript
span: z.enum(["full", "half", "third"]),
height: z.enum(["full", "half", "third"]),
direction: z.enum(["row", "column"]),   // row = split width, column = split height
columns: z.array(SectionSchema),         // recursive — a grid's children are Sections too
```

```
sections: [                                    ┌───────────────────────────┐
  banner (height: half)                        │       hero banner          │
                                                ├─────────┬─────────┬────────┤
  grid (height: half, direction: row)          │   new   │  best   │contact │
    ├─ card-group "New Arrivals"               │ arrivals│ sellers │service │
    ├─ card-group "Best Sellers"                └─────────┴─────────┴────────┘
    └─ contact-block "Customer Service"
]
```

Going one level deeper — "left third of the hero banner has an image stacked above a caption" — costs **no new vocabulary**, just another `grid`:

```
grid (direction: row)                    ┌───────┬───────────────────┐
 ├─ grid (direction: column)             │ image │                   │
 │    ├─ image-block                     │───────│   rest of banner  │
 │    └─ text-block "caption"            │caption│                   │
 └─ banner (rest of hero content)        └───────┴───────────────────┘
```

**The Zod mechanics** — a `grid`'s `columns` field contains `Section`, and `Section` (the discriminated union of all section types) includes `grid`. That circular reference is why this option needs `z.lazy()`: TypeScript/Zod can't resolve a type that refers to itself while it's still being defined, so the schema is wrapped in a function (`z.lazy(() => ...)`) that only runs the first time something is actually validated — by which point the circular definitions have both finished. The recursive TS shape (`interface GridSection { ...; columns: Section[] }`) has to be written by hand for the same reason: Zod's normal type-inference (`z.infer<...>`) can't infer a self-referential type either.

| | |
|---|---|
| **Pros** | Handles arbitrary nesting depth and arbitrary spanning with only 3 fields (`span`, `height`, `direction`) reused at every level. Most general design — matches how real page builders (Figma auto-layout, Webflow) actually model layout. |
| **Cons** | Requires `z.lazy()` and a hand-written recursive TS type — more Zod complexity than the other two options. The LLM has to correctly infer *tree structure* (how deep, which nodes are containers) from prose, which is a harder generation task than picking a label or four numbers. More ways for the model to produce a technically-valid-but-structurally-wrong tree. |
| **Verdict** | Architecturally the most correct answer, but the added complexity (schema *and* LLM inference difficulty) is only worth paying for if a demo prompt actually needs spanning + nested splitting in the same layout. |

---

## Comparison

| | A: Fixed enum | B: Coordinate + span | C: Recursive tree |
|---|---|---|---|
| Named zones (3×3) | ✅ | ✅ (any resolution) | ✅ (via nesting) |
| Spanning multiple cells | ❌ | ✅ | ✅ |
| Arbitrary nesting depth | ❌ | ❌ | ✅ |
| Needs `z.lazy()` | No | No | Yes |
| LLM inference difficulty | Lowest (pick 1 of 9 labels) | Medium (produce 4 correct numbers) | Highest (infer a correct tree shape) |
| Schema/renderer LOC | Least | Medium | Most |

## Decision

**Provisionally going with Option C**, on the reasoning that the project's own value-add (per the main design notes) is translating unpredictable phrasing into structure the model wasn't handed directly — and nested, uneven layouts are exactly the phrasing real prompts tend to produce ("bottom splits into three columns," "left third has an image over a caption"). A flat enum can't represent that at all; coordinate+span gets partway there but still caps out at one level.

**Open item, not yet resolved:** this is only the right call if the actual 3 demo prompts chosen for the project need spanning *and* nesting in the same layout. If they turn out to be flat "this goes here, that goes there" phrasing with no spanning, **Option A is the more honest MVP choice** — per the project's own "isn't this just an overengineered form?" self-check, there's no point paying for tree-shaped complexity a demo never exercises. Revisit once the 3 demo prompts are locked in.

## Content modeling: 5 semantic leaf types vs. 1 generic `block`

A related question came up while building the leaf schemas (`banner`, `card-group`, `sidebar`, `nav`, `footer`): since every section is geometrically just a rectangle with a size and position, why not collapse the *content* down too — one generic `block` type with optional fields (`heading?`, `text?`, `items?`, `backgroundColor?`) instead of five separate types?

**What's actually shared (kept):** position/size fields (`span`, `height`) and now `backgroundColor` are universal, so they live once on `BaseSection` and every type inherits them via `.extend()`. Containers additionally share `direction` (row/column), since that's a property of *having children*, not of content.

**What's deliberately kept separate:** the shape of `content` itself. This isn't about geometry — it's the same reasoning as rejecting free-string `height`/`span` fields (below), just one level up:

- With `nav` as its own discriminated type, Zod *guarantees* `content.links` is an array of strings whenever `type === "nav"`. The render function (`renderNav`) can assume that shape unconditionally — no runtime checks, no guessing.
- With one generic `block` where every content field is optional, the LLM could express "this is a nav" as `{heading, items}`, or `{text}`, or `{heading, text, items}` — several different-looking outputs all "validly" meaning the same thing. The renderer would then have to *infer* which combination of present/absent fields implies "draw this like a nav bar," pushing the dispatch problem out of Zod (which is good at exhaustive, typed cases) and into hand-written, untyped if/else logic.

**Decision: kept the 5 semantic leaf types.** A named type isn't just a label — it's a contract that guarantees the renderer receives exactly one, unambiguous content shape per case, so the small set of pre-written render functions can stay exhaustive and correct. Generalizing `content` would trade that guarantee for less duplication, and duplication was the smaller problem (already solved by `BaseSection.extend()`).

## Sizing values: named-fraction enum → weighted ratio (revised after implementation)

Once nesting was implemented (Option C, chosen above), a new problem showed up one level down: how does a section's actual *width/height* get sized? `span`/`height` originally used a named-fraction enum:

```typescript
const SizeUnit = z.enum(["full", "half", "third", "quarter", "fifth"]);
```

**Where it broke, concretely:** building a sidebar layout (a narrow sidebar beside a wide main content area) needed something like `"quarter"` for the sidebar and `"three-quarters"` for the main content — but `"three-quarters"` didn't exist in the enum. The fix looked like "just add it" — until noticing that's true for *every* fraction: `"third"` needs a `"two-thirds"` complement, `"fifth"` needs `"four-fifths"`, and an uneven 3-way split (say 1:2:1) has no clean named value at all, no matter how many labels get added. This is the exact same ceiling as Option A's flat position-enum, above — just recurring one level deeper, on sizing instead of position.

```
┌─────────┬─────────────────────────────────────┐
│"quarter"│         "three-quarters"?             │  ← no such label exists,
│         │   and never will for every ratio      │     and never can for all of them
└─────────┴─────────────────────────────────────┘
```

**The fix:** swap the named-fraction enum for a small bounded integer *weight*, and let the renderer distribute space by ratio using CSS's `flex-grow` — the same idea as CSS Grid's `fr` unit.

```typescript
const SizeUnit = z.number().int().min(1).max(5);
```

```typescript
// renderer.ts — renderGrid, per child:
`<div style="flex: ${weight} 1 0;">...</div>`
```

A sidebar at weight `1` next to main content at weight `4` gives a 20/80 split automatically — no `"fifth"`/`"four-fifths"` pair needed. Three siblings weighted `1 : 2 : 1` give 25/50/25 — a ratio the enum could never express regardless of how many labels were added. Any new ratio just works, with zero schema changes.

**Why this doesn't reopen the free-string mistake:** the field is still a small, bounded value (`1`–`5`), not unconstrained input — same underlying principle as rejecting `z.string()` for these fields in the first place (keep the LLM's output space finite, keep the renderer's job exhaustive). It's a bounded *number* instead of a bounded *label set*, which happens to compose combinatorially where labels don't.

**Renderer impact:** the `SIZE_TO_PERCENT` lookup table (mapping each named fraction to a fixed CSS percentage) was deleted entirely — `flex-grow` ratios replace it, so there's nothing left to look up.

## Other rejected design notes

- **Free-string `height`/`span` fields** (`z.string()` instead of `z.enum([...])`) were considered and rejected early. A free string lets the model return anything ("kinda tall," "60%") that the renderer has no pre-written case for. Keeping these fields as small enums is what keeps the renderer's job finite — it only ever needs to handle the exact values listed.
- **Free-form shapes/circles, arbitrary fluid layout** — raised as a possible extension once containers and leaves were both rectangular. Rejected for this project: the entire point of the schema is that it's narrow enough for the renderer to handle *exhaustively*. Arbitrary shapes/positioning moves back toward "trust the model's raw output," which is the exact failure mode the JSON-schema approach exists to prevent. Noted as a legitimate stretch idea, explicitly out of MVP scope.

## Future improvements (KIV, not MVP scope)

- **"Edit" prompts** — a follow-up instruction that modifies an already-generated layout (e.g. "make the hero banner twice its height") instead of generating a fresh one. Considered and deliberately deferred: mechanically it's the same `prompt → validate → render` pipeline already built, just with a system prompt that also includes the current JSON as context — it doesn't exercise a new dimension of what this project actually demonstrates (schema/prompt/safeguard design), it's closer to an interaction-polish feature. Would add real scope (conversation state, diffing old vs. new spec, before/after UI) to what the original spec sized as a one-day project. Worth revisiting only if the core checklist (retry/fallback logic, 3 demo prompts, README) is done with time left over.

## Glossary

- **Zod** — TypeScript library for describing the shape of data and validating untrusted input against it at runtime (`safeParse`). Python equivalent: Pydantic.
- **Discriminated union** (`z.discriminatedUnion("type", [...])`) — a Zod pattern for validating a value that could be one of several object shapes, distinguished by a shared literal field (`type`). Lets each section variant require its own fields.
- **`z.lazy()`** — defers evaluation of a schema definition until first use, needed whenever a schema refers to itself (directly or through another schema), since the plain definition would otherwise try to reference a `const` that doesn't exist yet.
