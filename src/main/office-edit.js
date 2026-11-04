/**
 * Edit an existing Word, Excel or PowerPoint file and return the changed copy as a
 * Buffer. The source file is only read, never written; the tool layer decides where
 * the copy is saved. Word and PowerPoint are edited in their XML (text only, so the
 * layout, styles and images survive); Excel goes through exceljs.
 *
 * Word and PowerPoint split a sentence into runs at every formatting change. An
 * edit only touches the runs it overlaps, so bold, italic, links and colour around
 * the changed words stay exactly as they were.
 */
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { OfficeError } from './office.js';

const MAX_EDITS = 100;
const MAX_TEXT = 20_000;
const MAX_FORMAT_CELLS = 5000;

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

/** The text elements of one XML block, as a matcher that can be reused for rebuilding it. */
const textElement = (prefix) => new RegExp(`(<${prefix}:t(?:\\s[^>]*)?>)([\\s\\S]*?)(</${prefix}:t>)`, 'g');
const blockPattern = (prefix, tag) => new RegExp(`<${prefix}:${tag}(?=[ >])[\\s\\S]*?</${prefix}:${tag}>`, 'g');

/** @param {string} block @param {'w' | 'a'} prefix @returns {string[]} */
function segmentsOf(block, prefix) {
  return [...block.matchAll(textElement(prefix))].map((match) => unescapeXml(match[2]));
}

/**
 * Write `segments` back into the text elements of `block`, in order. The caller has
 * already kept the count the same, so each element gets exactly one segment.
 */
function withSegments(block, prefix, segments) {
  let index = 0;
  return block.replace(textElement(prefix), (_whole, open, _inner, close) => {
    const text = segments[index];
    index += 1;
    // Leading or trailing spaces vanish in a text element unless it says to keep them.
    const opener = /xml:space=/.test(open) ? open : open.replace(/>$/, ' xml:space="preserve">');
    return `${opener}${escapeXml(text ?? '')}${close}`;
  });
}

/**
 * Replace every occurrence of `find` in a paragraph's text, editing only the runs the
 * match overlaps. The replacement takes the formatting of the run where the match
 * starts, which is what Word itself does; runs before and after keep their own.
 * @param {string[]} segments Run texts, changed in place.
 * @returns {number} How many occurrences were replaced.
 */
function replaceAcrossRuns(segments, find, replace) {
  const hits = [];
  const whole = segments.join('');
  for (let at = whole.indexOf(find); at !== -1; at = whole.indexOf(find, at + find.length)) hits.push(at);

  // Right to left, so the offsets of the earlier hits are still correct after a later one changes length.
  for (const start of hits.reverse()) {
    const end = start + find.length;
    const offsets = [];
    let running = 0;
    for (const text of segments) {
      offsets.push(running);
      running += text.length;
    }
    const first = segments.findIndex((text, i) => offsets[i] <= start && start < offsets[i] + text.length);
    const last = segments.findIndex((text, i) => offsets[i] < end && end <= offsets[i] + text.length);
    if (first < 0 || last < 0) continue;

    const head = segments[first].slice(0, start - offsets[first]);
    const tail = segments[last].slice(end - offsets[last]);
    for (let index = first; index <= last; index += 1) segments[index] = '';
    segments[first] = head + replace + (first === last ? tail : '');
    if (first !== last) segments[last] = tail;
  }
  return hits.length;
}

/** @param {string} xml @param {'w' | 'a'} prefix @param {{ find: string, replace: string }} edit @returns {{ xml: string, hits: number }} */
function replaceInParagraphs(xml, prefix, edit) {
  let hits = 0;
  const result = xml.replace(blockPattern(prefix, 'p'), (block) => {
    const segments = segmentsOf(block, prefix);
    if (segments.length === 0 || !segments.join('').includes(edit.find)) return block;
    hits += replaceAcrossRuns(segments, edit.find, edit.replace);
    return withSegments(block, prefix, segments);
  });
  return { xml: result, hits };
}

