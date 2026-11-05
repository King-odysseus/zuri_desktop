/**
 * Builders for Word, Excel and PowerPoint files. Each takes plain structured content
 * (what a model can emit as JSON) and returns the finished file as a Buffer. Nothing
 * here touches the file system, so the tool layer owns where the bytes are saved.
 *
 * Every file is styled from one named theme (fonts, palette, table look) so a model
 * only picks words like "corporate" or "twoColumn" instead of writing styles. The
 * original, simpler content shapes still work: every new field is optional.
 */
import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createRequire } from 'node:module';

// pptxgenjs's ES entry imports jszip in a way plain Node rejects; its CommonJS entry loads everywhere.
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs');

export const OFFICE_KINDS = Object.freeze(['docx', 'xlsx', 'pptx', 'pdf']);

/** Hard caps so a runaway model reply cannot build a huge file or hang the app. */
const LIMITS = Object.freeze({
  sections: 60,
  blocksPerSection: 120,
  paragraphsPerSection: 80,
  tableRows: 500,
  tableColumns: 30,
  sheets: 20,
  sheetRows: 5000,
  slides: 60,
  bulletsPerSlide: 12,
  text: 20_000,
  title: 200,
});

export class OfficeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'OfficeError';
  }
}

/**
 * Named looks. Colours are hex without "#". `primary` carries headings and header
 * rows, `tint` is a pale wash for banding and callouts, `onPrimary` is the text colour
 * that stays readable on a primary fill.
 */
export const THEMES = Object.freeze({
  // The app's own pair: the navy of the logo and the light blue that marks anything live.
  zuri: { font: 'Calibri', primary: '0D1B3A', accent: '2F6FED', text: '0D1B3A', muted: '5A6480', tint: 'E8EFFC', line: 'D2D6E3', onPrimary: 'FFFFFF' },
  corporate: { font: 'Calibri', primary: '1F2A44', accent: 'B8860B', text: '1F2937', muted: '6B7280', tint: 'EEF0F5', line: 'CBD0DA', onPrimary: 'FFFFFF' },
  minimal: { font: 'Arial', primary: '111827', accent: '6B7280', text: '111827', muted: '6B7280', tint: 'F3F4F6', line: 'D1D5DB', onPrimary: 'FFFFFF' },
  bold: { font: 'Calibri', primary: '0F766E', accent: 'EA580C', text: '1F2937', muted: '6B7280', tint: 'E6F4F2', line: 'C7D8D6', onPrimary: 'FFFFFF' },
  // Dashboards deliberately stay light and monochrome. The accent is the same hue
  // as the primary so charts and callouts never become a noisy rainbow.
  dashboard: { font: 'Aptos', primary: '4F86C6', accent: '4F86C6', text: '24415F', muted: '66819D', tint: 'EAF3FC', line: 'D5E3F0', onPrimary: 'FFFFFF', chartColors: ['2F6FAF', '4F86C6', '73A3D7', '99BEE4', 'BED8EF', 'DDEAF7'] },
});

const HEX_COLOUR = /^#?([0-9a-f]{6})$/i;

/** A pale wash of a colour: 90% white, so banding and callouts follow whatever primary a brand chose. */
function tintOf(hex) {
  const channels = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return channels.map((value) => Math.round(value + (255 - value) * 0.9).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Perceived brightness (WCAG-style relative luminance) above which white text stops being readable. */
function isLight(hex) {
  const [red, green, blue] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.4;
}

/**
 * The look for one file: a named theme, then the person's own brand on top. A brand
 * names colours and a font; anything that is not a six-digit hex colour or a plain
 * font name is ignored, so a model cannot put markup or odd values into a style.
 * @param {unknown} name
 * @param {{ primary?: string, accent?: string, font?: string } | undefined} brand
 * @returns {typeof THEMES.zuri}
 */
function themeFor(name, brand) {
  const key = String(name ?? '').toLowerCase();
  const base = Object.hasOwn(THEMES, key) ? THEMES[key] : THEMES.zuri;
  if (!brand || typeof brand !== 'object') return base;

  const primary = HEX_COLOUR.exec(String(brand.primary ?? ''))?.[1]?.toUpperCase();
  const accent = HEX_COLOUR.exec(String(brand.accent ?? ''))?.[1]?.toUpperCase();
  const font = /^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(String(brand.font ?? '')) ? String(brand.font) : '';
  return {
    ...base,
    // A light brand colour needs dark text on it; white on yellow is unreadable.
    ...(primary ? { primary, tint: tintOf(primary), onPrimary: isLight(primary) ? '111827' : 'FFFFFF' } : {}),
    ...(accent ? { accent } : {}),
    ...(font ? { font } : {}),
  };
}

/** Dashboard files use a restrained visual language even when a model omits the flag. */
function dashboardTheme(content) {
  if (content?.dashboard !== true && String(content?.theme ?? '').toLowerCase() !== 'dashboard') return null;
  const base = themeFor('dashboard', content?.brand);
  // A custom primary is allowed, but all derived colours remain tints of it.
  return { ...base, accent: base.primary, chartColors: monochromePalette(base.primary) };
}

/** Shades of one hue keep categories distinct without turning a dashboard into a rainbow. */
function monochromePalette(hex) {
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return THEMES.dashboard.chartColors;
  const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const shade = (amount) => rgb.map((channel) => Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
  const dark = rgb.map((channel) => Math.round(channel * 0.72).toString(16).padStart(2, '0')).join('').toUpperCase();
  return [dark, hex, shade(0.2), shade(0.4), shade(0.6), shade(0.78)];
}

/** @param {unknown} value @param {number} max @returns {string} */
function clean(value, max = LIMITS.text) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max);
}

/** @param {unknown} value @param {string} what @param {number} max @returns {any[]} */
function list(value, what, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OfficeError(`${what} must be a list.`);
  if (value.length > max) throw new OfficeError(`${what} has ${value.length} items; the limit is ${max}.`);
  return value;
}

/** Rectangular text grid from rows of cells, or null when there is nothing to draw. */
function tableRows(table) {
  if (!table) return null;
  const rows = list(table.rows ?? table, 'A table', LIMITS.tableRows);
  const grid = rows.map((row) => list(row, 'A table row', LIMITS.tableColumns).map((cell) => clean(cell, 500)));
  return grid.length > 0 ? grid : null;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*[^*\s][^*]*\*)/g;

/**
 * Split Markdown-style inline marks into runs. Models write **bold** and *italic* out
 * of habit; without this the asterisks land in the file as literal characters.
 * @param {string} text
 * @returns {{ text: string, bold?: boolean, italic?: boolean, code?: boolean, link?: string }[]}
 */
export function inlineRuns(text) {
  const source = String(text ?? '');
  const runs = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) runs.push({ text: source.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      runs.push(link ? { text: link[1], link: link[2] } : { text: token });
    } else runs.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < source.length) runs.push({ text: source.slice(last) });
  return runs.length > 0 ? runs : [{ text: '' }];
}

/** The text with its inline marks removed, for cells and titles that cannot carry runs. */
export function plainText(text) {
  return inlineRuns(text).map((run) => run.text).join('');
}

const NUMERIC = /^[\s₦$€£+-]*\d[\d,]*(\.\d+)?\s*%?$/;

// ---------------------------------------------------------------- Word

/** Largest picture accepted, so one file cannot make a document enormous. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Width and height from the first bytes of a PNG, GIF or JPEG, so a picture keeps its shape. */
function imageDimensions(buffer, type) {
  if (type === 'png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (type === 'gif' && buffer.length >= 10) return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (type === 'jpg') {
    let at = 2;
    while (at + 9 < buffer.length) {
      if (buffer[at] !== 0xff) { at += 1; continue; }
      const marker = buffer[at + 1];
      // Start-of-frame markers carry the size; the others are skipped by their length.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) };
      }
      at += 2 + buffer.readUInt16BE(at + 2);
    }
  }
  return null;
}

/**
 * A picture given as a data link ("data:image/png;base64,..."). Only PNG, JPEG and
 * GIF are accepted and the bytes are checked against the type they claim, so a
 * mislabelled file is refused here instead of producing a document that will not open.
 * @param {unknown} source
 * @returns {{ buffer: Buffer, type: 'png' | 'jpg' | 'gif', width: number, height: number, uri: string }}
 */
export function parseImage(source) {
  const match = /^data:image\/(png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(source ?? ''));
  if (!match) throw new OfficeError('A picture must be a PNG, JPEG or GIF given as a data link.');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new OfficeError('That picture is empty or larger than 5 MB.');
  const type = match[1].toLowerCase() === 'png' ? 'png' : match[1].toLowerCase() === 'gif' ? 'gif' : 'jpg';
  const signatures = { png: [0x89, 0x50, 0x4e, 0x47], gif: [0x47, 0x49, 0x46], jpg: [0xff, 0xd8, 0xff] };
  if (!signatures[type].every((byte, index) => buffer[index] === byte)) throw new OfficeError('That picture is not really a ' + type.toUpperCase() + ' file.');
  const size = imageDimensions(buffer, type);
  if (!size || size.width < 1 || size.height < 1) throw new OfficeError('The size of that picture could not be read.');
  return { buffer, type, ...size, uri: String(source).replace(/\s+/g, '') };
}

/** Word's image run, scaled down to fit the page width and never up past its own size. */
function wordImage(block, theme) {
  const image = parseImage(block.data);
  const requested = Math.min(Math.max(Number(block.width) || 480, 60), 600);
  const width = Math.min(requested, image.width);
  const height = Math.max(1, Math.round((width / image.width) * image.height));
  const alt = plainText(clean(block.alt ?? block.caption ?? 'Picture', 200));
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: Boolean(block.caption),
      spacing: { before: 120, after: block.caption ? 60 : 160 },
      children: [new ImageRun({ type: image.type, data: image.buffer, transformation: { width, height }, altText: { name: 'Picture', title: alt, description: alt } })],
    }),
  ];
  if (block.caption) paragraphs.push(wordCaption(block.caption, theme));
  return paragraphs;
}

/** A small muted line under a table or picture. */
function wordCaption(text, theme) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: plainText(clean(text, 200)), italics: true, size: 18, color: theme.muted })],
  });
}

const A4 = Object.freeze({ width: 11906, height: 16838 });
const MARGIN = 1440;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

