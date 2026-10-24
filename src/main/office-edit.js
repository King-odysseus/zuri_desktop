/**
 * Edit an existing Word, Excel or PowerPoint file and return the changed copy as a
 * Buffer. The source file is only read, never written; the tool layer decides where
 * the copy is saved. Word and PowerPoint are edited in their XML (text only, so the
 * layout, styles and images survive); Excel goes through exceljs.
 */
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { OfficeError } from './office.js';

const MAX_EDITS = 100;
const MAX_TEXT = 20_000;

/** @param {string} text @returns {string} */
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {string} text @returns {string} */
const unescapeXml = (text) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** @param {unknown} edits @returns {any[]} */
function checkedEdits(edits) {
  if (!Array.isArray(edits) || edits.length === 0) throw new OfficeError('Give at least one edit to make.');
  if (edits.length > MAX_EDITS) throw new OfficeError(`Too many edits at once (${edits.length}); the limit is ${MAX_EDITS}.`);
  return edits;
}

/**
 * Replace text inside the paragraphs of one XML part. A paragraph's runs are joined
 * first, because Word and PowerPoint split a sentence into runs at every formatting
 * change; the replacement lands in the first run and the rest are emptied, so the
 * paragraph keeps its style but mixed formatting inside it is lost.
 * @param {string} xml @param {'w' | 'a'} prefix @param {{ find: string, replace: string }[]} replacements
 * @param {number[]} counts One counter per replacement, incremented in place.
 * @returns {string}
 */
function replaceInParagraphs(xml, prefix, replacements, counts) {
  const paragraph = new RegExp(`<${prefix}:p(?=[ >])[\\s\\S]*?</${prefix}:p>`, 'g');
  const run = new RegExp(`(<${prefix}:t(?:\\s[^>]*)?>)([\\s\\S]*?)(</${prefix}:t>)`, 'g');

  return xml.replace(paragraph, (block) => {
    const runs = [...block.matchAll(run)];
    if (runs.length === 0) return block;
    let text = runs.map((match) => unescapeXml(match[2])).join('');
    let changed = false;
    replacements.forEach((edit, index) => {
      if (!text.includes(edit.find)) return;
      counts[index] += text.split(edit.find).length - 1;
      text = text.split(edit.find).join(edit.replace);
      changed = true;
    });
    if (!changed) return block;

    let first = true;
    return block.replace(run, (_whole, open, _inner, close) => {
      const value = first ? escapeXml(text) : '';
      const opener = first && !/xml:space=/.test(open) ? open.replace(/>$/, ' xml:space="preserve">') : open;
      first = false;
      return `${opener}${value}${close}`;
    });
  });
}

/**
 * @param {Buffer} source @param {'docx' | 'pptx'} kind
 * @param {{ find?: string, replace?: string }[]} edits
 */
async function editOpenXml(source, kind, edits) {
  const replacements = edits.map((edit, index) => {
    if (typeof edit?.find !== 'string' || edit.find === '') {
      throw new OfficeError(`Edit ${index + 1} needs the exact text to find in \`find\`.`);
    }
    return { find: edit.find.slice(0, MAX_TEXT), replace: String(edit.replace ?? '').slice(0, MAX_TEXT) };
  });

  const zip = await JSZip.loadAsync(source);
  const prefix = kind === 'docx' ? 'w' : 'a';
  const parts = Object.keys(zip.files).filter((name) =>
    kind === 'docx'
      ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
      : /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name),
  );
  if (parts.length === 0) throw new OfficeError('That file does not look like a valid Office document.');

  const counts = replacements.map(() => 0);
  for (const name of parts) {
    const xml = await zip.file(name).async('string');
    zip.file(name, replaceInParagraphs(xml, prefix, replacements, counts));
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, applied: counts.reduce((sum, n) => sum + n, 0), notFound: replacements.filter((_, i) => counts[i] === 0).map((r) => r.find) };
}

/** @param {unknown} value */
function cellValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value ?? '').slice(0, 2000);
  return text.startsWith('=') && text.length > 1 ? { formula: text.slice(1) } : text;
}

/**
 * Excel edits: `{ sheet?, cell, value }` sets one cell, `{ sheet?, appendRow: [...] }`
 * adds a row at the bottom, and `{ find, replace }` rewrites matching text cells.
 * @param {Buffer} source @param {any[]} edits
 */
async function editWorkbook(source, edits) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source);
  const sheetFor = (name) => {
    const found = name ? workbook.getWorksheet(String(name)) : workbook.worksheets[0];
    if (!found) throw new OfficeError(`There is no sheet called "${name}".`);
    return found;
  };

  let applied = 0;
  const notFound = [];
  for (const [index, edit] of edits.entries()) {
    if (typeof edit?.cell === 'string' && 'value' in edit) {
      sheetFor(edit.sheet).getCell(edit.cell).value = cellValue(edit.value);
      applied += 1;
    } else if (Array.isArray(edit?.appendRow)) {
      sheetFor(edit.sheet).addRow(edit.appendRow.map(cellValue));
      applied += 1;
    } else if (typeof edit?.find === 'string' && edit.find !== '') {
      let hits = 0;
      const replacement = String(edit.replace ?? '');
      for (const sheet of edit.sheet ? [sheetFor(edit.sheet)] : workbook.worksheets) {
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (typeof cell.value === 'string' && cell.value.includes(edit.find)) {
              cell.value = cell.value.split(edit.find).join(replacement);
              hits += 1;
            }
          }),
        );
      }
      applied += hits;
      if (hits === 0) notFound.push(edit.find);
    } else {
      throw new OfficeError(`Edit ${index + 1} needs {cell, value}, {appendRow} or {find, replace}.`);
    }
  }
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), applied, notFound };
}

/**
 * @param {'docx' | 'xlsx' | 'pptx'} kind
 * @param {Buffer} source The original file's bytes.
 * @param {unknown} edits
 * @returns {Promise<{ buffer: Buffer, applied: number, notFound: string[] }>}
 */
export async function editOfficeFile(kind, source, edits) {
  const list = checkedEdits(edits);
  try {
    return kind === 'xlsx' ? await editWorkbook(source, list) : await editOpenXml(source, kind, list);
  } catch (error) {
    if (error instanceof OfficeError) throw error;
    // A corrupt or password-protected file fails inside the zip or xml readers.
    throw new OfficeError(`The file could not be opened for editing (${error?.message ?? 'unreadable'}).`);
  }
}

/**
 * Text of a workbook with cell addresses, so the model can name the cell to change.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function describeWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const lines = [];
  for (const sheet of workbook.worksheets) {
    lines.push(`Sheet "${sheet.name}"`);
    sheet.eachRow((row, rowNumber) => {
      const cells = [];
      row.eachCell((cell, columnNumber) => {
        const raw = cell.value;
        const shown = raw && typeof raw === 'object' ? (raw.formula ? `=${raw.formula}` : raw.text ?? raw.result ?? '') : raw;
        cells.push(`${cell.address}=${String(shown ?? '')}`);
        return columnNumber;
      });
      if (cells.length > 0) lines.push(`Row ${rowNumber}: ${cells.join(' | ')}`);
    });
  }
  return lines.join('\n');
}