/**
 * Drop what must not be copied into a clone: bookmark ids and row ids would repeat,
 * a section break would split the document again, and a picture would be duplicated.
 */
function cleanedClone(block, prefix) {
  const clone = block
    .replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, '')
    .replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '')
    .replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, '');
  return prefix === 'a' ? clone.replace(/<a:extLst>[\s\S]*?<\/a:extLst>/g, '') : clone;
}

/** Clone with its text replaced: the first text element gets the text, the rest are emptied. */
function cloneWithText(block, prefix, text) {
  const clone = cleanedClone(block, prefix);
  const count = segmentsOf(clone, prefix).length;
  return withSegments(clone, prefix, [text, ...Array(Math.max(count - 1, 0)).fill('')]);
}

/**
 * Add a paragraph after the first paragraph containing `anchor`. The new paragraph is
 * a copy of the anchor's, so it carries the same style, numbering and font.
 * @returns {{ xml: string, done: boolean }}
 */
function insertParagraphAfter(xml, prefix, anchor, text) {
  let done = false;
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const result = xml.replace(blockPattern(prefix, 'p'), (block) => {
    if (done || lines.length === 0 || !segmentsOf(block, prefix).join('').includes(anchor)) return block;
    done = true;
    return block + lines.map((line) => cloneWithText(block, prefix, line)).join('');
  });
  return { xml: result, done };
}

/**
 * Add a table row after the first row containing `anchor`, copying that row so the
 * borders, shading and fonts match. `cells` fill the columns left to right.
 * @returns {{ xml: string, done: boolean }}
 */
function insertRowAfter(xml, prefix, anchor, cells) {
  let done = false;
  const result = xml.replace(blockPattern(prefix, 'tr'), (row) => {
    if (done || !segmentsOf(row, prefix).join('').includes(anchor)) return row;
    done = true;
    let column = 0;
    const clone = cleanedClone(row, prefix).replace(blockPattern(prefix, 'tc'), (cell) => {
      const value = String(cells[column] ?? '');
      column += 1;
      const count = segmentsOf(cell, prefix).length;
      return count === 0 ? cell : withSegments(cell, prefix, [value, ...Array(count - 1).fill('')]);
    });
    return row + clone;
  });
  return { xml: result, done };
}

/** @param {unknown} edits @returns {Array<{ kind: 'replace' | 'paragraph' | 'row', [key: string]: any }>} */
function openXmlEdits(edits) {
  return edits.map((edit, index) => {
    const label = `Edit ${index + 1}`;
    if (typeof edit?.insertAfter === 'string') {
      if (edit.insertAfter === '' || typeof edit.text !== 'string') throw new OfficeError(`${label} needs the paragraph to insert after in \`insertAfter\` and the new words in \`text\`.`);
      return { kind: 'paragraph', anchor: edit.insertAfter.slice(0, MAX_TEXT), text: edit.text.slice(0, MAX_TEXT) };
    }
    if (typeof edit?.tableRowAfter === 'string') {
      if (edit.tableRowAfter === '' || !Array.isArray(edit.cells)) throw new OfficeError(`${label} needs text from the row to copy in \`tableRowAfter\` and the new row's \`cells\`.`);
      return { kind: 'row', anchor: edit.tableRowAfter.slice(0, MAX_TEXT), cells: edit.cells.map((cell) => String(cell ?? '').slice(0, 500)) };
    }
    if (typeof edit?.find !== 'string' || edit.find === '') {
      throw new OfficeError(`${label} needs the exact text to find in \`find\`.`);
    }
    return { kind: 'replace', find: edit.find.slice(0, MAX_TEXT), replace: String(edit.replace ?? '').slice(0, MAX_TEXT) };
  });
}

/**
 * @param {Buffer} source @param {'docx' | 'pptx'} kind
 * @param {any[]} edits
 */
