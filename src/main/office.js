/**
 * Builders for Word, Excel and PowerPoint files. Each takes plain structured content
 * (what a model can emit as JSON) and returns the finished file as a Buffer. Nothing
 * here touches the file system, so the tool layer owns where the bytes are saved.
 */
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';

// pptxgenjs's ES entry imports jszip in a way plain Node rejects; its CommonJS entry loads everywhere.
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs');

export const OFFICE_KINDS = Object.freeze(['docx', 'xlsx', 'pptx']);

/** Hard caps so a runaway model reply cannot build a huge file or hang the app. */
const LIMITS = Object.freeze({
  sections: 60,
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

/**
 * @param {{ title?: string, sections?: { heading?: string, paragraphs?: string[], bullets?: string[], table?: any }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildDocx(content) {
  const sections = list(content?.sections, 'sections', LIMITS.sections);
  const title = clean(content?.title, LIMITS.title);
  if (title === '' && sections.length === 0) throw new OfficeError('A Word document needs a title or at least one section.');

  const children = [];
  if (title !== '') children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));

  for (const section of sections) {
    const heading = clean(section?.heading, LIMITS.title);
    if (heading !== '') children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }));
    for (const text of list(section?.paragraphs, 'paragraphs', LIMITS.paragraphsPerSection)) {
      children.push(new Paragraph({ children: [new TextRun(clean(text))], spacing: { after: 120 } }));
    }
    for (const text of list(section?.bullets, 'bullets', LIMITS.paragraphsPerSection)) {
      children.push(new Paragraph({ text: clean(text), bullet: { level: 0 } }));
    }
    const grid = tableRows(section?.table);
    if (grid) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: grid.map(
            (row, rowIndex) =>
              new TableRow({
                tableHeader: rowIndex === 0,
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: cell, bold: rowIndex === 0 })] })],
                    }),
                ),
              }),
          ),
        }),
        new Paragraph({ text: '' }),
      );
    }
  }

  const document = new Document({ title: title || undefined, creator: 'Zuri', sections: [{ children }] });
  return Packer.toBuffer(document);
}

/** Excel sheet names: at most 31 characters and none of : \ / ? * [ ]. */
function sheetName(raw, index, used) {
  const base = clean(raw, 31).replace(/[:\\/?*[\]]/g, ' ').trim() || `Sheet${index + 1}`;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 28)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * A string starting with "=" becomes a formula; numbers stay numbers so sums work.
 * @param {unknown} cell
 */
function excelValue(cell) {
  if (typeof cell === 'number' || typeof cell === 'boolean') return cell;
  const text = clean(cell, 2000);
  if (text.startsWith('=') && text.length > 1) return { formula: text.slice(1) };
  return text;
}

/**
 * @param {{ sheets?: { name?: string, columns?: string[], rows?: any[][] }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildXlsx(content) {
  const sheets = list(content?.sheets, 'sheets', LIMITS.sheets);
  if (sheets.length === 0) throw new OfficeError('An Excel file needs at least one sheet.');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zuri';
  const used = new Set();

  for (const [index, sheet] of sheets.entries()) {
    const worksheet = workbook.addWorksheet(sheetName(sheet?.name, index, used));
    const columns = list(sheet?.columns, 'columns', LIMITS.tableColumns).map((column) => clean(column, 200));
    if (columns.length > 0) {
      const header = worksheet.addRow(columns);
      header.font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    }
    for (const row of list(sheet?.rows, 'rows', LIMITS.sheetRows)) {
      worksheet.addRow(list(row, 'A row', LIMITS.tableColumns).map(excelValue));
    }
    worksheet.columns.forEach((column) => {
      let widest = 10;
      column.eachCell({ includeEmpty: false }, (cell) => {
        const length = typeof cell.value === 'object' ? 12 : String(cell.value ?? '').length;
        widest = Math.max(widest, Math.min(length + 2, 60));
      });
      column.width = widest;
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * @param {{ title?: string, subtitle?: string, slides?: { title?: string, bullets?: string[], notes?: string }[] }} content
 * @returns {Promise<Buffer>}
 */
export async function buildPptx(content) {
  const slides = list(content?.slides, 'slides', LIMITS.slides);
  const title = clean(content?.title, LIMITS.title);
  if (title === '' && slides.length === 0) throw new OfficeError('A PowerPoint file needs a title or at least one slide.');

  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Zuri';
  if (title !== '') deck.title = title;

  if (title !== '') {
    const cover = deck.addSlide();
    cover.addText(title, { x: 0.7, y: 2.2, w: 11.9, h: 1.4, fontSize: 40, bold: true, color: '1F2A44' });
    const subtitle = clean(content?.subtitle, LIMITS.title);
    if (subtitle !== '') cover.addText(subtitle, { x: 0.7, y: 3.7, w: 11.9, h: 0.8, fontSize: 20, color: '555555' });
  }

  for (const entry of slides) {
    const slide = deck.addSlide();
    slide.addText(clean(entry?.title, LIMITS.title), { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 30, bold: true, color: '1F2A44' });
    const bullets = list(entry?.bullets, 'bullets', LIMITS.bulletsPerSlide).map((text) => clean(text, 400));
    if (bullets.length > 0) {
      slide.addText(
        bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.6, w: 11.7, h: 5.2, fontSize: 22, valign: 'top', paraSpaceAfter: 10 },
      );
    }
    const notes = clean(entry?.notes);
    if (notes !== '') slide.addNotes(notes);
  }

  return Buffer.from(await deck.write({ outputType: 'nodebuffer' }));
}

const BUILDERS = Object.freeze({ docx: buildDocx, xlsx: buildXlsx, pptx: buildPptx });

/**
 * @param {'docx' | 'xlsx' | 'pptx'} kind
 * @param {object} content
 * @returns {Promise<Buffer>}
 */
export function buildOfficeFile(kind, content) {
  const builder = BUILDERS[kind];
  if (!builder) throw new OfficeError(`"${kind}" is not a supported file type. Use docx, xlsx or pptx.`);
  return builder(content ?? {});
}
