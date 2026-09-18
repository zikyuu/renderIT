import { z } from "zod";

import { RectangleSection, GridSection, Section, TextElement, ImageRegion } from "./schema";

// gap is measured (0-100, "how much space relative to the max we'll ever use"),
// not a ratio like span/height - CSS gap needs an absolute size, so this maps
// the 0-100 scale onto a real rem value. 25 -> 1rem is the old hardcoded
// default, kept as the fallback so specs without a gap render the same as before
const MAX_GAP_REM = 4;
const DEFAULT_GAP = 25;
export function gapToRem(gap: number | undefined): string {
    return `${((gap ?? DEFAULT_GAP) / 100) * MAX_GAP_REM}rem`;
}

// same idea as gapToRem, but for font size - the 1-100 measured scale maps
// onto a real range from small print up to a large heading
const MIN_FONT_REM = 0.75;
const MAX_FONT_REM = 4;
function fontSizeToRem(fontSize: number): string {
    return `${MIN_FONT_REM + (fontSize / 100) * (MAX_FONT_REM - MIN_FONT_REM)}rem`;
}

// shared style string: backgroundColor from BaseSection if the spec set one
// (falls back to a neutral default). padding defaults to 0 now, not 1rem -
// child positions are already measured coordinates from the real design, so
// adding artificial padding on top would shift them off their true position
function sectionStyle(section: { backgroundColor?: string }, fallback: string, padding: string = "0"): string {
    return `padding: ${padding}; background-color: ${section.backgroundColor ?? fallback}; height: 100%; box-sizing: border-box;`;
}

// one measured text element, positioned absolutely within its parent
// rectangle by its own x/y (both % of the rectangle, matching the source
// design's real layout, not a guessed spacing). isLink renders as a real
// link - linkTarget stays empty until the linking canvas wires it up later
function renderTextElement(el: z.infer<typeof TextElement>): string {
    const style = `position: absolute; left: ${el.x}%; top: ${el.y}%; font-size: ${fontSizeToRem(el.fontSize)};`;
    if (el.isLink) {
        return `<a href="${el.linkTarget ?? "#"}" style="${style}">${el.text}</a>`;
    }
    return `<span style="${style}">${el.text}</span>`;
}

// one detected image region, positioned/sized by its measured bounding box.
// clipPath (if the region isn't a plain rectangle) clips just this element -
// imageUrl stays empty until the user drags a real image in later
function renderImageRegion(region: z.infer<typeof ImageRegion>): string {
    const clipStyle = region.clipPath ? `clip-path: ${region.clipPath};` : "";
    const style = `position: absolute; left: ${region.x}%; top: ${region.y}%; width: ${region.width}%; height: ${region.height}%; ${clipStyle}`;
    if (region.imageUrl) {
        return `<img src="${region.imageUrl}" style="${style} object-fit: cover;" />`;
    }
    return `<div style="${style} background-color: #d1d5db; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #6b7280;">image</div>`;
}

// replaces renderBanner/renderCardGroup/renderSidebar/renderNav/renderFooter -
// one function laying out whatever measured text/image elements this
// rectangle actually has, instead of dispatching on a pre-declared content type
function renderRectangle(section: z.infer<typeof RectangleSection>): string {
    const textHtml = (section.textElements ?? []).map(renderTextElement).join("");
    const imageHtml = (section.imageRegions ?? []).map(renderImageRegion).join("");
    const clipStyle = section.clipPath ? `clip-path: ${section.clipPath};` : "";

    return `
    <div class="rectangle" style="position: relative; ${clipStyle} ${sectionStyle(section, "#f3f4f6")}">
        ${imageHtml}
        ${textHtml}
    </div>
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
    <div class="grid" style="display: flex; flex-direction: ${section.direction}; gap: ${gapToRem(section.gap)}; ${sectionStyle(section, "transparent", "0")}">
        ${columnsHtml}
    </div>
    `;
}

// dispatcher: checks section.type, narrows the union, routes to the matching render function
export function renderSection(section: Section): string {
    switch (section.type) {
        case "rectangle":
            return renderRectangle(section);
        case "grid":
            return renderGrid(section);
    }
}