/** @param {ReturnType<typeof themeFor>} theme @param {any} base */
function wordRuns(text, theme, base = {}) {
  return inlineRuns(text).map((run) => {
    const options = {
      text: run.text,
      bold: base.bold || run.bold,
      italics: base.italics || run.italic,
      color: base.color,
      size: base.size,
    };
    if (run.code) Object.assign(options, { font: 'Consolas', shading: { type: ShadingType.CLEAR, fill: theme.tint, color: 'auto' } });
    if (!run.link) return new TextRun(options);
    return new ExternalHyperlink({
      link: run.link,
      children: [new TextRun({ ...options, color: theme.primary, underline: {} })],
    });
  });
}

/** Share the table width between columns by how much text each holds. */
function columnWidths(grid) {
  const columns = Math.max(...grid.map((row) => row.length));
  const weights = Array.from({ length: columns }, (_, index) => {
    const longest = Math.max(...grid.map((row) => plainText(row[index] ?? '').length), 4);
    return Math.min(Math.max(longest, 6), 40);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.floor((weight / total) * CONTENT_WIDTH));
  widths[widths.length - 1] += CONTENT_WIDTH - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

function wordTable(grid, theme) {
  const widths = columnWidths(grid);
  const edge = { style: BorderStyle.SINGLE, size: 4, color: theme.line };
  const borders = { top: edge, bottom: edge, left: edge, right: edge };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: grid.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          cantSplit: true,
          children: widths.map((width, columnIndex) => {
            const text = row[columnIndex] ?? '';
            const header = rowIndex === 0;
            const banded = !header && rowIndex % 2 === 0;
            return new TableCell({
              width: { size: width, type: WidthType.DXA },
              borders,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              shading: header
                ? { type: ShadingType.CLEAR, fill: theme.primary, color: 'auto' }
                : banded
                  ? { type: ShadingType.CLEAR, fill: theme.tint, color: 'auto' }
                  : undefined,
              children: [
                new Paragraph({
                  alignment: !header && NUMERIC.test(text.trim()) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: wordRuns(text, theme, header ? { bold: true, color: theme.onPrimary } : {}),
                }),
              ],
            });
          }),
        }),
    ),
  });
}

/** A one-cell table: Word has no callout box, and a tinted, borderless cell is the usual stand-in. */
function wordCallout(text, theme) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    // The table's own default grid is switched off, so no viewer can draw a line round the box.
    borders: TableBorders.NONE,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: theme.tint, color: 'auto' },
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            borders: { top: none, bottom: none, right: none, left: none },
            children: [new Paragraph({ children: wordRuns(text, theme) })],
          }),
        ],
      }),
    ],
  });
}

/**
 * Turn one section into an ordered list of blocks. A section can give `blocks` for
 * full control of order; otherwise its fields are laid out in the usual reading order.
 */
function sectionBlocks(section) {
  if (Array.isArray(section?.blocks)) return list(section.blocks, 'blocks', LIMITS.blocksPerSection);
  const blocks = [];
  if (clean(section?.heading, LIMITS.title) !== '') blocks.push({ type: 'heading', text: section.heading, level: section.level ?? 1 });
  for (const text of list(section?.paragraphs, 'paragraphs', LIMITS.paragraphsPerSection)) blocks.push({ type: 'paragraph', text });
  if (section?.bullets) blocks.push({ type: 'bullets', items: list(section.bullets, 'bullets', LIMITS.paragraphsPerSection) });
  if (section?.numbered) blocks.push({ type: 'numbered', items: list(section.numbered, 'numbered', LIMITS.paragraphsPerSection) });
  if (section?.quote) blocks.push({ type: 'quote', text: section.quote });
  if (section?.callout) blocks.push({ type: 'callout', text: section.callout });
  if (typeof section?.image === 'string') blocks.push({ type: 'image', data: section.image });
  else if (section?.image && typeof section.image === 'object') blocks.push({ type: 'image', ...section.image });
  if (section?.table) blocks.push({ type: 'table', rows: section.table.rows ?? section.table });
  return blocks;
}

