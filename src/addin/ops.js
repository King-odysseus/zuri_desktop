/*
 * Zuri change blocks: the contract between the model and the Office pane.
 *
 * The model cannot touch the file. It writes prose and, when the person asked for
 * a change, one fenced JSON block listing operations. This file turns that text
 * into segments the pane can draw and validates every operation before anything
 * reaches the document, so a malformed reply shows a readable complaint instead of
 * half-applying an edit.
 *
 * Plain script with a CommonJS tail: Office's web view loads it with a <script>
 * tag, and the selftest loads the same file through node:vm to check it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ZuriOps = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Fence tags the pane treats as a change block. */
  var OPS_LANGS = ['zuri', 'zuri-ops', 'zuriops', 'ops'];

  var MAX_OPERATIONS = 40;
  var MAX_ROWS = 400;
  var MAX_COLUMNS = 60;
  var MAX_TEXT = 20000;

  var CELL_RANGE = /^[A-Z]{1,3}[0-9]{1,7}(:[A-Z]{1,3}[0-9]{1,7})?$/;
  var COLOUR = /^#[0-9a-fA-F]{6}$/;
  var TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
  var SHEET_NAME = /^[^\[\]:*?/\\]{1,31}$/;
  var ALIGNMENTS = ['left', 'center', 'right', 'general'];
  var CHART_TYPES = ['column', 'bar', 'line', 'pie', 'area', 'scatter'];
  var TABLE_STYLE = /^TableStyle(Light|Medium|Dark)[0-9]{1,2}$/;
  var CONDITIONAL_RULES = ['colorScale', 'dataBar', 'greaterThan', 'lessThan', 'equal', 'between', 'negative'];

  /** Every operation the pane can carry out, and the host it belongs to. */
  var OPERATIONS = {
    setValues: 'excel',
    setFormulas: 'excel',
    setNumberFormat: 'excel',
    format: 'excel',
    columnWidth: 'excel',
    autofit: 'excel',
    addWorksheet: 'excel',
    clear: 'excel',
    createTable: 'excel',
    addChart: 'excel',
    fillFormula: 'excel',
    borders: 'excel',
    freezePanes: 'excel',
    merge: 'excel',
    rowHeight: 'excel',
    conditionalFormat: 'excel',
    dataValidation: 'excel',
    sort: 'excel',
    namedRange: 'excel',
    replaceSelection: 'word',
    insertAfterSelection: 'word',
    insertParagraphs: 'word',
    applyStyle: 'word',
    replaceAll: 'word',
    insertTable: 'word',
    insertFormatted: 'word',
    setSelectedText: 'powerpoint',
    addSlide: 'powerpoint',
    setSlideTitle: 'powerpoint',
    setShapeText: 'powerpoint',
    addTextBox: 'powerpoint',
    addTable: 'powerpoint',
    styleShape: 'powerpoint',
  };

  function isOpsLang(lang) {
    return OPS_LANGS.indexOf(String(lang || '').toLowerCase()) !== -1;
  }

  /**
   * Split a reply into prose, change blocks and ordinary code blocks.
   *
   * A block that is still being streamed has no closing fence. Returning it as
   * `ops-open` lets the pane show "preparing a change" instead of dumping raw JSON
   * into the conversation while the model is still typing it.
   *
   * @param {string} text
   * @returns {Array<object>} segments: { type: 'text'|'code'|'ops'|'ops-open', ... }
   */
  function splitReply(text) {
    var lines = String(typeof text === 'string' ? text : '').split('\n');
    var segments = [];
    var prose = [];
    var fence = null;

    function flushProse() {
      if (prose.length === 0) return;
      segments.push({ type: 'text', text: prose.join('\n') });
      prose = [];
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var opening = /^[\s]*```[\s]*([A-Za-z0-9_-]*)[\s]*$/.exec(line);

      if (fence === null) {
        if (opening) {
          flushProse();
          fence = { lang: opening[1].toLowerCase(), lines: [] };
          continue;
        }
        prose.push(line);
        continue;
      }

      if (/^[\s]*```[\s]*$/.test(line)) {
        var raw = fence.lines.join('\n');
        // An untagged or json fence is only a change block when it reads like one,
        // so a sample JSON object in an answer is left as code.
        var candidate = isOpsLang(fence.lang) ? raw : (fence.lang === '' || fence.lang === 'json') && looksLikeOps(raw) ? raw : null;
        if (candidate === null) {
          segments.push({ type: 'code', lang: fence.lang, text: raw });
        } else {
          segments.push({ type: 'ops', raw: raw, result: parseBlock(candidate) });
        }
        fence = null;
        continue;
      }

      fence.lines.push(line);
    }

    if (fence !== null) {
      if (isOpsLang(fence.lang)) {
        flushProse();
        segments.push({ type: 'ops-open', raw: fence.lines.join('\n') });
      } else {
        prose.push('```' + fence.lang);
        prose = prose.concat(fence.lines);
      }
    }
    flushProse();
    return segments;
  }

  /** @param {string} raw @returns {boolean} */
  function looksLikeOps(raw) {
    var data = readJson(raw);
    return data !== null && typeof data === 'object' && Array.isArray(data.operations);
  }

  /**
   * Parse JSON the model wrote, forgiving the two mistakes it makes most: a trailing
   * comma and a curly quote used as a string delimiter.
   * @param {string} raw
   * @returns {any|null}
   */
  function readJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      var repaired = String(raw)
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/,\s*([\}\]])/g, '$1');
      try {
        return JSON.parse(repaired);
      } catch (second) {
        return null;
      }
    }
  }

  /**
   * Turn one change block into a reviewable plan.
   * @param {string} raw
   * @returns {{ ok: true, summary: string, operations: Array<object> } | { ok: false, error: string }}
   */
  function parseBlock(raw) {
    var data = readJson(raw);
    if (data === null) return { ok: false, error: 'The change block is not valid JSON, so nothing was changed.' };

    var operations = Array.isArray(data) ? data : Array.isArray(data.operations) ? data.operations : null;
    if (operations === null) return { ok: false, error: 'The change block has no operations in it.' };
    if (operations.length === 0) return { ok: false, error: 'The change block lists no operations.' };
    if (operations.length > MAX_OPERATIONS) {
      return { ok: false, error: 'That change is too large to review: ' + operations.length + ' operations, and the limit is ' + MAX_OPERATIONS + '.' };
    }

    var summary = Array.isArray(data) ? '' : typeof data.summary === 'string' ? data.summary.trim().slice(0, 200) : '';
    var checked = [];
    for (var index = 0; index < operations.length; index += 1) {
      var outcome = validateOperation(operations[index]);
      if (!outcome.ok) return { ok: false, error: 'Operation ' + (index + 1) + ': ' + outcome.error };
      checked.push(outcome.operation);
    }
    return { ok: true, summary: summary, operations: checked };
  }

  function fail(message) {
    return { ok: false, error: message };
  }

  function text(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength || MAX_TEXT) : '';
  }

  /**
   * Check one operation and return it normalised, with the range written in one
   * style so the appliers and the preview never disagree about what it says.
   * @param {any} raw
   */
  function validateOperation(raw) {
    if (raw === null || typeof raw !== 'object') return fail('it is not an object.');
    var name = typeof raw.op === 'string' ? raw.op.trim() : '';
    if (!Object.prototype.hasOwnProperty.call(OPERATIONS, name)) return fail('"' + name + '" is not something Zuri can do.');

    var host = OPERATIONS[name];

    if (host === 'excel') {
      var needsRange = name !== 'addWorksheet' && name !== 'freezePanes';
      var range = needsRange ? normaliseRange(raw.range) : null;
      if (needsRange && range === null) return fail('"' + name + '" needs a cell range such as "D3:D26".');
      var sheet = raw.sheet === undefined || raw.sheet === null ? '' : text(raw.sheet, 31);
      if (sheet !== '' && !SHEET_NAME.test(sheet)) return fail('"' + sheet + '" is not a sheet name.');

      if (name === 'setValues' || name === 'setFormulas') {
        var grid = normaliseGrid(raw.values || raw.formulas, name === 'setFormulas' ? 'formula' : 'value');
        if (grid === null) {
          return fail(name === 'setFormulas'
            ? '"setFormulas" needs a rectangular grid of formulas starting with "=".'
            : '"setValues" needs a rectangular grid of values.');
        }
        var expectedRows = range.end.row - range.start.row + 1;
        var expectedColumns = range.end.column - range.start.column + 1;
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, grid: grid, rangeRows: expectedRows, rangeColumns: expectedColumns } };
      }

      if (name === 'setNumberFormat') {
        var format = text(raw.format, 60).trim();
        if (format === '') return fail('"setNumberFormat" needs a format code such as "0.0%".');
        return {
          ok: true,
          operation: {
            op: name,
            sheet: sheet,
            range: range.text,
            format: format,
            rangeRows: range.end.row - range.start.row + 1,
            rangeColumns: range.end.column - range.start.column + 1,
          },
        };
      }

      if (name === 'format') {
        var look = { op: name, sheet: sheet, range: range.text };
        var touched = false;
        for (var key of ['bold', 'italic', 'wrapText']) {
          if (raw[key] !== undefined) {
            look[key] = raw[key] === true;
            touched = true;
          }
        }
        if (raw.fill !== undefined) {
          if (typeof raw.fill !== 'string' || !COLOUR.test(raw.fill)) return fail('"fill" must be a colour like "#F2F4F8".');
          look.fill = raw.fill.toUpperCase();
          touched = true;
        }
        if (raw.color !== undefined) {
          if (typeof raw.color !== 'string' || !COLOUR.test(raw.color)) return fail('"color" must be a colour like "#1F2A44".');
          look.color = raw.color.toUpperCase();
          touched = true;
        }
        if (raw.size !== undefined) {
          var size = Number(raw.size);
          if (!Number.isFinite(size) || size < 6 || size > 96) return fail('"size" must be a font size between 6 and 96.');
          look.size = size;
          touched = true;
        }
        if (raw.align !== undefined) {
          var align = text(raw.align, 10).toLowerCase();
          if (ALIGNMENTS.indexOf(align) === -1) return fail('"align" must be left, center, right or general.');
          look.align = align;
          touched = true;
        }
        if (!touched) return fail('"format" lists nothing to change.');
        return { ok: true, operation: look };
      }

      if (name === 'columnWidth') {
        var width = Number(raw.width);
        if (!Number.isFinite(width) || width < 0 || width > 255) return fail('"width" must be between 0 and 255.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, width: width } };
      }

      if (name === 'addWorksheet') {
        var newName = text(raw.name, 31).trim();
        if (!SHEET_NAME.test(newName)) return fail('"addWorksheet" needs a sheet name of 1 to 31 characters without []:*?/\\');
        return { ok: true, operation: { op: name, name: newName, activate: raw.activate === true } };
      }

      if (name === 'createTable') {
        var tableName = raw.name === undefined ? '' : text(raw.name, 255).trim();
        if (tableName !== '' && !TABLE_NAME.test(tableName)) return fail('"' + tableName + '" is not a valid table name.');
        var tableStyle = raw.style === undefined ? '' : text(raw.style, 40).trim();
        if (tableStyle !== '' && !TABLE_STYLE.test(tableStyle)) return fail('"style" must be a built-in table style such as "TableStyleMedium2".');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, name: tableName, hasHeaders: raw.hasHeaders !== false, style: tableStyle } };
      }

      if (name === 'fillFormula') {
        var formula = text(raw.formula, 2000).trim();
        if (formula.charAt(0) !== '=' || formula.length < 2) return fail('"fillFormula" needs one formula starting with "=", written for the first cell of the range.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, formula: formula } };
      }

      if (name === 'borders') {
        var borderStyle = text(raw.style, 10).trim().toLowerCase() || 'thin';
        if (['thin', 'medium', 'none'].indexOf(borderStyle) === -1) return fail('"style" must be thin, medium or none.');
        var borderColour = raw.color === undefined ? '#BFC5D2' : raw.color;
        if (typeof borderColour !== 'string' || !COLOUR.test(borderColour)) return fail('"color" must be a colour like "#BFC5D2".');
        return {
          ok: true,
          operation: {
            op: name, sheet: sheet, range: range.text, style: borderStyle, color: borderColour.toUpperCase(),
            rangeRows: range.end.row - range.start.row + 1, rangeColumns: range.end.column - range.start.column + 1,
          },
        };
      }

      if (name === 'freezePanes') {
        var frozenRows = raw.rows === undefined ? 0 : Number(raw.rows);
        var frozenColumns = raw.columns === undefined ? 0 : Number(raw.columns);
        if (!Number.isInteger(frozenRows) || frozenRows < 0 || frozenRows > 100) return fail('"rows" must be a whole number from 0 to 100.');
        if (!Number.isInteger(frozenColumns) || frozenColumns < 0 || frozenColumns > 50) return fail('"columns" must be a whole number from 0 to 50.');
        return { ok: true, operation: { op: name, sheet: sheet, rows: frozenRows, columns: frozenColumns } };
      }

      if (name === 'merge') {
        if (range.text.indexOf(':') === -1) return fail('"merge" needs a range of more than one cell.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, across: raw.across === true } };
      }

      if (name === 'rowHeight') {
        var height = Number(raw.height);
        if (!Number.isFinite(height) || height < 0 || height > 409) return fail('"height" must be between 0 and 409 points.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, height: height } };
      }

      if (name === 'conditionalFormat') {
        var rule = text(raw.rule, 20).trim();
        if (CONDITIONAL_RULES.indexOf(rule) === -1) return fail('"rule" must be one of ' + CONDITIONAL_RULES.join(', ') + '.');
        var ruleColour = raw.color === undefined ? '#4F86C6' : raw.color;
        if (typeof ruleColour !== 'string' || !COLOUR.test(ruleColour)) return fail('"color" must be a colour like "#4F86C6".');
        var ruleValue = raw.value === undefined ? null : Number(raw.value);
        var ruleValueTwo = raw.value2 === undefined ? null : Number(raw.value2);
        var needsValue = ['greaterThan', 'lessThan', 'equal', 'between'].indexOf(rule) !== -1;
        if (needsValue && (ruleValue === null || !Number.isFinite(ruleValue))) return fail('"' + rule + '" needs a number in "value".');
        if (rule === 'between' && (ruleValueTwo === null || !Number.isFinite(ruleValueTwo))) return fail('"between" needs numbers in "value" and "value2".');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, rule: rule, value: ruleValue, value2: ruleValueTwo, color: ruleColour.toUpperCase() } };
      }

      if (name === 'dataValidation') {
        var options = Array.isArray(raw.list) ? raw.list : [];
        var cleanOptions = [];
        for (var o = 0; o < options.length; o += 1) {
          if (typeof options[o] !== 'string' && typeof options[o] !== 'number') return fail('"list" must hold text or numbers.');
          var option = String(options[o]).replace(/,/g, ' ').trim();
          if (option !== '') cleanOptions.push(option);
        }
        // Excel refuses an inline list longer than 255 characters.
        if (cleanOptions.length === 0 || cleanOptions.length > 50 || cleanOptions.join(',').length > 255) return fail('"list" needs 1 to 50 short options, 255 characters in all.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, list: cleanOptions } };
      }

      if (name === 'sort') {
        var sortWidth = range.end.column - range.start.column + 1;
        var sortColumn = raw.column === undefined ? 1 : Number(raw.column);
        if (!Number.isInteger(sortColumn) || sortColumn < 1 || sortColumn > sortWidth) return fail('"column" must count from 1 within the range, up to ' + sortWidth + '.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, column: sortColumn, ascending: raw.ascending !== false, hasHeaders: raw.hasHeaders !== false } };
      }

      if (name === 'namedRange') {
        var rangeName = text(raw.name, 80).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_.]{0,79}$/.test(rangeName) || /^[A-Za-z]{1,3}[0-9]{1,7}$/.test(rangeName)) return fail('"' + rangeName + '" is not a valid name; use letters, digits and underscores, and not a cell address.');
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, name: rangeName } };
      }

      if (name === 'addChart') {
        var chartType = text(raw.chartType, 20).trim().toLowerCase() || 'column';
        if (CHART_TYPES.indexOf(chartType) === -1) return fail('"chartType" must be one of ' + CHART_TYPES.join(', ') + '.');
        var chartTitle = text(raw.title, 200).trim();
        var anchor = '';
        if (raw.at !== undefined && raw.at !== null && raw.at !== '') {
          var at = normaliseRange(raw.at);
          if (at === null || at.text.indexOf(':') !== -1) return fail('"at" must be one cell such as "H2", where the chart goes.');
          anchor = at.text;
        }
        // Two columns clear of the data, so the default never draws over the numbers.
        if (anchor === '') anchor = columnName(Math.min(range.end.column + 2, 16384)) + range.start.row;
        return { ok: true, operation: { op: name, sheet: sheet, range: range.text, chartType: chartType, title: chartTitle, at: anchor } };
      }

      // autofit and clear
      return { ok: true, operation: { op: name, sheet: sheet, range: range.text } };
    }

    if (host === 'word') {
      if (name === 'replaceSelection' || name === 'insertAfterSelection') {
        var body = text(raw.text);
        if (body.trim() === '') return fail('"' + name + '" needs text to write.');
        return { ok: true, operation: { op: name, text: body } };
      }

      if (name === 'insertParagraphs') {
        var paragraphs = Array.isArray(raw.paragraphs) ? raw.paragraphs : [];
        if (paragraphs.length === 0 || paragraphs.length > 50) return fail('"insertParagraphs" needs 1 to 50 paragraphs.');
        var cleaned = [];
        for (var p = 0; p < paragraphs.length; p += 1) {
          var entry = paragraphs[p];
          if (typeof entry === 'string') {
            cleaned.push({ text: entry.slice(0, MAX_TEXT), style: '' });
            continue;
          }
          if (entry === null || typeof entry !== 'object') return fail('paragraph ' + (p + 1) + ' is not text.');
          cleaned.push({ text: text(entry.text), style: text(entry.style, 80).trim() });
        }
        if (cleaned.every(function (entry) { return entry.text.trim() === ''; })) return fail('"insertParagraphs" has no text in it.');
        var where = text(raw.where, 20).trim() || 'end';
        if (['start', 'end', 'afterSelection', 'replaceSelection'].indexOf(where) === -1) {
          return fail('"where" must be start, end, afterSelection or replaceSelection.');
        }
        return { ok: true, operation: { op: name, where: where, paragraphs: cleaned } };
      }

      if (name === 'applyStyle') {
        var style = text(raw.style, 80).trim();
        if (style === '') return fail('"applyStyle" needs a style name such as "Heading 2".');
        return { ok: true, operation: { op: name, style: style } };
      }

      if (name === 'replaceAll') {
        var find = text(raw.find, 200);
        if (find === '') return fail('"replaceAll" needs the text to find.');
        return { ok: true, operation: { op: name, find: find, replace: text(raw.replace, 200), matchCase: raw.matchCase === true } };
      }

      if (name === 'insertFormatted') {
        var markdown = text(raw.markdown);
        if (markdown.trim() === '') return fail('"insertFormatted" needs markdown to write.');
        var formattedWhere = text(raw.where, 20).trim() || 'end';
        if (['start', 'end', 'afterSelection', 'replaceSelection'].indexOf(formattedWhere) === -1) {
          return fail('"where" must be start, end, afterSelection or replaceSelection.');
        }
        return { ok: true, operation: { op: name, where: formattedWhere, markdown: markdown } };
      }

      // insertTable
      var rows = normaliseGrid(raw.rows, 'value');
      if (rows === null || rows.length > 50 || rows[0].length > 12) return fail('"insertTable" needs up to 50 rows of up to 12 cells.');
      var tableWhere = text(raw.where, 20).trim() || 'end';
      if (['start', 'end', 'afterSelection'].indexOf(tableWhere) === -1) return fail('"where" must be start, end or afterSelection.');
      return { ok: true, operation: { op: name, where: tableWhere, grid: rows.map(function (row) { return row.map(function (cell) { return String(cell); }); }) } };
    }

    // PowerPoint
    if (name === 'setSelectedText') {
      var selected = text(raw.text);
      if (selected.trim() === '') return fail('"setSelectedText" needs text to write.');
      return { ok: true, operation: { op: name, text: selected } };
    }

    if (name === 'addSlide') {
      var title = text(raw.title, 300);
      var slideBody = text(raw.body, 4000);
      if (title.trim() === '' && slideBody.trim() === '') return fail('"addSlide" needs a title or body text.');
      return { ok: true, operation: { op: name, title: title, body: slideBody, bullets: raw.bullets === true } };
    }

    var slide = raw.slide === undefined || raw.slide === null ? 0 : Number(raw.slide);
    if (!Number.isInteger(slide) || slide < 0 || slide > 999) return fail('"slide" must be a slide number, counting from 1.');

    if (name === 'setSlideTitle') {
      var newTitle = text(raw.title, 300);
      if (newTitle.trim() === '') return fail('"setSlideTitle" needs a title.');
      return { ok: true, operation: { op: name, slide: slide, title: newTitle } };
    }

    if (name === 'setShapeText') {
      var shapeName = text(raw.shape, 120).trim();
      var shapeText = text(raw.text, 4000);
      if (shapeName === '' && shapeText.trim() === '') return fail('"setShapeText" needs the shape name and the text.');
      if (shapeText.trim() === '') return fail('"setShapeText" needs the text to put in the shape.');
      return { ok: true, operation: { op: name, slide: slide, shape: shapeName, text: shapeText } };
    }

    if (name === 'addTable') {
      var tableGrid = normaliseGrid(raw.rows, 'value');
      if (tableGrid === null || tableGrid.length > 20 || tableGrid[0].length > 8) return fail('"addTable" needs up to 20 rows of up to 8 cells.');
      var table = { op: name, slide: slide, grid: tableGrid.map(function (row) { return row.map(function (cell) { return String(cell); }); }) };
      for (var edge of ['left', 'top', 'width', 'height']) {
        if (raw[edge] === undefined) continue;
        var extent = Number(raw[edge]);
        if (!Number.isFinite(extent) || extent < 0 || extent > 2000) return fail('"' + edge + '" must be between 0 and 2000 points.');
        table[edge] = extent;
      }
      return { ok: true, operation: table };
    }

    if (name === 'styleShape') {
      var styled = { op: name, slide: slide, shape: text(raw.shape, 120).trim() };
      if (styled.shape === '') return fail('"styleShape" needs the name of the shape.');
      for (var colourKey of ['fill', 'color']) {
        if (raw[colourKey] === undefined) continue;
        if (typeof raw[colourKey] !== 'string' || !COLOUR.test(raw[colourKey])) return fail('"' + colourKey + '" must be a colour like #1F2A44.');
        styled[colourKey] = raw[colourKey];
      }
      if (raw.size !== undefined) {
        var styledSize = Number(raw.size);
        if (!Number.isFinite(styledSize) || styledSize < 6 || styledSize > 200) return fail('"size" must be a font size between 6 and 200.');
        styled.size = styledSize;
      }
      if (raw.bold !== undefined) styled.bold = raw.bold === true;
      if (styled.fill === undefined && styled.color === undefined && styled.size === undefined && styled.bold === undefined) {
        return fail('"styleShape" needs at least one of fill, color, size or bold.');
      }
      return { ok: true, operation: styled };
    }

    // addTextBox
    var boxText = text(raw.text, 4000);
    if (boxText.trim() === '') return fail('"addTextBox" needs text.');
    var box = { op: name, slide: slide, text: boxText };
    for (var measure of ['left', 'top', 'width', 'height']) {
      if (raw[measure] === undefined) continue;
      var amount = Number(raw[measure]);
      if (!Number.isFinite(amount) || amount < 0 || amount > 2000) return fail('"' + measure + '" must be between 0 and 2000 points.');
      box[measure] = amount;
    }
    if (raw.size !== undefined) {
      var boxSize = Number(raw.size);
      if (!Number.isFinite(boxSize) || boxSize < 6 || boxSize > 200) return fail('"size" must be a font size between 6 and 200.');
      box.size = boxSize;
    }
    if (raw.bold !== undefined) box.bold = raw.bold === true;
    return { ok: true, operation: box };
  }

  /** A1:B2 in, { text, start, end } out, or null when it is not a real range. */
  function normaliseRange(value) {
    if (typeof value !== 'string') return null;
    var plain = value.trim().replace(/\$/g, '').replace(/\s/g, '').toUpperCase();
    if (!CELL_RANGE.test(plain)) return null;
    var parts = plain.split(':');
    var start = cellOf(parts[0]);
    var end = cellOf(parts[1] || parts[0]);
    if (start === null || end === null) return null;
    // A backwards range would still run in Excel, but the preview would read as if
    // it went the other way, so it is refused instead.
    if (start.row > end.row || start.column > end.column) return null;
    return { text: plain, start: start, end: end };
  }

  function cellOf(reference) {
    var match = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(reference);
    if (match === null) return null;
    var column = 0;
    for (var index = 0; index < match[1].length; index += 1) {
      column = column * 26 + (match[1].charCodeAt(index) - 64);
    }
    return { row: Number(match[2]), column: column };
  }

  /** 3 in, "C" out, so a computed cell can be written the way a person reads it. */
  function columnName(column) {
    var name = '';
    var left = Math.max(1, Math.min(column, 16384));
    while (left > 0) {
      var remainder = (left - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      left = Math.floor((left - 1) / 26);
    }
    return name;
  }

  /**
   * A rectangular grid, with short rows padded so every row has the same width.
   * @param {any} value
   * @param {'value'|'formula'} kind
   * @returns {Array<Array<any>>|null}
   */
  function normaliseGrid(value, kind) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) return null;
    var width = 0;
    for (var index = 0; index < value.length; index += 1) {
      if (!Array.isArray(value[index])) return null;
      width = Math.max(width, value[index].length);
    }
    if (width === 0 || width > MAX_COLUMNS) return null;

    var rows = [];
    for (var r = 0; r < value.length; r += 1) {
      var row = [];
      for (var c = 0; c < width; c += 1) {
        var cell = value[r][c];
        if (cell === undefined || cell === null) {
          row.push('');
          continue;
        }
        if (typeof cell === 'number' || typeof cell === 'boolean') {
          row.push(kind === 'formula' ? String(cell) : cell);
          continue;
        }
        if (typeof cell !== 'string') return null;
        if (kind === 'formula' && cell !== '' && cell.charAt(0) !== '=') return null;
        row.push(cell);
      }
      rows.push(row);
    }
    return rows;
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  /**
   * One line a person can read, for the card above the Apply button.
   * @param {object} operation A validated operation.
   * @returns {string}
   */
  function describeOperation(operation) {
    if (operation === null || typeof operation !== 'object') return 'Unknown change';
    var where = operation.sheet ? operation.sheet + '!' + operation.range : operation.range;

    switch (operation.op) {
      case 'setValues':
        return 'Write ' + plural(countCells(operation.grid), 'value', 'values') + ' into ' + where;
      case 'setFormulas':
        return 'Write ' + plural(countCells(operation.grid), 'formula', 'formulas') + ' into ' + where;
      case 'setNumberFormat':
        return 'Format ' + where + ' as ' + operation.format;
      case 'format': {
        var words = [];
        if (operation.bold !== undefined) words.push(operation.bold ? 'bold' : 'not bold');
        if (operation.italic !== undefined) words.push(operation.italic ? 'italic' : 'not italic');
        if (operation.size !== undefined) words.push(operation.size + 'pt text');
        if (operation.color !== undefined) words.push('text ' + operation.color);
        if (operation.fill !== undefined) words.push('fill ' + operation.fill);
        if (operation.align !== undefined) words.push(operation.align + ' aligned');
        if (operation.wrapText !== undefined) words.push(operation.wrapText ? 'wrapped' : 'not wrapped');
        return 'Make ' + where + ' ' + words.join(', ');
      }
      case 'columnWidth':
        return 'Set the column width of ' + where + ' to about ' + operation.width + ' characters';
      case 'autofit':
        return 'Fit the columns and rows of ' + where + ' to their contents';
      case 'addWorksheet':
        return 'Add a sheet called ' + operation.name;
      case 'clear':
        return 'Clear the contents of ' + where;
      case 'createTable':
        return 'Turn ' + where + ' into a table' + (operation.name ? ' called ' + operation.name : '');
      case 'fillFormula':
        return 'Fill ' + where + ' with ' + operation.formula;
      case 'borders':
        return operation.style === 'none' ? 'Remove the borders from ' + where : 'Draw ' + operation.style + ' borders on ' + where;
      case 'freezePanes':
        return operation.rows === 0 && operation.columns === 0
          ? 'Unfreeze the panes'
          : 'Freeze ' + [operation.rows > 0 ? plural(operation.rows, 'row', 'rows') : '', operation.columns > 0 ? plural(operation.columns, 'column', 'columns') : ''].filter(Boolean).join(' and ');
      case 'merge':
        return 'Merge the cells of ' + where;
      case 'rowHeight':
        return 'Set the row height of ' + where + ' to ' + operation.height + ' points';
      case 'conditionalFormat':
        return 'Colour ' + where + ' by rule: ' + operation.rule;
      case 'dataValidation':
        return 'Add a drop-down to ' + where + ' with ' + plural(operation.list.length, 'option', 'options');
      case 'sort':
        return 'Sort ' + where + ' by column ' + operation.column + (operation.ascending ? ' ascending' : ' descending');
      case 'namedRange':
        return 'Name ' + where + ' "' + operation.name + '"';
      case 'addChart':
        return 'Draw a ' + operation.chartType + ' chart of ' + where
          + (operation.title ? ' titled "' + operation.title + '"' : '')
          + ' at ' + operation.at;
      case 'replaceSelection':
        return 'Replace the selected text with ' + plural(operation.text.length, 'character', 'characters');
      case 'insertAfterSelection':
        return 'Add a paragraph after the selection';
      case 'insertParagraphs':
        return 'Add ' + plural(operation.paragraphs.length, 'paragraph', 'paragraphs') + ' at the ' + whereInWord(operation.where);
      case 'applyStyle':
        return 'Apply the style ' + operation.style + ' to the selection';
      case 'replaceAll':
        return 'Replace every "' + operation.find + '" with "' + operation.replace + '"';
      case 'insertTable':
        return 'Insert a ' + operation.grid.length + ' by ' + operation.grid[0].length + ' table';
      case 'insertFormatted':
        return 'Add formatted text (headings, lists, tables) at the ' + whereInWord(operation.where);
      case 'addTable':
        return 'Add a ' + operation.grid.length + ' by ' + operation.grid[0].length + ' table on slide ' + operation.slide;
      case 'styleShape':
        return 'Restyle "' + operation.shape + '" on slide ' + operation.slide;
      case 'setSelectedText':
        return 'Replace the selected text';
      case 'addSlide':
        return 'Add a slide' + (operation.title ? ' titled "' + operation.title + '"' : '');
      case 'setSlideTitle':
        return 'Rename slide ' + operation.slide + ' to "' + operation.title + '"';
      case 'setShapeText':
        return 'Rewrite ' + (operation.shape ? '"' + operation.shape + '"' : 'a shape') + ' on slide ' + operation.slide;
      case 'addTextBox':
        return 'Add a text box on slide ' + operation.slide;
      default:
        return operation.op;
    }
  }

  function countCells(grid) {
    return Array.isArray(grid) ? grid.reduce(function (total, row) { return total + row.length; }, 0) : 0;
  }

  function whereInWord(where) {
    if (where === 'start') return 'top of the document';
    if (where === 'afterSelection') return 'after the selection';
    if (where === 'replaceSelection') return 'in place of the selection';
    return 'end of the document';
  }

  /**
   * The first few rows of a grid, for the review card. Values are clipped rather
   * than wrapped so a long paragraph cannot make one cell swallow the card.
   * @param {object} operation
   * @returns {{ columns: number, rows: Array<Array<string>>, more: number } | null}
   */
  function previewGrid(operation) {
    if (!operation || !Array.isArray(operation.grid)) return null;
    var rows = operation.grid.slice(0, 5).map(function (row) {
      return row.slice(0, 6).map(function (cell) {
        var shown = String(cell === null || cell === undefined ? '' : cell);
        return shown.length > 18 ? shown.slice(0, 17) + '\u2026' : shown;
      });
    });
    return { columns: operation.grid[0].length, rows: rows, more: Math.max(0, operation.grid.length - rows.length) };
  }

  /** The host a validated plan belongs to, or '' when it mixes hosts. */
  function hostOf(operations) {
    var seen = '';
    for (var index = 0; index < operations.length; index += 1) {
      var host = OPERATIONS[operations[index].op];
      if (seen !== '' && seen !== host) return '';
      seen = host;
    }
    return seen;
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Bold, italic, code and http(s) links; every other character is escaped, so model text can never inject markup. */
  function inlineHtml(value) {
    var out = '';
    var last = 0;
    var pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*[^*\s][^*]*\*)/g;
    var match;
    while ((match = pattern.exec(value)) !== null) {
      out += escapeHtml(value.slice(last, match.index));
      var token = match[0];
      if (token.indexOf('**') === 0) out += '<strong>' + escapeHtml(token.slice(2, -2)) + '</strong>';
      else if (token.charAt(0) === '`') out += '<code>' + escapeHtml(token.slice(1, -1)) + '</code>';
      else if (token.charAt(0) === '[') {
        var link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
        out += link ? '<a href="' + escapeHtml(link[2]) + '">' + escapeHtml(link[1]) + '</a>' : escapeHtml(token);
      } else out += '<em>' + escapeHtml(token.slice(1, -1)) + '</em>';
      last = match.index + token.length;
    }
    return out + escapeHtml(value.slice(last));
  }

  /**
   * Markdown a model writes (headings, lists, quotes, tables, rules) as HTML that Word's
   * insertHtml turns into real styled paragraphs. Without it, "## Title" lands in the
   * document as those literal characters.
   * @param {string} markdown
   * @returns {string}
   */
  function markdownToHtml(markdown) {
    var lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    var html = '';
    var index = 0;
    var tableSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
    function cells(line) {
      return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (cell) { return cell.trim(); });
    }
    while (index < lines.length) {
      var line = lines[index];
      var trimmed = line.trim();
      if (trimmed === '') { index += 1; continue; }

      var heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        var level = Math.min(heading[1].length, 3);
        html += '<h' + level + '>' + inlineHtml(heading[2]) + '</h' + level + '>';
        index += 1;
        continue;
      }
      if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) { html += '<hr>'; index += 1; continue; }

      if (trimmed.charAt(0) === '|' && index + 1 < lines.length && tableSeparator.test(lines[index + 1].trim())) {
        var head = cells(trimmed);
        html += '<table border="1" cellspacing="0" cellpadding="4"><tr>' + head.map(function (cell) { return '<th>' + inlineHtml(cell) + '</th>'; }).join('') + '</tr>';
        index += 2;
        while (index < lines.length && lines[index].trim().charAt(0) === '|') {
          var row = cells(lines[index]);
          html += '<tr>' + head.map(function (_cell, column) { return '<td>' + inlineHtml(row[column] || '') + '</td>'; }).join('') + '</tr>';
          index += 1;
        }
        html += '</table>';
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        var quoted = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) { quoted.push(lines[index].trim().replace(/^>\s?/, '')); index += 1; }
        html += '<blockquote>' + inlineHtml(quoted.join(' ')) + '</blockquote>';
        continue;
      }

      var bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
      var numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (bullet || numbered) {
        var tag = bullet ? 'ul' : 'ol';
        var items = '';
        while (index < lines.length) {
          var current = lines[index].trim();
          var next = tag === 'ul' ? /^[-*+]\s+(.+)$/.exec(current) : /^\d+[.)]\s+(.+)$/.exec(current);
          if (!next) break;
          items += '<li>' + inlineHtml(next[1]) + '</li>';
          index += 1;
        }
        html += '<' + tag + '>' + items + '</' + tag + '>';
        continue;
      }

      var paragraph = [];
      while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(lines[index].trim())) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      if (paragraph.length === 0) { paragraph.push(trimmed); index += 1; }
      html += '<p>' + inlineHtml(paragraph.join(' ')) + '</p>';
    }
    return html;
  }

  return {
    MAX_OPERATIONS: MAX_OPERATIONS,
    OPERATIONS: OPERATIONS,
    markdownToHtml: markdownToHtml,
    splitReply: splitReply,
    parseBlock: parseBlock,
    validateOperation: validateOperation,
    describeOperation: describeOperation,
    previewGrid: previewGrid,
    hostOf: hostOf,
    isOpsLang: isOpsLang,
    countCells: countCells,
  };
});