async function editOpenXml(source, kind, edits) {
  const steps = openXmlEdits(edits);

  const zip = await JSZip.loadAsync(source);
  const prefix = kind === 'docx' ? 'w' : 'a';
  const parts = Object.keys(zip.files).filter((name) =>
    kind === 'docx'
      ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
      : /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name),
  );
  if (parts.length === 0) throw new OfficeError('That file does not look like a valid Office document.');

  const counts = steps.map(() => 0);
  for (const name of parts) {
    let xml = await zip.file(name).async('string');
    steps.forEach((step, index) => {
      if (step.kind === 'replace') {
        const outcome = replaceInParagraphs(xml, prefix, step);
        xml = outcome.xml;
        counts[index] += outcome.hits;
        return;
      }
      // An insertion happens once, at the first place that matches, not in every part.
      if (counts[index] > 0) return;
      const outcome = step.kind === 'paragraph' ? insertParagraphAfter(xml, prefix, step.anchor, step.text) : insertRowAfter(xml, prefix, step.anchor, step.cells);
      xml = outcome.xml;
      if (outcome.done) counts[index] = 1;
    });
    zip.file(name, xml);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    applied: counts.reduce((sum, n) => sum + n, 0),
    notFound: steps.map((step, i) => (counts[i] === 0 ? (step.find ?? step.anchor) : null)).filter(Boolean),
  };
}

/** @param {unknown} value */
function cellValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value ?? '').slice(0, 2000);
  return text.startsWith('=') && text.length > 1 ? { formula: text.slice(1) } : text;
}

/** Cell addresses in a range such as "A1:C3", capped so a huge range cannot hang the app. */
function cellsInRange(range) {
  const match = /^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/.exec(String(range ?? '').trim());
  if (!match) throw new OfficeError(`"${range}" is not a cell range such as A1 or A1:C3.`);
  const toNumber = (letters) => [...letters.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  const [c1, c2] = [toNumber(match[1]), toNumber(match[3] ?? match[1])].sort((a, b) => a - b);
  const [r1, r2] = [Number(match[2]), Number(match[4] ?? match[2])].sort((a, b) => a - b);
  if ((c2 - c1 + 1) * (r2 - r1 + 1) > MAX_FORMAT_CELLS) throw new OfficeError(`That range is larger than ${MAX_FORMAT_CELLS} cells.`);
  const cells = [];
  for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) cells.push({ row: r, column: c });
  return cells;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/**
 * Apply a plain formatting description to one cell, keeping what the cell already has.
 * @param {ExcelJS.Cell} cell @param {Record<string, any>} format
 */
function formatCell(cell, format) {
  const font = { ...cell.font };
  if (typeof format.bold === 'boolean') font.bold = format.bold;
  if (typeof format.italic === 'boolean') font.italic = format.italic;
  const ink = HEX.exec(String(format.color ?? ''));
  if (ink) font.color = { argb: `FF${ink[1].toUpperCase()}` };
  cell.font = font;
  const wash = HEX.exec(String(format.fill ?? ''));
  if (wash) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${wash[1].toUpperCase()}` } };
  if (typeof format.numberFormat === 'string') cell.numFmt = format.numberFormat.slice(0, 80);
  const alignment = { ...cell.alignment };
  if (['left', 'center', 'right'].includes(format.align)) alignment.horizontal = format.align;
  if (typeof format.wrap === 'boolean') alignment.wrapText = format.wrap;
  cell.alignment = alignment;
}

/**
 * Excel edits: `{ sheet?, cell, value }` sets one cell, `{ sheet?, appendRow: [...] }`
 * adds a row at the bottom, `{ sheet?, range, format }` styles cells and
 * `{ find, replace }` rewrites matching text cells.
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
    } else if (typeof edit?.range === 'string' && edit.format && typeof edit.format === 'object') {
      const sheet = sheetFor(edit.sheet);
      for (const at of cellsInRange(edit.range)) formatCell(sheet.getCell(at.row, at.column), edit.format);
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
      throw new OfficeError(`Edit ${index + 1} needs {cell, value}, {appendRow}, {range, format} or {find, replace}.`);
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