/** A list item is a string, or { text, level } for an indented point. */
function listItem(item) {
  if (item && typeof item === 'object') return { text: clean(item.text, 600), level: Math.min(Math.max(Number(item.level) || 0, 0), 2) };
  return { text: clean(item, 600), level: 0 };
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

/**
 * @param {{ title?: string, subtitle?: string, author?: string, date?: string, theme?: string,
 *   coverPage?: boolean, toc?: boolean, header?: string, pageNumbers?: boolean,
 *   sections?: { heading?: string, level?: number, paragraphs?: string[], bullets?: any[], numbered?: any[],
 *   quote?: string, callout?: string, table?: any, blocks?: any[], pageBreakBefore?: boolean }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildDocx(content) {
  const sections = list(content?.sections, 'sections', LIMITS.sections);
  const title = plainText(clean(content?.title, LIMITS.title));
  if (title === '' && sections.length === 0) throw new OfficeError('A Word document needs a title or at least one section.');

  const theme = themeFor(content?.theme, content?.brand);
  const subtitle = plainText(clean(content?.subtitle, LIMITS.title));
  const byline = [clean(content?.author, 100), clean(content?.date, 50)].filter((part) => part !== '').join('  |  ');
  const cover = content?.coverPage === true && title !== '';
  const children = [];
  let numberedLists = 0;
  let headingNumber = 0;

  if (title !== '') {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: cover ? { before: 3600, after: 240 } : { after: 120 },
        children: [new TextRun({ text: title })],
      }),
    );
    if (subtitle !== '') children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: subtitle, size: cover ? 32 : 26, color: theme.muted })] }));
    if (byline !== '') children.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: byline, size: 20, color: theme.muted })] }));
    if (cover) children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // A real Word contents field shows nothing until Word is told to update it, and then asks
  // a confusing question on open. A linked list of the headings needs neither, so that is what
  // "toc" produces: each line jumps to its heading, with no page numbers.
  if (content?.toc === true) {
    const entries = sections.flatMap((section) => sectionBlocks(section).filter((block) => block?.type === 'heading'));
    if (entries.length > 0) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents' })] }));
      entries.forEach((block, index) => {
        const level = Math.min(Math.max(Number(block.level) || 1, 1), 3);
        children.push(
          new Paragraph({
            indent: { left: (level - 1) * 360 },
            spacing: { after: 60 },
            children: [new InternalHyperlink({ anchor: `zuri-heading-${index + 1}`, children: [new TextRun({ text: plainText(clean(block.text, LIMITS.title)), color: theme.primary })] })],
          }),
        );
      });
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  for (const section of sections) {
    if (section?.pageBreakBefore === true) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const block of sectionBlocks(section)) {
      const type = String(block?.type ?? 'paragraph');
      if (type === 'heading') {
        const level = Math.min(Math.max(Number(block.level) || 1, 1), 3);
        headingNumber += 1;
        const heading = wordRuns(plainText(clean(block.text, LIMITS.title)), theme);
        children.push(new Paragraph({ heading: HEADINGS[level - 1], children: content?.toc === true ? [new Bookmark({ id: `zuri-heading-${headingNumber}`, children: heading })] : heading }));
      } else if (type === 'bullets') {
        for (const item of list(block.items, 'bullets', LIMITS.paragraphsPerSection).map(listItem)) {
          children.push(new Paragraph({ bullet: { level: item.level }, spacing: { after: 60 }, children: wordRuns(item.text, theme) }));
        }
      } else if (type === 'numbered') {
        numberedLists += 1;
        for (const item of list(block.items, 'numbered', LIMITS.paragraphsPerSection).map(listItem)) {
          children.push(
            new Paragraph({
              numbering: { reference: 'zuri-numbered', level: item.level, instance: numberedLists },
              spacing: { after: 60 },
              children: wordRuns(item.text, theme),
            }),
          );
        }
      } else if (type === 'quote') {
        children.push(
          new Paragraph({
            indent: { left: 360, right: 360 },
            spacing: { before: 120, after: 160 },
            shading: { type: ShadingType.CLEAR, fill: theme.tint, color: 'auto' },
            children: wordRuns(clean(block.text), theme, { italics: true, color: theme.muted }),
          }),
        );
      } else if (type === 'callout') {
        children.push(wordCallout(clean(block.text), theme), new Paragraph({ spacing: { after: 120 }, children: [] }));
      } else if (type === 'table') {
        const grid = tableRows(block.rows);
        if (grid) {
          children.push(wordTable(grid, theme));
          children.push(block.caption ? wordCaption(block.caption, theme) : new Paragraph({ spacing: { after: 160 }, children: [] }));
        }
      } else if (type === 'image') {
        children.push(...wordImage(block, theme));
      } else if (type === 'pageBreak') {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      } else {
        children.push(new Paragraph({ spacing: { after: 140 }, children: wordRuns(clean(block.text), theme) }));
      }
    }
  }

  const headerText = plainText(clean(content?.header ?? title, 100));
  const small = { size: 18, color: theme.muted };
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: headerText, ...small })] })] });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...small })],
      }),
    ],
  });
  const blank = { children: [new Paragraph({ children: [] })] };

  const heading = (size, color, before, after, extra = {}) => ({
    run: { font: theme.font, size, bold: true, color },
    paragraph: { spacing: { before, after }, keepNext: true, ...extra },
  });

  const document = new Document({
    title: title || undefined,
    creator: 'Zuri',
    styles: {
      default: {
        document: { run: { font: theme.font, size: 22, color: theme.text }, paragraph: { spacing: { line: 276 } } },
        title: heading(56, theme.primary, 0, 120),
        heading1: heading(32, theme.primary, 360, 120, { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: theme.line, space: 4 } } }),
        heading2: heading(26, theme.text, 280, 100),
        heading3: heading(23, theme.muted, 220, 80),
      },
    },
    numbering: {
      config: [
        {
          reference: 'zuri-numbered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: level === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: cover,
          page: { size: { width: A4.width, height: A4.height }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } },
        },
        headers: { default: header, first: new Header(blank) },
        footers: content?.pageNumbers === false ? { default: new Footer(blank), first: new Footer(blank) } : { default: footer, first: new Footer(blank) },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}

// ---------------------------------------------------------------- Excel

/** Excel sheet names: at most 31 characters and none of : \ / ? * [ ]. */
function sheetName(raw, index, used) {
  const base = clean(raw, 31).replace(/[:\\/?*[\]]/g, ' ').trim() || `Sheet${index + 1}`;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 28)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

const NAIRA = '₦';
const NUMBER_FORMATS = Object.freeze({
  integer: '#,##0',
  number: '#,##0.00',
  currency: `"${NAIRA}"#,##0.00`,
  usd: '"$"#,##0.00',
  percent: '0.0%',
  percent0: '0%',
  date: 'dd mmm yyyy',
  // Accounting style: negatives in brackets, so a column of mixed signs lines up.
  accounting: `"${NAIRA}"#,##0.00_);("${NAIRA}"#,##0.00)`,
  eur: '"€"#,##0.00',
  gbp: '"£"#,##0.00',
  thousands: '#,##0,"K"',
  millions: '#,##0.0,,"M"',
});
const SUMMABLE = new Set(['integer', 'number', 'currency', 'usd', 'accounting', 'eur', 'gbp', 'thousands', 'millions']);
const PERCENT_TYPES = new Set(['percent', 'percent0']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Functions Excel stores with an _xlfn. prefix. A file that spells them bare opens
 * with #NAME? until the cell is edited, so the prefix is added as the file is written.
 */
const FUTURE_FUNCTIONS = [
  'XLOOKUP', 'XMATCH', 'FILTER', 'UNIQUE', 'SORT', 'SORTBY', 'SEQUENCE', 'LET', 'TEXTJOIN', 'CONCAT',
  'IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'RANDARRAY', 'TEXTSPLIT', 'TAKE', 'DROP', 'VSTACK', 'HSTACK',
  'TOCOL', 'TOROW', 'CHOOSECOLS', 'CHOOSEROWS', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'LAMBDA',
  'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISOMITTED', 'STDEV.S', 'STDEV.P',
];
const FUTURE_FUNCTION_PATTERN = new RegExp(`(?<![\\w.])(?<!_xlfn\\.)(${FUTURE_FUNCTIONS.map((name) => name.replace('.', '\\.')).join('|')})(?=\\s*\\()`, 'gi');

/** Formula text ready for the file: future functions prefixed. Quoted strings are left alone. */
export function prepareFormula(formula) {
  // Split on double-quoted strings so a word inside "text" is never rewritten.
  return String(formula)
    .split(/("(?:[^"]|"")*")/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(FUTURE_FUNCTION_PATTERN, (name) => `_xlfn.${name.toUpperCase()}`)))
    .join('');
}

/**
 * Replace the {row} token with the sheet row a formula is written on, so the model never
 * counts rows. When the data is an Excel Table, [@Column] becomes the stored form
 * Table[[#This Row],[Column]]; the short form is only what Excel displays.
 */
function withRow(value, rowNumber, tableName = '') {
  if (value === null || typeof value !== 'object' || !('formula' in value) || typeof value.formula !== 'string') return value;
  let formula = value.formula.replaceAll('{row}', String(rowNumber));
  if (tableName !== '') formula = formula.replace(/(?<![\w\]])\[@([^\[\]]+)\]/g, (_, column) => `${tableName}[[#This Row],[${column}]]`);
  return { ...value, formula };
}

/** A legal, unique Excel table name: letters, digits and underscores, starting with a letter, never cell-like. */
function tableNameFor(raw, sheetTitle, used) {
  let base = String(raw ?? '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '');
  if (base === '' || /^[A-Za-z]{1,3}\d{1,7}$/.test(base) || /^[RrCc]$/.test(base)) base = `${String(sheetTitle).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '') || 'Data'}_Table`;
  base = base.slice(0, 60);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

function excelValue(cell) {
  if (typeof cell === 'number' || typeof cell === 'boolean') return cell;
  const text = clean(cell, 2000);
  if (text.startsWith('=') && text.length > 1) return { formula: prepareFormula(text.slice(1)) };
  if (ISO_DATE.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return plainText(text);
}

/** Use the declared type, or read it off the data: a column of only numbers is numeric. */
function columnType(declared, values) {
  if (declared && (Object.hasOwn(NUMBER_FORMATS, declared) || declared === 'text')) return declared;
  const filled = values.filter((value) => value !== '' && value !== null && value !== undefined && !(typeof value === 'object' && 'formula' in value));
  if (filled.length === 0) return 'text';
  if (filled.every((value) => value instanceof Date)) return 'date';
  if (filled.every((value) => typeof value === 'number')) return filled.every((value) => Number.isInteger(value)) ? 'integer' : 'number';
  return 'text';
}

function displayLength(value, type) {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 12;
  if (typeof value === 'object') return 12;
  if (typeof value === 'number') return type === 'currency' || type === 'usd' ? value.toLocaleString('en').length + 4 : value.toLocaleString('en').length + 1;
  return String(value).length;
}

/** Light, readable tints for highlight rules: a rule is a hint, not a siren. */
const HIGHLIGHTS = Object.freeze({
  red: { fill: 'FFFDECEF', font: 'FFC2253A' },
  green: { fill: 'FFE7F6EC', font: 'FF15803D' },
  amber: { fill: 'FFFDF3E4', font: 'FF9A5B06' },
  blue: { fill: 'FFE8EFFC', font: 'FF1B47B8' },
});

/** Column number (1-based) for a header name, a letter or a 1-based index; 0 when nothing matches. */
function columnIndex(ref, columns, width) {
  if (typeof ref === 'number' && ref >= 1 && ref <= width) return ref;
  const text = String(ref ?? '').trim();
  const byHeader = columns.findIndex((column) => plainText(column.header).toLowerCase() === text.toLowerCase());
  if (byHeader >= 0) return byHeader + 1;
  if (/^[A-Za-z]{1,2}$/.test(text)) {
    const number = [...text.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
    if (number >= 1 && number <= width) return number;
  }
  return 0;
}

function columnLetter(number) {
  let out = '';
  for (let column = number; column > 0; column = Math.floor((column - 1) / 26)) out = String.fromCharCode(65 + ((column - 1) % 26)) + out;
  return out;
}

/**
 * Conditional formatting that Excel keeps live: `scale` paints a two-colour gradient
 * across a column, `highlight` marks cells that pass a test. A rule naming a column
 * that does not exist is skipped rather than failing the whole file.
 */
function addConditionalFormats(worksheet, sheet, columns, width, firstRow, lastRow, theme) {
  if (lastRow < firstRow) return;
  for (const ref of list(sheet?.scale, 'scale', LIMITS.tableColumns)) {
    const column = columnIndex(ref, columns, width);
    if (column === 0) continue;
    const letter = columnLetter(column);
    worksheet.addConditionalFormatting({
      ref: `${letter}${firstRow}:${letter}${lastRow}`,
      rules: [{ type: 'colorScale', cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: `FF${theme.primary}` }] }],
    });
  }
  for (const ref of list(sheet?.dataBars, 'dataBars', LIMITS.tableColumns)) {
    const column = columnIndex(ref, columns, width);
    if (column === 0) continue;
    const letter = columnLetter(column);
    worksheet.addConditionalFormatting({
      ref: `${letter}${firstRow}:${letter}${lastRow}`,
      rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: `FF${theme.chartColors?.[2] ?? theme.accent}` } }],
    });
  }
  const operators = { greaterThan: 'greaterThan', lessThan: 'lessThan', equal: 'equal', between: 'between', negative: 'lessThan' };
  for (const rule of list(sheet?.highlight, 'highlight', LIMITS.tableColumns)) {
    const column = columnIndex(rule?.column, columns, width);
    const operator = operators[String(rule?.rule ?? '')];
    if (column === 0 || !operator) continue;
    const tint = HIGHLIGHTS[String(rule?.color ?? 'red')] ?? HIGHLIGHTS.red;
    const letter = columnLetter(column);
    const formulae = rule.rule === 'negative' ? [0] : rule.rule === 'between' ? [Number(rule.value), Number(rule.value2)] : [Number(rule.value)];
    if (formulae.some((value) => !Number.isFinite(value))) continue;
    worksheet.addConditionalFormatting({
      ref: `${letter}${firstRow}:${letter}${lastRow}`,
      rules: [{ type: 'cellIs', operator, formulae, priority: 1, style: { font: { color: { argb: tint.font } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: tint.fill } } } }],
    });
  }
}

/**
 * Drop-down lists on a column's cells, and names for a column's data. A list is a
 * real Excel validation, so a person picks from it instead of typing; a name lets a
 * formula read as =SUM(Revenue). Rules that name a missing column are skipped.
 */
