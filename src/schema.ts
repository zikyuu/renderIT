import { z } from "zod";

// relative weight, not a named fraction - measured/estimated as a percentage,
// like CSS flex-grow / fr units
const SizeUnit = z.number().int().min(1).max(100);

// a measured position or extent, as a % of its parent - unlike SizeUnit this
// allows 0 (flush against an edge) and decimals (real measurements aren't
// round numbers), since it locates something rather than weighing it against siblings
const Coordinate = z.number().min(0).max(100);

const BaseSection = z.object({
    span: SizeUnit,
    height: SizeUnit,
    backgroundColor: z.string().optional(),
});

// one measured text element - fontSize/position come from CV measurement,
// not a pre-declared "heading vs subtext" role. isLink (from an underline)
// marks it as a routing node; linkTarget gets filled in later via the
// linking canvas, once the user connects it to a page/element
const TextElement = z.object({
  text: z.string(),
  fontSize: SizeUnit,
  x: Coordinate,
  y: Coordinate,
  color: z.string().optional(),
  isLink: z.boolean().optional(),
  linkTarget: z.string().optional(),
});

// one detected image region - flagged by CV via color variance (high
// variance = photo, low = flat fill). imageUrl is empty until the user
// drags an image in later
const ImageRegion = z.object({
  x: Coordinate,
  y: Coordinate,
  width: Coordinate,
  height: Coordinate,
  clipPath: z.string().optional(), // present = custom/non-rectangular outline
  imageUrl: z.string().optional(),
});

// replaces banner/card-group/sidebar/nav/footer - one generalized leaf type.
// clipPath here (not on TextElement/ImageRegion) means the whole rectangle
// itself has a custom outline, not just an image inside it
const RectangleSection = BaseSection.extend({
  type: z.literal("rectangle"),
  clipPath: z.string().optional(),
  textElements: z.array(TextElement).optional(),
  imageRegions: z.array(ImageRegion).optional(),
});

type Section =
    | z.infer<typeof RectangleSection>
    | GridSection;

interface GridSection {
    type: "grid";
    span: z.infer<typeof SizeUnit>;
    height: z.infer<typeof SizeUnit>;
    backgroundColor?: string;
    direction: "row" | "column";
    columns: Section[];
    gap?: number;
}

const GridSectionSchema = z.lazy(() =>
    BaseSection.extend({
        type: z.literal("grid"),
        direction: z.enum(["row", "column"]),
        columns: z.array(SectionSchema),
        gap: z.number().int().min(0).max(100).optional(),
    })
);

const SectionSchema: z.ZodType<Section> = z.lazy(() =>
    z.discriminatedUnion("type", [
        RectangleSection,
        GridSectionSchema,
    ])
);

const PageSchema = z.object({
  sections: z.array(SectionSchema),
  gap: z.number().int().min(0).max(100).optional(),
});

export { PageSchema, SectionSchema, Section, SizeUnit, Coordinate,
  RectangleSection, TextElement, ImageRegion, GridSectionSchema };
export type { GridSection };