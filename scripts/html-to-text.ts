// scripts/html-to-text.ts — converts an MDRS (Google Sites) report page to plain text.
//
// How it fits: fetch-reports.ts downloads pages and calls htmlToText() before saving them to
// data/reports/. Kept in its own file so it can be checked against a hand-saved report without
// running the downloader. Rule: no rewording. We only remove tags and decode entities (&quot; → ").
//
// Two things we learned by reading the site's raw HTML:
//   - Report text lives in <p> and <h1>–<h6> elements whose class includes "zfr3Q", one line each.
//   - Tables (e.g. the crew roster in the Final Mission Report) are "embeds": the table's HTML is
//     stored, entity-escaped, inside a data-code="..." attribute. We decode it and print one line per
//     table row, with cells separated by " | ".

/**
 * Decodes HTML entities: named ones the site uses (&quot; &amp; &#39; …) and numeric ones (&#8217;).
 * @param s  Text containing entities.
 * @returns  The same text with each entity replaced by its character.
 */
function decodeEntities(s: string): string {
  const named: Record<string, string> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " " };
  // Regex: "&", then either "#x" + hex digits, "#" + decimal digits, or a name, then ";".
  // The callback receives the whole match and each captured group.
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16)); // parseInt(x, 16) reads hexadecimal
    if (dec) return String.fromCodePoint(Number(dec));
    return named[name.toLowerCase()] ?? whole; // unknown name: leave it as written
  });
}

/**
 * Removes HTML tags from a fragment, turning <br> into a newline.
 * Regex /<[^>]+>/g: "<", then one or more characters that aren't ">", then ">" — i.e. any tag.
 */
function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

/**
 * Turns one embedded table (the decoded data-code HTML) into lines: one per row, cells joined by " | ".
 * Whitespace inside a cell is collapsed, because it is the HTML's indentation, not the report's text.
 */
function tableToLines(tableHtml: string): string[] {
  // [\s\S]*? = any characters including newlines, as few as possible (stops at the first </tr>).
  const rows = [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  return rows.map((row) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)] // <td> or <th> cells, captured contents
      .map((cell) => decodeEntities(stripTags(cell[1])).replace(/\s+/g, " ").trim())
      .join(" | "),
  );
}

/**
 * Converts a Google Sites page to plain text, in document order, without rewording anything.
 * @param html  The raw page HTML.
 * @returns     The report text: one line per paragraph/heading, one line per table row.
 */
export function htmlToText(html: string): string {
  const lines: string[] = [];
  // One regex with two alternatives so matches come back in page order:
  //   1) <p ...class="...zfr3Q..."> ... </p>  (or h1–h6). \1 means "the same tag name we opened with".
  //   2) data-code="..." — an embedded block (a table). [^"]* stops at the closing quote; the inner
  //      HTML can't contain a raw " because it's escaped as &quot;.
  const block = /<(p|h[1-6])\b[^>]*class="[^"]*\bzfr3Q\b[^"]*"[^>]*>([\s\S]*?)<\/\1>|\sdata-code="([^"]*)"/g;
  for (const m of html.matchAll(block)) {
    if (m[3] !== undefined) lines.push(...tableToLines(decodeEntities(m[3])));
    else lines.push(decodeEntities(stripTags(m[2])));
  }
  return lines.join("\n") + "\n";
}
