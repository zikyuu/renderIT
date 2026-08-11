import {z} from "zod";

import { BannerSection } from "./schema";
import { CardGroupSection } from "./schema";
import { FooterSection } from "./schema";
import { SidebarSection } from "./schema";
import { NavSection } from "./schema";
import { GridSection, Section } from "./schema";

// shared style string every section type uses: padding so blocks don't touch,
// plus backgroundColor from BaseSection if the spec set one (falls back to a
// light default so blocks are visible even when no color was specified)
function sectionStyle(section: { backgroundColor?: string }, fallback: string, padding: string = "1rem"): string {
    return `padding: ${padding}; background-color: ${section.backgroundColor ?? fallback}; height: 100%; box-sizing: border-box;`;
}

//type params exactly to match the schema --> type routing
// cannot import Section and use function renderBanner(section:Section)
// bc Section is a union of all the different section types, so TS will complain that section might not be a BannerSection
// since GridSection does not have content (cannot use section.content...)
function renderBanner(section: z.infer<typeof BannerSection>): string {
    //to handle optional subtext field in banner
    const subtextHtml = section.content.subtext ? `<p>${section.content.subtext}</p>` : "";
    return `
    <div class="banner" style="${sectionStyle(section, "#fef9c3")}">
        <h1>${section.content.heading}</h1>
        ${subtextHtml}
    </div>
    `;
}
//REMEMBER must be backticks ` not ' or else the string wont span multiple lines

function renderCardGroup(section: z.infer<typeof CardGroupSection>): string {
    return `
    <div class="card-group" style="${sectionStyle(section, "#dbeafe")}">
        <h2>${section.content.title}</h2>
    </div>
    `;
}

function renderFooter(section: z.infer<typeof FooterSection>): string {
    return `
    <footer style="${sectionStyle(section, "#e5e7eb")}">
        <p>${section.content.text}</p>
    </footer>
    `;
}

//.map (callback) -> runs callback once per array element and returns array
// .join("") -> takes array and joins all elements into a single string, with "" as separator (no separator)
function renderSidebar(section: z.infer<typeof SidebarSection>): string {
    const itemsHtml = section.content.items.map(item => `<li>${item}</li>`).join("");
    return `
    <aside class="sidebar" style="${sectionStyle(section, "#dcfce7")}">
        <ul>
            ${itemsHtml}
        </ul>
    </aside>
    `;
}

function renderNav(section: z.infer<typeof NavSection>): string {
    const linksHtml = section.content.links.map(link => `<a href="${link}">${link}</a>`).join(" | ");
    return `
    <nav class="nav" style="${sectionStyle(section, "#e0e7ff")}">
        ${linksHtml}
    </nav>
    `;
}

function renderGrid(section: GridSection): string {
    // when laying children out in a row, their SPAN (width weight) matters;
    // when stacking them in a column, their HEIGHT (height weight) matters.
    // "flex: <weight> 1 0" = grow by this weight relative to siblings, shrink
    // if needed, start from a 0 base size - same idea as CSS Grid's fr unit
    const columnsHtml = section.columns.map(child => {
        const weight = section.direction === "row" ? child.span : child.height;
        return `<div style="flex: ${weight} 1 0;">${renderSection(child)}</div>`;
    }).join("");

    return `
    <div class="grid" style="display: flex; flex-direction: ${section.direction}; gap: 1rem; ${sectionStyle(section, "transparent", "0")}">
        ${columnsHtml}
    </div>
    `;
}

// dispatcher: checks section.type, narrows the union, routes to the matching render function
export function renderSection(section: Section): string {
    switch (section.type) {
        case "banner":
            return renderBanner(section);
        case "card-group":
            return renderCardGroup(section);
        case "sidebar":
            return renderSidebar(section);
        case "nav":
            return renderNav(section);
        case "footer":
            return renderFooter(section);
        case "grid":
            return renderGrid(section);
    }
}