function addColumnFeatures(worksheet, sheet, columns, width, firstRow, lastRow, workbook) {
  if (lastRow < firstRow) return;
  // Room below the data as well, so a row added later gets the same drop-down.
  const lastValidated = lastRow + 200;
  for (const entry of list(sheet?.dropdowns, 'dropdowns', LIMITS.tableColumns)) {
    const column = columnIndex(entry?.column, columns, width);
    const options = list(entry?.options, 'dropdown options', 50).map((option) => plainText(clean(option, 60)).replace(/[,"]/g, ' ').trim()).filter((option) => option !== '');
    const joined = options.join(',');
    // Excel refuses an inline list longer than 255 characters.
    if (column === 0 || options.length === 0 || joined.length > 255) continue;
    for (let row = firstRow; row <= lastValidated; row += 1) {
      worksheet.getCell(row, column).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${joined}"`], showErrorMessage: true, errorTitle: 'Pick from the list', error: 'Choose one of the options in the list.' };
    }
  }
  const quote = `'${worksheet.name.replace(/'/g, "''")}'`;
  for (const entry of list(sheet?.names, 'names', LIMITS.tableColumns)) {
    const column = columnIndex(entry?.column, columns, width);
    const name = clean(entry?.name, 80);
    if (column === 0 || !/^[A-Za-z_][A-Za-z0-9_.]{0,79}$/.test(name) || /^[A-Za-z]{1,3}\d{1,7}$/.test(name)) continue;
    const letter = columnLetter(column);
    workbook.definedNames.add(`${quote}!${letter}${firstRow}:${letter}${lastRow}`, name);
  }
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeXml = (text) => String(text).replace(/[&<>"]/g, (char) => XML_ESCAPES[char]);

/** One c:ser: references plus cached values, so the chart draws before Excel recalculates. */
function chartSeries({ index, sheetName, categoryLetter, valueLetter, header, firstRow, lastRow, labels, values, theme, line, pie, area }) {
  const quote = `'${sheetName.replace(/'/g, "''")}'`;
  const range = (letter) => `${quote}!$${letter}$${firstRow}:$${letter}$${lastRow}`;
  const palette = theme.chartColors ?? [theme.primary, theme.accent, '6B7280', '10B981', 'F59E0B', '8B5CF6'];
  const colour = palette[index % palette.length];
  const shape = line
    ? `<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>`
    : `<c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr>${area || pie ? '' : '<c:invertIfNegative val="0"/>'}`;
  const points = pie
    ? values.map((_, pointIndex) => `<c:dPt><c:idx val="${pointIndex}"/><c:spPr><a:solidFill><a:srgbClr val="${palette[pointIndex % palette.length]}"/></a:solidFill></c:spPr></c:dPt>`).join('')
    : '';
  return (
    `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
    `<c:tx><c:strRef><c:f>${escapeXml(`${quote}!$${valueLetter}$${firstRow - 1}`)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(header)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    shape + points +
    `<c:cat><c:strRef><c:f>${escapeXml(range(categoryLetter))}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${labels.map((label, i) => `<c:pt idx="${i}"><c:v>${escapeXml(label)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${escapeXml(range(valueLetter))}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, i) => `<c:pt idx="${i}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>` +
    (line ? '<c:smooth val="0"/>' : '') +
    '</c:ser>'
  );
}

/** Chart kinds the builder draws; anything else falls back to a column chart. */
const CHART_KINDS = ['bar', 'line', 'pie', 'stacked', 'doughnut', 'area', 'combo'];

const DATA_LABELS = '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';

/**
 * The chart part itself (xl/charts/chartN.xml).
 * `seriesXml` holds every series; a combo chart gives its line series separately in
 * `options.lineXml` so they can ride a second value axis on the right.
 * @param {{ valueFormat?: string, labels?: boolean, lineXml?: string }} [options]
 */
function chartXml(kind, title, seriesXml, theme, options = {}) {
  const format = escapeXml(options.valueFormat || 'General');
  const labels = options.labels === true ? DATA_LABELS : '';
  const axes =
    '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${theme.line}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${format}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  // The line series of a combo chart read against their own scale, drawn on the right and without a second set of category labels.
  const secondaryAxes =
    '<c:catAx><c:axId val="333"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="444"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    '<c:valAx><c:axId val="444"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="333"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>';
  const bars = (grouping, extra = '') => `<c:barChart><c:barDir val="col"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${seriesXml}${labels}<c:gapWidth val="80"/>${extra}<c:axId val="111"/><c:axId val="222"/></c:barChart>`;
  const plots = {
    pie: `<c:pieChart><c:varyColors val="1"/>${seriesXml}${labels}<c:firstSliceAng val="0"/></c:pieChart>`,
    doughnut: `<c:doughnutChart><c:varyColors val="1"/>${seriesXml}${labels}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`,
    line: `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${seriesXml}${labels}<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>${axes}`,
    area: `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${seriesXml}${labels}<c:axId val="111"/><c:axId val="222"/></c:areaChart>${axes}`,
    stacked: `${bars('stacked', '<c:overlap val="100"/>')}${axes}`,
    combo: `${bars('clustered')}<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${options.lineXml ?? ''}<c:marker val="1"/><c:axId val="333"/><c:axId val="444"/></c:lineChart>${axes}${secondaryAxes}`,
    bar: `${bars('clustered')}${axes}`,
  };
  const plot = plots[kind] ?? plots.bar;
  const heading = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<c:roundedCorners val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:chart>${heading}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
}

/**
 * Add native charts to a finished workbook. exceljs cannot write charts, so the
 * chart, drawing and relationship parts are written straight into the package.
 * @param {Buffer} buffer
 * @param {{ sheetIndex: number, name: string, chart: any, columns: any[], width: number, firstRow: number, lastRow: number, rows: any[][] }[]} plans
 */
async function addExcelCharts(buffer, plans, theme) {
  if (plans.length === 0) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  let chartNumber = 0;
  const groups = new Map();
  plans.forEach((plan) => groups.set(plan.sheetIndex, [...(groups.get(plan.sheetIndex) ?? []), plan]));

  for (const [sheetIndex, sheetPlans] of groups) {
    const drawingNumber = sheetIndex + 1;
    const anchors = [];
    const chartRelationships = [];
    for (const plan of sheetPlans) {
      const { chart, columns, width, firstRow, lastRow, rows } = plan;
      const kind = CHART_KINDS.includes(String(chart?.type)) ? String(chart.type) : 'bar';
      const categoryColumn = columnIndex(chart?.categories ?? 1, columns, width) || 1;
      const wanted = Array.isArray(chart?.values) ? chart.values : [chart?.values];
      const valueColumns = wanted.map((ref) => columnIndex(ref, columns, width)).filter((number) => number > 0 && number !== categoryColumn);
      if (valueColumns.length === 0) continue;
      const labels = rows.map((row) => {
        const cell = row[categoryColumn - 1];
        return cell instanceof Date ? cell.toISOString().slice(0, 10) : plainText(String(cell ?? ''));
      });
      const circular = kind === 'pie' || kind === 'doughnut';
      const used = valueColumns.slice(0, circular ? 1 : 6);
      // A combo chart needs something to put on the second scale; with one series it is just columns.
      const drawn = kind === 'combo' && used.length < 2 ? 'bar' : kind;
      const seriesFor = (number, index) => chartSeries({
        index, sheetName: plan.name, categoryLetter: columnLetter(categoryColumn), valueLetter: columnLetter(number),
        header: plainText(columns[number - 1]?.header ?? `Series ${index + 1}`), firstRow, lastRow, labels,
        values: rows.map((row) => (typeof row[number - 1] === 'number' ? row[number - 1] : 0)), theme,
        line: drawn === 'line' || (drawn === 'combo' && index > 0), pie: circular, area: drawn === 'area',
      });
      // Combo: the first series is columns on the left scale, the rest are lines on the right.
      const seriesXml = (drawn === 'combo' ? used.slice(0, 1).map(seriesFor) : used.map(seriesFor)).join('');
      const lineXml = drawn === 'combo' ? used.slice(1).map((number, index) => seriesFor(number, index + 1)).join('') : '';
      // The value axis shows the first series' own format (currency, percent, thousands...) instead of raw numbers.
      const firstType = columnType(columns[used[0] - 1]?.type, rows.map((row) => row[used[0] - 1]));
      const valueFormat = Object.hasOwn(NUMBER_FORMATS, firstType) && firstType !== 'date' ? NUMBER_FORMATS[firstType] : 'General';

      chartNumber += 1;
      const relationshipId = `rId${anchors.length + 1}`;
      zip.file(`xl/charts/chart${chartNumber}.xml`, chartXml(drawn, plainText(clean(chart?.title, 100)), seriesXml, theme, { valueFormat, labels: chart?.labels === true, lineXml }));
      chartRelationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNumber}.xml"/>`);
      const anchor = chartAnchor(plan);
      anchors.push(
        `<xdr:twoCellAnchor><xdr:from><xdr:col>${anchor.fromColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
          `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartNumber + 1}" name="Chart ${chartNumber}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
          `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationshipId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
      );
      contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/charts/chart${chartNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
    }
    if (anchors.length === 0) continue;

    zip.file(`xl/drawings/drawing${drawingNumber}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${chartRelationships.join('')}</Relationships>`);
    contentTypes = contentTypes.replace('</Types>', `<Override PartName="/xl/drawings/drawing${drawingNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);

    const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const relsPath = `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`;
    const drawingRelationshipId = `rIdDashboardDrawing${drawingNumber}`;
    const relationship = `<Relationship Id="${drawingRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNumber}.xml"/>`;
    const existingRels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : null;
    zip.file(relsPath, existingRels ? existingRels.replace('</Relationships>', `${relationship}</Relationships>`) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`);

    let sheetXml = await zip.file(sheetPath).async('string');
    if (!sheetXml.includes('xmlns:r=')) sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    const stops = ['<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'].map((tag) => sheetXml.indexOf(tag)).filter((at) => at >= 0);
    const at = Math.min(...stops);
    zip.file(sheetPath, `${sheetXml.slice(0, at)}<drawing r:id="${drawingRelationshipId}"/>${sheetXml.slice(at)}`);
  }
  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function chartAnchor(plan) {
  if (!plan.dashboard) return { fromColumn: plan.width + 1, fromRow: 1, toColumn: plan.width + 10, toRow: 19 };
  const positions = plan.chartCount === 1
    ? [{ fromColumn: 0, fromRow: 8, toColumn: 12, toRow: 24 }]
    : plan.chartCount === 2
      ? [{ fromColumn: 0, fromRow: 8, toColumn: 6, toRow: 24 }, { fromColumn: 6, fromRow: 8, toColumn: 12, toRow: 24 }]
      : plan.chartCount === 3
        ? [
            { fromColumn: 0, fromRow: 8, toColumn: 12, toRow: 20 },
            { fromColumn: 0, fromRow: 20, toColumn: 6, toRow: 32 },
            { fromColumn: 6, fromRow: 20, toColumn: 12, toRow: 32 },
          ]
        : [
          { fromColumn: 0, fromRow: 8, toColumn: 6, toRow: 20 },
          { fromColumn: 6, fromRow: 8, toColumn: 12, toRow: 20 },
          { fromColumn: 0, fromRow: 20, toColumn: 6, toRow: 32 },
          { fromColumn: 6, fromRow: 20, toColumn: 12, toRow: 32 },
        ];
  return positions[plan.chartIndex] ?? positions[0];
}

function dashboardCharts(sheet) {
  const entries = Array.isArray(sheet?.charts) ? sheet.charts : sheet?.chart ? [sheet.chart] : [];
  return entries.slice(0, 4);
}

function dashboardKpis(sheet, rows) {
  const explicit = Array.isArray(sheet?.kpis) ? sheet.kpis : [];
  const entries = explicit.length > 0
    ? explicit
    : rows.slice(0, 4).map((row) => ({ label: row[0], value: row[1], change: row[2] }));
  return entries
    .slice(0, 6)
    .map((entry) => ({
      label: plainText(clean(entry?.label, 60)),
      value: excelValue(entry?.value),
      change: entry?.change === undefined || entry?.change === null ? '' : plainText(clean(entry.change, 40)),
      format: clean(entry?.format, 30),
    }))
    .filter((entry) => entry.label !== '');
}

function addDashboardCanvas(worksheet, sheet, rows, theme, fill, chartCount) {
  const canvasColumns = 12;
  worksheet.mergeCells(1, 1, 2, canvasColumns);
  const title = worksheet.getCell(1, 1);
  title.value = plainText(clean(sheet?.title, 100)) || `${worksheet.name} Dashboard`;
  title.font = { name: theme.font, size: 24, bold: true, color: { argb: `FF${theme.text}` } };
  title.fill = fill(theme.tint);
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  worksheet.getRow(1).height = 28;
  worksheet.getRow(2).height = 28;

  worksheet.mergeCells(3, 1, 3, canvasColumns);
  const subtitle = worksheet.getCell(3, 1);
  subtitle.value = plainText(clean(sheet?.subtitle, 180)) || 'A clear view of the measures that need attention';
  subtitle.font = { name: theme.font, size: 11, color: { argb: `FF${theme.muted}` } };
  subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 };
  worksheet.getRow(3).height = 22;

  const kpis = dashboardKpis(sheet, rows);
  const cardWidth = 2;
  const cardGap = kpis.length <= 4 ? 1 : 0;
  kpis.forEach((kpi, index) => {
    const startColumn = 1 + index * (cardWidth + cardGap);
    if (startColumn > canvasColumns) return;
    const endColumn = Math.min(canvasColumns, startColumn + cardWidth - 1);
    worksheet.mergeCells(5, startColumn, 5, endColumn);
    worksheet.mergeCells(6, startColumn, 6, endColumn);
    worksheet.mergeCells(7, startColumn, 7, endColumn);
    const label = worksheet.getCell(5, startColumn);
    const value = worksheet.getCell(6, startColumn);
    const change = worksheet.getCell(7, startColumn);
    label.value = kpi.label;
    value.value = kpi.value;
    change.value = kpi.change;
    for (const cell of [label, value, change]) {
      cell.fill = fill(index % 2 === 0 ? theme.tint : monochromePalette(theme.primary)[5]);
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.font = { name: theme.font, color: { argb: `FF${theme.text}` } };
    }
    label.font = { name: theme.font, size: 10, bold: true, color: { argb: `FF${theme.muted}` } };
    value.font = { name: theme.font, size: 18, bold: true, color: { argb: `FF${theme.text}` } };
    change.font = { name: theme.font, size: 10, color: { argb: `FF${theme.primary}` } };
    if (kpi.format !== '') value.numFmt = kpi.format;
  });
  worksheet.getRow(4).height = 10;
  worksheet.getRow(5).height = 20;
  worksheet.getRow(6).height = 28;
  worksheet.getRow(7).height = 20;
  worksheet.getRow(8).height = 10;

  const tableStartRow = chartCount > 2 ? 35 : 27;
  worksheet.mergeCells(tableStartRow - 2, 1, tableStartRow - 2, canvasColumns);
  const detailHeading = worksheet.getCell(tableStartRow - 2, 1);
  detailHeading.value = plainText(clean(sheet?.tableTitle, 80)) || 'Supporting detail';
  detailHeading.font = { name: theme.font, size: 13, bold: true, color: { argb: `FF${theme.text}` } };
  detailHeading.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(tableStartRow - 2).height = 24;
  return tableStartRow;
}

/**
 * @param {{ theme?: string, sheets?: { name?: string, columns?: (string | { header: string, type?: string, width?: number })[],
 *   rows?: any[][], totals?: boolean, filter?: boolean, freeze?: boolean }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildXlsx(content) {
  const sheets = list(content?.sheets, 'sheets', LIMITS.sheets);
  if (sheets.length === 0) throw new OfficeError('An Excel file needs at least one sheet.');

  const theme = dashboardTheme(content) ?? themeFor(content?.theme, content?.brand);
  const isDashboard = Boolean(dashboardTheme(content));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zuri';
  // Formula cells carry no saved results, so Excel must calculate when the file opens.
  workbook.calcProperties.fullCalcOnLoad = true;
  const used = new Set();
  const usedTableNames = new Set();
  const edge ={ style: 'thin', color: { argb: `FF${theme.line}` } };
  const grid = { top: edge, bottom: edge, left: edge, right: edge };
  const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
  const chartPlans = [];
  // One entry per Table, in the order the tables are written (table1.xml, table2.xml...).
  const tableFormulas = [];

  for (const [index, sheet] of sheets.entries()) {
    const worksheet = workbook.addWorksheet(sheetName(sheet?.name, index, used), { properties: { tabColor: { argb: `FF${theme.primary}` } } });
    const columns = list(sheet?.columns, 'columns', LIMITS.tableColumns).map((column) =>
      typeof column === 'object' && column !== null ? { header: clean(column.header, 200), type: column.type, width: column.width, formula: clean(column.formula, 2000), input: column.role === 'input' } : { header: clean(column, 200) },
    );
    const rows = list(sheet?.rows, 'rows', LIMITS.sheetRows).map((row) => list(row, 'A row', LIMITS.tableColumns).map(excelValue));
    const realRowCount = rows.length;
    // Empty rows below the data keep the formulas, drop-downs and totals of a template ready for the next entry.
    // A columns-only sheet is a valid blank template too, so do not require a starter row before reserving space.
    const blankRows = columns.length > 0 ? Math.min(Math.max(Math.trunc(Number(sheet?.blankRows)) || 0, 0), 200) : 0;
    for (let blank = 0; blank < blankRows; blank += 1) rows.push(Array.from({ length: columns.length }, () => ''));
    // A calculated column fills every row that left its cell empty, so the model writes
    // the formula once and never has to count rows.
    columns.forEach((column, at) => {
      if (!column.formula?.startsWith('=') || column.formula.length < 2) return;
      for (const row of rows) {
        while (row.length < at) row.push('');
        if (row[at] === undefined || row[at] === '' || row[at] === null) row[at] = excelValue(column.formula);
      }
    });
    const width = Math.max(columns.length, ...rows.map((row) => row.length), 1);
    // The data becomes a real Excel Table when every column has its own header; a Table
    // refuses repeated or blank header names, so those sheets keep the plain layout.
    const headerNames = columns.map((column) => plainText(column.header).trim());
    const asTable = sheet?.table !== false && rows.length > 0 && columns.length === width && headerNames.every((name) => name !== '') && new Set(headerNames.map((name) => name.toLowerCase())).size === width;
    const tableName = asTable ? tableNameFor(sheet?.tableName, worksheet.name, usedTableNames) : '';
    const types = Array.from({ length: width }, (_, column) => columnType(columns[column]?.type, rows.map((row) => row[column])));
    const hasHeader = columns.length > 0;
    const charts = dashboardCharts(sheet);
    const dashboardSheet = isDashboard && index === 0;
    const tableStartRow = dashboardSheet ? addDashboardCanvas(worksheet, sheet, rows, theme, fill, charts.length) : 1;
    // A dashboard needs breathing room around values. Keep the sheet readable at
    // normal zoom instead of packing every column against its neighbour.
    const widths = Array.from({ length: width }, (_, column) => Math.max(isDashboard ? 14 : 10, columns[column]?.header.length + (isDashboard ? 7 : 4) || (isDashboard ? 14 : 10)));

    if (hasHeader) {
      const tableHeader = worksheet.getRow(tableStartRow);
      tableHeader.values = columns.map((column) => plainText(column.header));
      tableHeader.height = isDashboard ? 32 : 24;
      tableHeader.eachCell((cell, column) => {
        cell.font = { name: theme.font, bold: true, color: { argb: `FF${isDashboard ? theme.text : theme.onPrimary}` } };
        cell.fill = fill(isDashboard ? theme.tint : theme.primary);
        cell.border = grid;
        cell.alignment = { vertical: 'middle', horizontal: SUMMABLE.has(types[column - 1]) || PERCENT_TYPES.has(types[column - 1]) ? 'right' : 'left', wrapText: true };
      });
    }

    for (const [rowIndex, values] of rows.entries()) {
      const row = worksheet.getRow(tableStartRow + (hasHeader ? 1 : 0) + rowIndex);
      row.values = values.map((value) => withRow(value, row.number, tableName));
      if (isDashboard) row.height = 27;
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        const type = types[column - 1];
        cell.font = { name: theme.font };
        cell.border = grid;
        cell.alignment = { vertical: 'center', wrapText: type === 'text', ...(isDashboard ? { indent: 1 } : {}) };
        if (type !== 'text') cell.numFmt = NUMBER_FORMATS[type];
        if (rowIndex % 2 === 1) cell.fill = fill(theme.tint);
        // The financial-model convention: cells a person types into are blue on a pale wash.
        if (columns[column - 1]?.input) {
          cell.font = { name: theme.font, color: { argb: 'FF1F4FD8' } };
          cell.fill = fill('FFF8E1');
        }
        widths[column - 1] = Math.max(widths[column - 1], Math.min(displayLength(values[column - 1], type) + (isDashboard ? 6 : 3), 60));
      });
    }

    if (sheet?.totals === true && rows.length > 0) {
      const first = tableStartRow + (hasHeader ? 1 : 0);
      const last = first + rows.length - 1;
      const total = worksheet.getRow(last + 1);
      total.values = types.map((type, column) => {
          if (column === 0 && !SUMMABLE.has(type)) return 'Total';
          if (!SUMMABLE.has(type)) return '';
          const letter = worksheet.getColumn(column + 1).letter;
          return { formula: `SUM(${letter}${first}:${letter}${last})` };
        });
      total.eachCell({ includeEmpty: true }, (cell, column) => {
        const type = types[column - 1];
        cell.font = { name: theme.font, bold: true };
        cell.fill = fill(theme.tint);
        cell.border = { ...grid, top: { style: 'medium', color: { argb: `FF${theme.primary}` } } };
        if (SUMMABLE.has(type)) cell.numFmt = NUMBER_FORMATS[type];
      });
    }

    widths.forEach((value, column) => {
      worksheet.getColumn(column + 1).width = columns[column]?.width ?? value;
    });
    if (dashboardSheet) {
      for (let column = width + 1; column <= 12; column += 1) worksheet.getColumn(column).width = 12;
    }
    const firstDataRow = tableStartRow + (hasHeader ? 1 : 0);
    const lastDataRow = firstDataRow + rows.length - 1;
    addConditionalFormats(worksheet, sheet, columns, width, firstDataRow, lastDataRow, theme);
    addColumnFeatures(worksheet, sheet, columns, width, firstDataRow, lastDataRow, workbook);
    if (charts.length > 0 && rows.length > 0) {
      charts.forEach((chart, chartIndex) => chartPlans.push({ sheetIndex: index, name: worksheet.name, chart, chartIndex, chartCount: charts.length, dashboard: dashboardSheet, columns, width, firstRow: firstDataRow, lastRow: firstDataRow + realRowCount - 1, rows: rows.slice(0, realRowCount) }));
    }
    if (dashboardSheet) worksheet.views = [{ state: 'frozen', ySplit: 8, showGridLines: false, zoomScale: 90 }];
    else if (hasHeader && sheet?.freeze !== false) worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (asTable) {
      // The cells are already styled above; the table adds structure (names, filters, growth)
      // and its own banding stays off so it never fights the theme's fills.
      // A formula that names its own row number cannot be a calculated column, so only the row-independent ones are marked.
      tableFormulas.push(columns.flatMap((column, at) => (
        column.formula?.startsWith('=') && column.formula.length > 1 && !column.formula.includes('{row}')
          ? [{ name: headerNames[at], formula: withRow({ formula: prepareFormula(column.formula.slice(1)) }, 0, tableName).formula }]
          : []
      )));
      worksheet.addTable({
        name: tableName,
        ref: `A${tableStartRow}`,
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleLight1', showRowStripes: false },
        columns: headerNames.map((name) => ({ name, filterButton: sheet?.filter !== false })),
        rows: rows.map((values, rowIndex) => Array.from({ length: width }, (_, at) => withRow(values[at] ?? '', firstDataRow + rowIndex, tableName))),
      });
    } else if (hasHeader && sheet?.filter !== false) worksheet.autoFilter = { from: { row: tableStartRow, column: 1 }, to: { row: tableStartRow, column: width } };
    // Wide sheets print sideways and fit one page across, instead of splitting columns over pages.
    worksheet.pageSetup = { orientation: width > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    if (hasHeader) worksheet.pageSetup.printTitlesRow = `${tableStartRow}:${tableStartRow}`;
  }

  const withCharts = await addExcelCharts(Buffer.from(await workbook.xlsx.writeBuffer()), chartPlans, theme);
  return addCalculatedColumns(withCharts, tableFormulas);
}

/**
 * Tell Excel which Table columns are calculated. exceljs writes the cell formulas but not
 * the column's own formula, and without it a row added later (by typing under the table)
 * stays empty instead of filling itself in. The formula is the stored structured form.
 * @param {Buffer} buffer
 * @param {{ name: string, formula: string }[][]} tables One list per Table, in file order.
 */
async function addCalculatedColumns(buffer, tables) {
  if (!tables.some((columns) => columns.length > 0)) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  for (const [position, columns] of tables.entries()) {
    const file = zip.file(`xl/tables/table${position + 1}.xml`);
    if (!file || columns.length === 0) continue;
    let xml = await file.async('string');
    for (const { name, formula } of columns) {
      const column = new RegExp(`(<tableColumn [^>]*name="${escapeXml(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*?)/>`);
      xml = xml.replace(column, `$1><calculatedColumnFormula>${escapeXml(formula)}</calculatedColumnFormula></tableColumn>`);
    }
    zip.file(`xl/tables/table${position + 1}.xml`, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------- PowerPoint

const SLIDE = Object.freeze({ width: 13.33, height: 7.5 });

/** Average glyph width is about half the point size; this is a deliberate overestimate so text shrinks early rather than spilling. */
const GLYPH = 0.52;
const LINE = 1.25;

/**
 * Pick the largest font at which the items fit the box, and split off what still does
 * not fit at the smallest size. Text that overflows a slide is the commonest way a
 * generated deck looks broken, so this is estimated rather than left to the viewer.
 * @param {string[]} items @param {number} widthIn @param {number} heightIn
 * @param {number} maxPt @param {number} minPt
 * @returns {{ fontSize: number, chunks: string[][] }}
 */
export function fitText(items, widthIn, heightIn, maxPt = 24, minPt = 14) {
  const needed = (entries, pt) => {
    const perLine = Math.max(8, Math.floor((widthIn * 72) / (pt * GLYPH)) - 4);
    const lines = entries.reduce((sum, text) => sum + Math.max(1, Math.ceil(plainText(text).length / perLine)), 0);
    return (lines * pt * LINE + entries.length * 10) / 72;
  };
  for (let pt = maxPt; pt >= minPt; pt -= 2) {
    if (needed(items, pt) <= heightIn) return { fontSize: pt, chunks: [items] };
  }
  const chunks = [];
  let current = [];
  for (const item of items) {
    if (current.length > 0 && needed([...current, item], minPt) > heightIn) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) chunks.push(current);
  return { fontSize: minPt, chunks };
}

/** @param {string} text @param {ReturnType<typeof themeFor>} theme @param {any} base */
function slideRuns(text, theme, base = {}) {
  return inlineRuns(text).map((run) => ({
    text: run.text,
    options: {
      ...base,
      bold: base.bold || run.bold || undefined,
      italic: base.italic || run.italic || undefined,
      fontFace: run.code ? 'Consolas' : undefined,
      color: run.link ? theme.primary : base.color,
      hyperlink: run.link ? { url: run.link } : undefined,
    },
  }));
}

/** One text array per bullet list: paragraph settings on a bullet's first run, the line break on its last. */
function bulletRuns(items, theme) {
  return items.flatMap((item) => {
    const runs = slideRuns(clean(item, 400), theme);
    runs[0].options = { ...runs[0].options, bullet: { indent: 22 }, paraSpaceAfter: 10 };
    runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: true };
    return runs;
  });
}

function defineMasters(deck, theme) {
  const number = { x: 12.3, y: 6.95, w: 0.7, h: 0.35, fontFace: theme.font, fontSize: 11, color: theme.muted, align: 'right' };
  deck.defineSlideMaster({
    title: 'ZURI_CONTENT',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: SLIDE.width, h: 0.18, fill: { color: theme.primary } } },
      { rect: { x: 0.6, y: 1.35, w: 1.2, h: 0.05, fill: { color: theme.accent } } },
    ],
    slideNumber: number,
  });
  deck.defineSlideMaster({
    title: 'ZURI_FEATURE',
    background: { color: theme.primary },
    objects: [{ rect: { x: 0.8, y: 4.35, w: 1.6, h: 0.07, fill: { color: theme.accent } } }],
  });
}

function slideTitle(slide, text, theme, color = theme.primary) {
  const plain = plainText(clean(text, LIMITS.title));
  if (plain === '') return;
  slide.addText(plain, {
    x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: theme.font, bold: true, color, valign: 'middle',
    fontSize: plain.length > 60 ? 24 : plain.length > 40 ? 28 : 32, fit: 'shrink',
  });
}

function pickLayout(entry) {
  const named = String(entry?.layout ?? '').toLowerCase();
  const known = ['bullets', 'section', 'twocolumn', 'bignumber', 'table', 'quote', 'chart', 'image', 'process', 'closing'];
  if (known.includes(named)) return named;
  if (entry?.chart) return 'chart';
  if (entry?.image) return 'image';
  if (Array.isArray(entry?.steps)) return 'process';
  if (entry?.table) return 'table';
  if (entry?.left || entry?.right) return 'twocolumn';
  if (entry?.stat) return 'bignumber';
  if (entry?.quote) return 'quote';
  return 'bullets';
}

function featureSlide(deck, theme, title, subtitle, small) {
  const slide = deck.addSlide({ masterName: 'ZURI_FEATURE' });
  slide.addText(plainText(title), { x: 0.8, y: 1.9, w: 11.7, h: 2.3, fontFace: theme.font, bold: true, color: theme.onPrimary, fontSize: plainText(title).length > 40 ? 36 : 44, valign: 'bottom', fit: 'shrink' });
  if (subtitle !== '') slide.addText(plainText(subtitle), { x: 0.8, y: 4.6, w: 11.7, h: 0.8, fontFace: theme.font, color: theme.onPrimary, fontSize: 20, valign: 'top' });
  if (small !== '') slide.addText(small, { x: 0.8, y: 6.5, w: 11.7, h: 0.4, fontFace: theme.font, color: theme.onPrimary, fontSize: 13, transparency: 20 });
  return slide;
}

function addBullets(slide, items, theme, box) {
  const { fontSize } = fitText(items, box.w, box.h);
  slide.addText(bulletRuns(items, theme), { ...box, fontFace: theme.font, fontSize, color: theme.text, valign: 'top' });
}

function addChart(deck, slide, chart, theme, box) {
  const types = { bar: deck.charts.BAR, line: deck.charts.LINE, pie: deck.charts.PIE, doughnut: deck.charts.DOUGHNUT, area: deck.charts.AREA };
  const kind = String(chart?.type ?? 'bar').toLowerCase();
  const labels = list(chart?.labels, 'chart labels', 50).map((label) => plainText(clean(label, 60)));
  const series = list(chart?.series, 'chart series', 8).map((entry) => ({
    name: plainText(clean(entry?.name, 60)) || 'Series',
    labels,
    values: list(entry?.values, 'chart values', 50).map((value) => Number(value) || 0),
  }));
  if (!Object.hasOwn(types, kind) || series.length === 0 || labels.length === 0) throw new OfficeError('A chart needs a type (bar, line, pie, doughnut or area), labels and at least one series.');
  const round = kind === 'pie' || kind === 'doughnut';
  slide.addChart(types[kind], series, {
    ...box,
    chartColors: [theme.primary, theme.accent, '6B7280', '10B981', 'F59E0B', '8B5CF6', 'EF4444', '14B8A6'],
    showLegend: series.length > 1 || round,
    legendPos: 'b',
    legendFontFace: theme.font,
    catAxisLabelFontFace: theme.font,
    valAxisLabelFontFace: theme.font,
    valGridLine: { color: theme.line, size: 0.5 },
    showValue: round || series[0].values.length <= 8,
    dataLabelFontFace: theme.font,
    showPercent: round,
  });
}

/** A picture on the left, kept in proportion, with bullets or a caption beside it. */
function addPicture(deck, slide, entry, bullets, theme, box) {
  const image = parseImage(entry?.image?.data ?? entry?.image);
  const hasText = bullets.length > 0;
  const frame = { x: box.x, y: box.y, w: hasText ? 6.4 : box.w, h: box.h - (entry?.caption ? 0.5 : 0) };
  const scale = Math.min(frame.w / image.width, frame.h / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  slide.addImage({
    data: image.uri.replace(/^data:/, ''),
    x: frame.x + (frame.w - width) / 2,
    y: frame.y + (frame.h - height) / 2,
    w: width,
    h: height,
    altText: plainText(clean(entry?.alt ?? entry?.caption ?? entry?.title, 200)),
  });
  if (entry?.caption) slide.addText(plainText(clean(entry.caption, 200)), { x: frame.x, y: box.y + box.h - 0.45, w: frame.w, h: 0.4, fontFace: theme.font, italic: true, fontSize: 13, color: theme.muted, align: 'center' });
  if (hasText) addBullets(slide, bullets, theme, { x: box.x + 6.8, y: box.y, w: box.w - 6.8, h: box.h });
}

/** Steps drawn left to right as numbered boxes joined by arrows, so a process reads as a diagram and stays editable. */
function addProcess(deck, slide, steps, theme, box) {
  const items = list(steps, 'steps', 6).map((step) => ({
    title: plainText(clean(typeof step === 'string' ? step : step?.title, 60)),
    text: plainText(clean(typeof step === 'string' ? '' : step?.text, 160)),
  })).filter((step) => step.title !== '');
  if (items.length === 0) throw new OfficeError('A process slide needs at least one step with a title.');

  const gap = 0.5;
  const width = (box.w - gap * (items.length - 1)) / items.length;
  const top = box.y + 0.4;
  items.forEach((step, index) => {
    const left = box.x + index * (width + gap);
    slide.addShape(deck.ShapeType.roundRect, { x: left, y: top, w: width, h: 3.4, fill: { color: theme.tint }, line: { color: theme.tint }, rectRadius: 0.12 });
    slide.addShape(deck.ShapeType.ellipse, { x: left + 0.2, y: top + 0.2, w: 0.6, h: 0.6, fill: { color: theme.primary }, line: { color: theme.primary } });
    slide.addText(String(index + 1), { x: left + 0.2, y: top + 0.2, w: 0.6, h: 0.6, fontFace: theme.font, bold: true, fontSize: 18, color: theme.onPrimary, align: 'center', valign: 'middle' });
    slide.addText(step.title, { x: left + 0.2, y: top + 0.95, w: width - 0.4, h: 0.8, fontFace: theme.font, bold: true, fontSize: items.length > 4 ? 16 : 20, color: theme.primary, valign: 'top', fit: 'shrink' });
    if (step.text !== '') slide.addText(step.text, { x: left + 0.2, y: top + 1.75, w: width - 0.4, h: 1.5, fontFace: theme.font, fontSize: items.length > 4 ? 12 : 14, color: theme.text, valign: 'top', fit: 'shrink' });
    if (index < items.length - 1) slide.addShape(deck.ShapeType.rightArrow, { x: left + width + 0.06, y: top + 1.5, w: gap - 0.12, h: 0.4, fill: { color: theme.accent }, line: { color: theme.accent } });
  });
}

function addTable(slide, rows, theme, box) {
  const header = (cell) => ({ text: plainText(cell), options: { bold: true, color: theme.onPrimary, fill: { color: theme.primary }, fontFace: theme.font, fontSize: 14, valign: 'middle' } });
  const body = (cell, rowIndex) => ({
    text: plainText(cell),
    options: { fontFace: theme.font, fontSize: 14, color: theme.text, valign: 'middle', align: NUMERIC.test(cell.trim()) ? 'right' : 'left', fill: { color: rowIndex % 2 === 0 ? theme.tint : 'FFFFFF' } },
  });
  slide.addTable(
    rows.map((row, rowIndex) => row.map((cell) => (rowIndex === 0 ? header(cell) : body(cell, rowIndex - 1)))),
    { ...box, border: { type: 'solid', color: theme.line, pt: 0.75 }, margin: [0.06, 0.1, 0.06, 0.1], autoPage: false },
  );
}

/**
 * @param {{ title?: string, subtitle?: string, author?: string, date?: string, theme?: string, slideNumbers?: boolean,
 *   slides?: { title?: string, layout?: string, bullets?: string[], notes?: string, left?: any, right?: any,
 *   stat?: string, caption?: string, quote?: string, attribution?: string, table?: any, chart?: any }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildPptx(content) {
  const slides = list(content?.slides, 'slides', LIMITS.slides);
  const title = clean(content?.title, LIMITS.title);
  if (title === '' && slides.length === 0) throw new OfficeError('A PowerPoint file needs a title or at least one slide.');

  const theme = themeFor(content?.theme, content?.brand);
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Zuri';
  if (title !== '') deck.title = plainText(title);
  defineMasters(deck, theme);

  const body = { x: 0.8, y: 1.7, w: 11.7, h: 5.0 };

  if (title !== '') {
    const byline = [clean(content?.author, 100), clean(content?.date, 50)].filter((part) => part !== '').join('   |   ');
    featureSlide(deck, theme, title, clean(content?.subtitle, LIMITS.title), byline);
  }

  for (const entry of slides) {
    const layout = pickLayout(entry);
    const notes = clean(entry?.notes);
    const heading = clean(entry?.title, LIMITS.title);
    const bullets = list(entry?.bullets, 'bullets', LIMITS.bulletsPerSlide * 3).map((text) => clean(text, 400));
    let made;

    if (layout === 'section' || layout === 'closing') {
      made = [featureSlide(deck, theme, heading || (layout === 'closing' ? 'Thank you' : ''), clean(entry?.subtitle ?? bullets[0] ?? '', LIMITS.title), '')];
    } else if (layout === 'bullets') {
      // A long list carries on to a second slide instead of running off the bottom.
      const { chunks } = fitText(bullets, body.w, body.h);
      made = (chunks.length > 0 ? chunks : [[]]).map((chunk, part) => {
        const slide = deck.addSlide({ masterName: 'ZURI_CONTENT' });
        slideTitle(slide, part === 0 ? heading : `${heading} (continued)`, theme);
        if (chunk.length > 0) addBullets(slide, chunk, theme, body);
        return slide;
      });
    } else {
      const slide = deck.addSlide({ masterName: 'ZURI_CONTENT' });
      slideTitle(slide, heading, theme);
      made = [slide];
      if (layout === 'twocolumn') {
        const side = (source) => (Array.isArray(source) ? { items: source } : { heading: source?.heading, items: list(source?.bullets ?? source?.items, 'bullets', LIMITS.bulletsPerSlide) });
        [side(entry.left), side(entry.right)].forEach((column, index) => {
          const x = index === 0 ? 0.8 : 7.0;
          const top = column.heading ? 2.35 : body.y;
          if (column.heading) slide.addText(plainText(clean(column.heading, 100)), { x, y: body.y, w: 5.5, h: 0.55, fontFace: theme.font, bold: true, fontSize: 20, color: theme.primary });
          addBullets(slide, column.items.map((text) => clean(text, 300)), theme, { x, y: top, w: 5.5, h: body.h - (top - body.y) });
        });
      } else if (layout === 'bignumber') {
        slide.addText(plainText(clean(entry?.stat, 40)), { x: 0.8, y: 1.9, w: 11.7, h: 2.2, fontFace: theme.font, bold: true, fontSize: 96, color: theme.primary, align: 'center', valign: 'middle', fit: 'shrink' });
        slide.addText(plainText(clean(entry?.caption, 200)), { x: 1.5, y: 4.1, w: 10.3, h: 0.9, fontFace: theme.font, fontSize: 24, color: theme.muted, align: 'center', valign: 'top' });
        if (bullets.length > 0) addBullets(slide, bullets.slice(0, 4), theme, { x: 2.5, y: 5.1, w: 8.3, h: 1.6 });
      } else if (layout === 'quote') {
        slide.addText(plainText(clean(entry?.quote, 400)), { x: 1.2, y: 1.9, w: 10.9, h: 3.2, fontFace: theme.font, italic: true, fontSize: 30, color: theme.text, valign: 'middle', fit: 'shrink' });
        const who = plainText(clean(entry?.attribution, 100));
        if (who !== '') slide.addText(who, { x: 1.2, y: 5.2, w: 10.9, h: 0.6, fontFace: theme.font, fontSize: 18, color: theme.muted, align: 'right' });
      } else if (layout === 'table') {
        const rows = tableRows(entry?.table);
        if (!rows) throw new OfficeError('A table slide needs table rows.');
        addTable(slide, rows.slice(0, 12), theme, body);
      } else if (layout === 'chart') {
        addChart(deck, slide, entry?.chart, theme, body);
      } else if (layout === 'image') {
        addPicture(deck, slide, entry, bullets, theme, body);
      } else if (layout === 'process') {
        addProcess(deck, slide, entry?.steps, theme, body);
      }
    }

    if (notes !== '') made[0].addNotes(notes);
  }

  return Buffer.from(await deck.write({ outputType: 'nodebuffer' }));
}

// ---------------------------------------------------------------- Review

const MAX_REVIEW_WARNINGS = 8;
/** Functions that fill the cells below them; they show #SPILL! when something is in the way. */
const SPILL_FUNCTIONS = /\b(FILTER|UNIQUE|SORT|SORTBY|SEQUENCE|RANDARRAY|TEXTSPLIT|VSTACK|HSTACK)\s*\(/i;

/**
 * Mistakes in the formulas of one sheet that Excel would only show once the file is open:
 * a sheet that does not exist, brackets that do not close, a [@Column] with no such
 * column, and fixed row numbers on a dashboard where the data starts far below row 1.
 * Each kind is reported once per sheet, so a column of identical mistakes is one line.
 * @returns {string[]}
 */
function formulaProblems(sheet, sheets, onDashboard) {
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  const headers = new Set(columns.map((column) => plainText(typeof column === 'object' && column !== null ? column.header : column).trim().toLowerCase()));
  const sheetNames = new Set(sheets.map((entry) => clean(entry?.name, 31).toLowerCase()));
  const formulas = [];
  for (const column of columns) if (typeof column?.formula === 'string') formulas.push(column.formula);
  for (const row of Array.isArray(sheet?.rows) ? sheet.rows : []) {
    for (const cell of Array.isArray(row) ? row : []) if (typeof cell === 'string' && cell.startsWith('=') && cell.length > 1) formulas.push(cell);
    if (formulas.length > 400) break;
  }

  const found = new Set();
  for (const formula of formulas) {
    // Text in quotes is data, not formula; drop it before looking at brackets and names.
    const code = formula.replace(/"(?:[^"]|"")*"/g, '""');
    if ((code.match(/\(/g) ?? []).length !== (code.match(/\)/g) ?? []).length) found.add('a formula has brackets that do not close.');
    for (const match of code.matchAll(/(?:'([^']+)'|\b([A-Za-z_][\w.]*))!/g)) {
      const target = (match[1] ?? match[2]).toLowerCase();
      if (!sheetNames.has(target)) found.add(`a formula points at a sheet called "${match[1] ?? match[2]}", which is not in the workbook.`);
    }
    for (const match of code.matchAll(/\[@([^\[\]]+)\]/g)) {
      if (!headers.has(match[1].trim().toLowerCase())) found.add(`a formula uses [@${match[1]}], but there is no column with that header.`);
    }
    if (SPILL_FUNCTIONS.test(code)) found.add('a formula uses a spill function (FILTER, UNIQUE, SORT...); keep the cells below it empty or it shows #SPILL!.');
    // Row numbers typed by hand point above the table on a dashboard, where the data starts around row 28.
    if (onDashboard && !formula.includes('{row}') && !formula.includes('[@') && /(?<![A-Za-z!$])\$?[A-Z]{1,2}\$?([1-9])\b(?!\d)/.test(code.replace(/\b[A-Za-z_][\w.]*\(/g, '('))) {
      found.add('a dashboard formula uses a low row number such as B2, but the data starts lower down; use {row} or [@Column].');
    }
  }
  return [...found];
}
const wordCount = (text) => plainText(text).trim().split(/\s+/).filter(Boolean).length;

/**
 * Look over the content a model wrote and name what will read badly, before the
 * person finds out by opening the file. Nothing here blocks a build: the warnings go
 * back to the model in the tool result so it can fix the file with one more call.
 * @param {'docx' | 'xlsx' | 'pptx'} kind
 * @param {any} content
 * @returns {string[]}
 */
export function reviewOfficeContent(kind, content) {
  const warnings = [];
  const note = (text) => {
    if (warnings.length < MAX_REVIEW_WARNINGS) warnings.push(text);
  };

  if (kind === 'docx') {
    const sections = Array.isArray(content?.sections) ? content.sections : [];
    if (sections.length === 0) note('The document has no sections, only a title.');
    sections.forEach((section, index) => {
      const blocks = Array.isArray(section?.blocks) ? section.blocks : sectionBlocks(section);
      const where = `Section ${index + 1}`;
      for (const block of blocks) {
        if (['paragraph', undefined].includes(block?.type) && wordCount(block?.text ?? '') > 180) note(`${where} has a paragraph over 180 words; split it or use a list.`);
        if (block?.type === 'table') {
          const rows = Array.isArray(block.rows?.rows ?? block.rows) ? (block.rows?.rows ?? block.rows) : [];
          if ((rows[0]?.length ?? 0) > 7) note(`${where} has a table with more than 7 columns, which will be cramped on an A4 page.`);
        }
      }
      if (blocks.length > 0 && !blocks.some((block) => block?.type === 'heading')) note(`${where} has no heading.`);
    });
  }

  if (kind === 'xlsx') {
    const sheets = Array.isArray(content?.sheets) ? content.sheets : [];
    if (content?.dashboard === true) {
      const summary = sheets[0];
      const kpis = Array.isArray(summary?.kpis) ? summary.kpis : [];
      const charts = dashboardCharts(summary);
      if (clean(summary?.title, 5) === '') note('The dashboard summary has no title.');
      if (kpis.length < 3 || kpis.length > 6) note('The dashboard needs 3 to 6 KPI cards on its first sheet.');
      if (charts.length === 0) note('The dashboard needs at least one chart on its first sheet.');
      if (sheets.length < 2) note('The dashboard should keep detailed source data on a separate sheet.');
    }
    for (const sheet of sheets) {
      const name = clean(sheet?.name, 31) || 'A sheet';
      const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
      const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
      if (columns.length === 0) note(`${name} has no column headers.`);
      columns.forEach((column, index) => {
        const declared = typeof column === 'object' && column !== null ? column.type : undefined;
        const values = rows.map((row) => row?.[index]).filter((value) => value !== '' && value !== null && value !== undefined);
        const textNumbers = values.filter((value) => typeof value === 'string' && !value.startsWith('=') && NUMERIC.test(value.trim()));
        if (!declared && values.length > 0 && textNumbers.length === values.length) {
          const header = typeof column === 'object' ? column?.header : column;
          note(`${name}: column "${plainText(clean(header, 60))}" holds numbers written as text, so it cannot be summed. Send real numbers and give the column a type.`);
        }
      });
      if (rows.some((row) => Array.isArray(row) && columns.length > 0 && row.length > columns.length)) note(`${name} has rows with more cells than headers.`);
      for (const problem of formulaProblems(sheet, sheets, content?.dashboard === true && sheet === sheets[0])) note(`${name}: ${problem}`);
    }
  }

  if (kind === 'pptx') {
    const slides = Array.isArray(content?.slides) ? content.slides : [];
    if (slides.length > 15) note(`The deck has ${slides.length} slides; most audiences lose focus after about 12.`);
    slides.forEach((slide, index) => {
      const where = `Slide ${index + 1}`;
      const layout = pickLayout(slide);
      const bullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
      if (clean(slide?.title, 5) === '' && layout !== 'closing') note(`${where} has no title.`);
      if (layout === 'bullets' && bullets.length === 0) note(`${where} is a title with nothing under it; add points, a chart or a table.`);
      if (bullets.length > 6) note(`${where} has ${bullets.length} bullets; keep to 6 or fewer.`);
      if (bullets.some((text) => wordCount(String(text ?? '')) > 22)) note(`${where} has a bullet over 22 words; shorten it.`);
    });
    if (slides.length > 0 && !slides.some((slide) => ['chart', 'table', 'bignumber'].includes(pickLayout(slide))) && JSON.stringify(slides).match(/\d+(\.\d+)?%|\$\s?\d|₦\s?\d/)) {
      note('The deck quotes figures but has no chart, table or big-number slide; show the numbers visually.');
    }
  }
  return warnings;
}

const BUILDERS = Object.freeze({ docx: buildDocx, xlsx: buildXlsx, pptx: buildPptx, pdf: buildPdf });

function pdfText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[\\()]/g, (character) => `\\${character}`);
}

function pdfLines(content) {
  const lines = [];
  const add = (value, indent = 0) => {
    const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length === 0) return;
    let line = ' '.repeat(indent);
    for (const word of words) {
      if (line.trim() !== '' && line.length + word.length + 1 > 92) {
        lines.push(line.trimEnd());
        line = ' '.repeat(indent);
      }
      line += `${line.trim() === '' ? '' : ' '}${word}`;
    }
    if (line.trim() !== '') lines.push(line.trimEnd());
  };
  add(content?.title || 'Document');
  if (content?.subtitle) add(content.subtitle);
  for (const section of Array.isArray(content?.sections) ? content.sections : []) {
    if (section?.heading) { lines.push(''); add(section.heading); }
    for (const paragraph of Array.isArray(section?.paragraphs) ? section.paragraphs : []) add(paragraph);
    for (const bullet of Array.isArray(section?.bullets) ? section.bullets : []) add(`- ${typeof bullet === 'object' ? bullet.text : bullet}`, 2);
    for (const numbered of Array.isArray(section?.numbered) ? section.numbered : []) add(`1. ${numbered}`, 2);
    if (section?.quote) add(`"${section.quote}"`, 2);
    if (section?.callout) add(section.callout, 2);
    const rows = section?.table?.rows;
    if (Array.isArray(rows)) for (const row of rows) add(Array.isArray(row) ? row.join(' | ') : row, 2);
  }
  if (Array.isArray(content?.blocks)) {
    for (const block of content.blocks) {
      if (block?.type === 'pageBreak') { lines.push('\f'); continue; }
      if (block?.type === 'heading') add(block.text);
      else if (block?.type === 'bullets') for (const item of block.items ?? []) add(`- ${item}`, 2);
      else if (block?.type === 'table') for (const row of block.rows ?? []) add(Array.isArray(row) ? row.join(' | ') : row, 2);
      else add(block?.text);
    }
  }
  return lines.length > 0 ? lines : ['Document'];
}

function buildPdf(content) {
  const lines = pdfLines(content);
  const pages = [];
  let page = [];
  for (const line of lines) {
    if (line === '\f' || page.length >= 46) { pages.push(page); page = []; }
    if (line !== '\f') page.push(line);
  }
  if (page.length > 0 || pages.length === 0) pages.push(page);

  const objects = [];
  const addObject = (value) => { objects.push(value); return objects.length; };
  const font = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  for (const pageLines of pages) {
    const commands = ['BT', '/F1 12 Tf', '50 742 Td', '16 TL'];
    pageLines.forEach((line, index) => {
      if (index > 0) commands.push('T*');
      commands.push(`(${pdfText(line)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const body = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index].replace('PAGES', `${pagesId} 0 R`);
    offsets.push(Buffer.byteLength(body.join(''), 'binary'));
    body.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(body.join(''), 'binary');
  body.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index < offsets.length; index += 1) body.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  body.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(body.join(''), 'binary');
}

/**
 * @param {'docx' | 'xlsx' | 'pptx' | 'pdf'} kind
 * @param {object} content
 * @returns {Promise<Buffer>}
 */
export function buildOfficeFile(kind, content) {
  const builder = BUILDERS[kind];
  if (!builder) throw new OfficeError(`"${kind}" is not a supported file type. Use docx, xlsx, pptx or pdf.`);
  return builder(content ?? {});
}
