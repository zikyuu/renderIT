import { z } from "zod";

// relative weight, not a named fraction - a section's actual width/height
// is this number divided by the sum of its siblings' weights (like CSS flex-grow / fr units)
const SizeUnit = z.number().int().min(1).max(5);
// everyth9ing in here is required
const BaseSection = z.object({
    span: SizeUnit, 
    height: SizeUnit,
    backgroundColor: z.string().optional(),
});

// .extend returns new schema with additional properties 
//e.g. banner now req span, height + type, content
const BannerSection = BaseSection.extend({
  type: z.literal("banner"),
  content: z.object({
    heading: z.string(),
    subtext: z.string().optional(),
  }),
});

const CardGroupSection = BaseSection.extend({
  type: z.literal("card-group"),
  content: z.object({ title: z.string() }),
});

const SidebarSection = BaseSection.extend({
  type: z.literal("sidebar"),
  content: z.object({ items: z.array(z.string()) }),
});

const NavSection = BaseSection.extend({
  type: z.literal("nav"),
  content: z.object({ links: z.array(z.string()) }),
});

const FooterSection = BaseSection.extend({
  type: z.literal("footer"),
  content: z.object({ text: z.string() }),
});

//basc means a section is either one of these few types 
// | is union dont forgot oops
//z.inter<typeof > -> take the type of banner section var, infer what shape of the object that the schema produces 
// tldr: infers the span, height, content, etc. of the section and makes it a type
// VALIDATED output of banner section, cardgroupsection ... etc --> key to safeguarding and not blindly using LLM outputs
type Section = 
    | z.infer<typeof BannerSection> 
    | z.infer<typeof CardGroupSection> 
    | z.infer<typeof SidebarSection> 
    | z.infer<typeof NavSection> 
    | z.infer<typeof FooterSection>
    | GridSection;

//interface bc Section mentio0ns GS and GS mentions Section, so need to use interface to avoid circular reference issues
interface GridSection {
    type: "grid";
    span: z.infer<typeof SizeUnit>;
    height: z.infer<typeof SizeUnit>;
    backgroundColor?: string;
    direction: "row" | "column";
    columns: Section[];
}

//works for type and interface ^
// but for zod schema values, the interface type trick doesnt work so ned to use z.lazy 
// again to avoid circular reference issues
// z.lazy(callback) takes function without calling it, and just stores it
// function only actually runs later when zod needs to validate real data 
// NOTE TO MYSELF why this works?
// see line below:
const GridSectionSchema = z.lazy(() =>
    BaseSection.extend({
        type: z.literal("grid"),
        direction: z.enum(["row", "column"]),
        columns: z.array(SectionSchema), // at this line, SectionSchema is not yet defined, but z.lazy allows us to reference it without causing a circular dependency error
    })
);

const SectionSchema: z.ZodType<Section> = z.lazy(() => //SectionSchema only defined here ^^
    z.discriminatedUnion("type", [
        BannerSection,
        CardGroupSection,
        SidebarSection,
        NavSection,
        FooterSection,
        GridSectionSchema,
    ])
);

const PageSchema = z.object({
  sections: z.array(SectionSchema),
});

export { PageSchema, SectionSchema, Section, SizeUnit,
  BannerSection, CardGroupSection, SidebarSection,
  NavSection, FooterSection, GridSectionSchema };
export type { GridSection };
//why cannot just exprt Section?
// Section does not carry BannerSection, and the rest w it
// z.infer<typeof BannerSection> computes a snapsnot of BannerSection's shape at the moment
// Section is declared, but once baked we dont have access to that specific "ingredient" anymore
// similarly, Section ends up being a flattened descrition of all the 5 diff section types 
// exporting Section would not give access to the indiv section types e.g. BannerSectio

//ok yapper core but i scared i forget...