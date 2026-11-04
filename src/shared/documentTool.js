/**
 * documentTool.js - the one definition of the "create a Word, Excel or PowerPoint
 * file" tool the model is offered.
 *
 * The desktop chat and the browser chat both hand this to the model, so the
 * instructions about quality and the content shapes it may use are written once.
 * A second copy would let the two surfaces teach the model different things.
 */

/** Offered on every message: it costs nothing unless the person asks for a file. */
export const DOCUMENT_TOOL = Object.freeze({
  name: 'createDocument',
  description:
    'Create a downloadable Word (docx), Excel (xlsx) or PowerPoint (pptx) file when the person asks for a document, spreadsheet, deck or slides. ' +
    'Write the full content into the call; never ask them to copy text into Office themselves. After it succeeds, tell them the file is ready in one short sentence. ' +
    'Quality bar: plan the structure first, write finished prose rather than placeholders, and use the richer options below. ' +
    'Word: open with a short summary, use headings and tables for comparisons, and **bold** or *italic* inside text for emphasis. ' +
    'Excel: give every column a type, put units in the header, and set totals when columns hold amounts. For a dashboard, set dashboard: true and make the first sheet the summary. Give it a title, subtitle, 3-6 kpis and 1-4 charts, then put detailed source data on separate sheets. Use short labels, sensible units, formulas for derived values, and no empty spacer columns. Dashboard output is intentionally light, single-hue and spacious: the builder supplies the title band, KPI cards, hidden gridlines, chart layout, column widths, row heights and readable alignment. Use shades of one requested brand colour, never unrelated colours or a dark background. ' +
    'PowerPoint: 6 to 12 slides, at most 6 short bullets each (about 12 words), vary the layout, and use a chart or big number whenever there are figures. ' +
    'If the result lists warnings, fix them and create the file again once, then tell the person which file to use. ' +
    'Ask one short question first only when the request is large (a report over three pages, a deck over eight slides, a workbook with several sheets) and the purpose or audience is unclear; otherwise build it straight away. ' +
    'Write each slide title as the point it makes, not a topic. ' +
    'Good examples: slide { title: "Revenue grew 12% in Q3", layout: "bigNumber", stat: "+12%", caption: "against Q2" }; Excel column { header: "Cost (NGN)", type: "currency" }; Word section { heading: "Summary", paragraphs: ["Revenue grew **12%** because new clients joined."], callout: "Decision needed: approve the Q4 budget." }.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['docx', 'xlsx', 'pptx'], description: 'docx = Word, xlsx = Excel, pptx = PowerPoint.' },
      fileName: { type: 'string', description: 'Short file name without extension.' },
      content: {
        type: 'object',
        description:
          'All kinds accept theme: "zuri" | "corporate" | "minimal" | "bold" | "dashboard". Set dashboard: true for a complex Excel dashboard; it forces a light single-hue visual system while preserving formulas, charts, filters and conditional formatting. Inline **bold**, *italic*, `code` and [text](https://url) become real formatting. ' +
          'docx: { title, subtitle, author, date, coverPage, toc (a linked list of the headings), brand: { primary, accent, font }, header, pageNumbers, sections: [{ heading, level 1-3, paragraphs: [text], bullets: [text or {text, level}], numbered: [text], quote, callout, image: { data or path, width, caption }, table: { rows: [[cell]], caption } }] }; ' +
          'a section may instead give blocks: [{ type: "heading" | "paragraph" | "bullets" | "numbered" | "quote" | "callout" | "table" | "image" | "pageBreak", text, items, rows, level, data or path, caption }] to control order. ' +
          'xlsx: { dashboard, sheets: [{ name, title, subtitle, tableTitle, kpis: [{ label, value, change, format }], columns: [header or { header, type: "text" | "integer" | "number" | "currency" | "accounting" | "usd" | "eur" | "gbp" | "thousands" | "millions" | "percent" | "percent0" | "date", role: "input" (blue cells a person types into), formula: "=[@Qty]*[@Price]" (calculated column filled on every row) }], rows: [[value]], totals: true, blankRows: 20 (empty rows that keep formulas and drop-downs, even when rows is omitted, for a fill-in template), dataBars: [column], tableName, table: false (plain range instead of an Excel Table), dropdowns: [{ column, options: [text] }], names: [{ name, column }], scale: [column], highlight: [{ column, rule: "greaterThan" | "lessThan" | "between" | "negative", value, value2, color: "red" | "green" | "amber" | "blue" }], chart: { type: "bar" | "stacked" | "line" | "area" | "pie" | "doughnut" | "combo" (first value as columns, the rest as lines on a right-hand scale), title, labels: true (show values), categories: column, values: [column] }, charts: [up to four chart objects] }] }; on the first dashboard sheet, title, KPI cards and charts form a polished summary and the rows become supporting detail below it. Numbers stay numbers, a text value starting with "=" is a formula such as "=SUM(B2:B9)"; inside a row write {row} for that row\'s own number, as in "=C{row}*D{row}", so the reference is right wherever the table starts; newer functions such as XLOOKUP, FILTER and LET are supported, "2026-10-31" is a date, percent values are fractions (0.25). ' +
          'pptx: { title, subtitle, author, date, slides: [{ title, layout, notes, ... }] } where layout is "bullets" (bullets: [text]), "section" (title), "twoColumn" (left and right: { heading, bullets }), "bigNumber" (stat, caption), "table" (table: { rows }), "chart" (chart: { type: "bar" | "line" | "pie" | "doughnut" | "area", labels, series: [{ name, values }] }), "image" (image: { data or path }, caption, bullets), "process" (steps: [{ title, text }], up to 6, drawn as connected boxes), "quote" (quote, attribution) or "closing" (title). A picture is a PNG, JPEG or GIF: give a data link or, on the desktop, the path of a file in the workspace.',
      },
    },
    required: ['kind', 'content'],
  },
});
