/*
 * Zuris task pane for Word, Excel and PowerPoint.
 *
 * One screen: a conversation that stays put while the document sits beside it, a
 * composer pinned to the bottom, and a change card for anything the model proposes.
 * Nothing is written to the file until the person presses Apply, and a change is a
 * list of checked operations rather than free text, so "fill this column with
 * formulas" turns into real Excel formulas instead of pasted numbers.
 *
 * Plain browser script: Office's web view gives us no module loader, so the change
 * block parser lives in ops.js and hangs itself off window.ZuriOps.
 */
(function () {
  'use strict';

  var ZuriOps = window.ZuriOps;
  var token = document.querySelector('meta[name="zuri-token"]').content;

  var pane = {
    hostLabel: document.getElementById('host-label'),
    thread: document.getElementById('thread'),
    empty: document.getElementById('empty'),
    emptyTitle: document.getElementById('empty-title'),
    emptyLine: document.getElementById('empty-line'),
    suggestions: document.getElementById('suggestions'),
    contextText: document.getElementById('context-text'),
    refreshContext: document.getElementById('refresh-context'),
    prompt: document.getElementById('prompt'),
    send: document.getElementById('send'),
    stop: document.getElementById('stop'),
    newChat: document.getElementById('new-chat'),
    modelLabel: document.getElementById('model-label'),
    edits: document.getElementById('edits-mode'),
    status: document.getElementById('status'),
  };

  /** How much of the file is read for the model. Every character is sent and billed. */
  var SHEET_ROWS = 60;
  var SHEET_COLUMNS = 10;
  var CONTEXT_CHARACTER_LIMIT = 12000;
  var MAX_FORMULA_LINES = 200;
  var STORED_TURNS = 16;

  var state = {
    host: '',
    // 'ask' shows the plan and waits; 'always' applies it as it arrives. Held per
    // browser rather than per account: it is a preference about this machine, and
    // someone on a shared computer should not inherit another person's answer.
    edits: 'ask',
    messages: [],
    streaming: false,
    controller: null,
    context: { label: '', text: '' },
    model: '',
    streamNode: null,
  };

  var previewHost = (new URLSearchParams(window.location.search).get('preview') || '').toLowerCase();
  var wired = false;

  /**
   * Plans already applied, by the identity built from the plan itself.
   *
   * paintAssistant runs again for every streamed word, so each of those repaints
   * rebuilt the card and applied the whole plan once more under "Always allow".
   * One entry per plan means the first card applies it and later copies only say
   * what it did.
   * @type {Object<string, { done: boolean, note: string }>}
   */
  var appliedPlans = {};

  /** The same summary and operations always give the same key, so a repaint matches. */
  function planKey(plan) {
    return String(plan.summary || '') + '|' + JSON.stringify(plan.operations);
  }

  /* Which Office app is this? ---------------------------------------------- */

  /** "excel" in, "Excel" out, and "" for anything else. */
  function normaliseHostName(value) {
    var name = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    if (name === 'excel') return 'Excel';
    if (name === 'powerpoint') return 'PowerPoint';
    if (name === 'word') return 'Word';
    return '';
  }

  /**
   * Which app the pane is running in, or '' when Office has not said yet.
   *
   * Office writes the answer in three different places and they do not all arrive at
   * once: the desktop clients put it in the pane's own address as _host_Info, office.js
   * exposes Office.context.host, and onReady hands it over as info.host. The pane used to
   * assume Word whenever the first of those was late, which put a Word screen inside
   * Excel and then ran Word's API against a workbook, so the pane sat on "Reading the
   * file..." for ever. Reading every source, and waiting rather than guessing, is the fix.
   */
  function detectHost(info) {
    return hostFromInfo(info) || hostFromAddress() || hostFromOffice() || hostFromGlobals();
  }

  function hostFromInfo(info) {
    return info && typeof info.host === 'string' ? normaliseHostName(info.host) : '';
  }

  /** Word, Excel and PowerPoint all append ?_host_Info=Excel$Win32$... to the pane URL. */
  function hostFromAddress() {
    try {
      var raw = new URLSearchParams(window.location.search).get('_host_Info') || '';
      return normaliseHostName(raw.split('$')[0]);
    } catch (error) {
      return '';
    }
  }

  function hostFromOffice() {
    try {
      if (typeof Office === 'undefined' || !Office.context) return '';
      var diagnosed = Office.context.diagnostics ? Office.context.diagnostics.host : '';
      return normaliseHostName(Office.context.host) || normaliseHostName(diagnosed);
    } catch (error) {
      return '';
    }
  }

  /** office.js installs only the running app's namespace, so this settles the last case. */
  function hostFromGlobals() {
    try {
      if (typeof Excel !== 'undefined' && Excel && typeof Excel.run === 'function') return 'Excel';
      if (typeof PowerPoint !== 'undefined' && PowerPoint && typeof PowerPoint.run === 'function') return 'PowerPoint';
      if (typeof Word !== 'undefined' && Word && typeof Word.run === 'function') return 'Word';
    } catch (error) {
      return '';
    }
    return '';
  }

  /** The app's own API object, or null while office.js has not loaded it. */
  function officeApiFor(host) {
    if (host === '') return null;
    try {
      var api = window[host];
      return api && typeof api.run === 'function' ? api : null;
    } catch (error) {
      return null;
    }
  }

  /* Small helpers ---------------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setStatus(message, isError) {
    pane.status.textContent = message || '';
    pane.status.className = isError ? 'fine error' : 'fine';
  }

  function truncate(text, limit) {
    return text.length > limit ? text.slice(0, limit - 1) + '\u2026' : text;
  }

  function scrollToEnd(smooth) {
    window.requestAnimationFrame(function () {
      pane.thread.scrollTo({ top: pane.thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  /* What Zuri knows about the file ---------------------------------------- */

  function describeTarget() {
    if (state.host === 'Excel') return 'this sheet';
    if (state.host === 'PowerPoint') return 'this slide';
    if (state.host === 'Word') return 'this document';
    return 'the file';
  }

  /**
   * Read the open file, or say plainly why it cannot be read.
   *
   * A read never starts for an app the pane has not identified, and never starts the wrong
   * app's API either: a Word read inside Excel does not fail, it waits for ever.
   */
  function readContext() {
    if (previewHost !== '') return Promise.resolve(previewContext());
    if (state.host === '') {
      return Promise.reject(new Error('Zuri is still waiting for Office to say which app this is.'));
    }
    if (officeApiFor(state.host) === null) {
      return Promise.reject(new Error(state.host + ' has not finished loading. Close this pane and open it again from the ribbon.'));
    }

    var reading;
    try {
      reading = state.host === 'Excel' ? readExcel() : state.host === 'PowerPoint' ? readPowerPoint() : readWord();
    } catch (error) {
      return Promise.reject(error);
    }
    // Nothing should leave the chip on "Reading the file..." for ever, so a read that never
    // settles gives up and says so instead.
    return withDeadline(reading, 20000, 'Office did not answer in time. Press Refresh to try again.');
  }

  function withDeadline(promise, milliseconds, message) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () { reject(new Error(message)); }, milliseconds);
      Promise.resolve(promise).then(function (value) {
        window.clearTimeout(timer);
        resolve(value);
      }, function (error) {
        window.clearTimeout(timer);
        reject(error);
      });
    });
  }

  /** A1:F30 plus the grid, written out cell by cell so nothing has to be counted. */
  function readExcel() {
    return Excel.run(function (context) {
      var sheet = context.workbook.worksheets.getActiveWorksheet();
      sheet.load('name');
      var used = sheet.getUsedRangeOrNullObject(true);
      used.load(['address', 'rowCount', 'columnCount']);
      var selection = context.workbook.getSelectedRange();
      selection.load(['address', 'text']);
      var sheets = context.workbook.worksheets.load('items/name');

      return context.sync().then(function () {
        var sheetNames = sheets.items.map(function (item) { return item.name; });
        var heading = 'Workbook sheets: ' + sheetNames.join(', ') + '.\nActive sheet: "' + sheet.name + '".';

        if (used.isNullObject) {
          return {
            label: sheet.name + ' is empty',
            text: heading + '\nThe active sheet has nothing in it yet.',
          };
        }

        var rows = Math.min(used.rowCount, SHEET_ROWS);
        var columns = Math.min(used.columnCount, SHEET_COLUMNS);
        var grid = used.getCell(0, 0).getResizedRange(rows - 1, columns - 1);
        grid.load(['address', 'text', 'formulas']);
        var address = used.address.split('!').pop();
        var selected = selection.address.split('!').pop();

        return context.sync().then(function () {
          var shown = grid.address.split('!').pop();
          var lines = [heading, 'The used area ' + address + ' is shown as ' + shown + ': ' + rows + ' rows, ' + columns + ' columns, with cell A1 first.'];
          if (selected !== shown) lines.push('The person selected ' + selected + '.');
          lines.push('Every line starts with its row number. Cells are separated by a tab. The first line names the columns.');

          var startRef = /^([A-Z]+)(\d+)$/.exec(shown.split(':')[0]);
          var startColumn = startRef ? columnNumber(startRef[1]) : 1;
          var startRow = startRef ? Number(startRef[2]) : 1;
          var header = [''];
          for (var c = 0; c < columns; c += 1) header.push('[' + columnName(startColumn + c) + ']');
          lines.push(header.join('\t'));

          var used1 = 0;
          for (var r = 0; r < rows; r += 1) {
            var cells = grid.text[r] || [];
            var line = [String(startRow + r)];
            for (var col = 0; col < columns; col += 1) {
              var value = cells[col] === undefined || cells[col] === null ? '' : String(cells[col]);
              line.push(value.replace(/\t/g, ' ').replace(/\r?\n/g, ' / '));
            }
            var rendered = line.join('\t');
            used1 += rendered.length + 1;
            if (used1 > CONTEXT_CHARACTER_LIMIT) {
              lines.push('...the rest of the sheet was left out to keep the request small.');
              break;
            }
            lines.push(rendered);
          }

          var formulas = [];
          for (var fr = 0; fr < rows && formulas.length < MAX_FORMULA_LINES; fr += 1) {
            var formulaRow = grid.formulas[fr] || [];
            for (var fc = 0; fc < columns && formulas.length < MAX_FORMULA_LINES; fc += 1) {
              var formula = formulaRow[fc];
              if (typeof formula !== 'string' || formula.charAt(0) !== '=') continue;
              formulas.push(columnName(startColumn + fc) + (startRow + fr) + ' = ' + formula);
            }
          }
          if (formulas.length > 0) {
            lines.push('', 'Formulas already in this area, so a new one can match their style:');
            lines = lines.concat(formulas);
          }

          var selectedText = (selection.text || []).map(function (row) {
            return (Array.isArray(row) ? row : [row]).join('\t');
          }).join('\n').trim();

          return {
            label: state.host + ' ' + sheet.name + ' ' + shown,
            text: lines.join('\n') + (selectedText === '' ? '' : '\n\nSelected cells (' + selected + '):\n' + truncate(selectedText, 2000)),
          };
        });
      });
    });
  }

  function columnNumber(letters) {
    var total = 0;
    for (var index = 0; index < letters.length; index += 1) total = total * 26 + (letters.charCodeAt(index) - 64);
    return total;
  }

  function columnName(number) {
    var name = '';
    var value = number;
    while (value > 0) {
      var remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  /** The document as a numbered outline, which is what "make this a report" needs. */
  function readWord() {
    return Word.run(function (context) {
      var body = context.document.body;
      var paragraphs = body.paragraphs;
      paragraphs.load('items/text,items/style');
      var selection = context.document.getSelection();
      selection.load('text');
      var properties = context.document.properties;
      properties.load('title');

      return context.sync().then(function () {
        var lines = [];
        var title = (properties.title || '').trim();
        if (title !== '') lines.push('Document title: ' + title + '.');
        lines.push('The document has ' + paragraphs.items.length + ' paragraphs. Each line below is one paragraph, with its style.');

        var total = 0;
        var shown = 0;
        for (var index = 0; index < paragraphs.items.length; index += 1) {
          var paragraph = paragraphs.items[index];
          var text = (paragraph.text || '').replace(/\s+$/, '');
          if (text === '') continue;
          var style = '';
          try {
            style = paragraph.style ? '[' + paragraph.style + '] ' : '';
          } catch (error) {
            style = '';
          }
          var line = (index + 1) + '. ' + style + truncate(text, 220);
          total += line.length + 1;
          if (total > CONTEXT_CHARACTER_LIMIT) {
            lines.push('...the rest of the document was left out to keep the request small.');
            break;
          }
          lines.push(line);
          shown += 1;
        }
        if (shown === 0) lines.push('The document is empty.');

        var selected = (selection.text || '').trim();
        if (selected !== '') lines.push('', 'Selected text:', truncate(selected, 4000));

        return { label: 'Word ' + (title || 'document') + ' ' + paragraphs.items.length + ' paragraphs', text: lines.join('\n') };
      });
    });
  }

  function readPowerPoint() {
    var selected = new Promise(function (resolve) {
      Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, function (result) {
        resolve(result.status === Office.AsyncResultStatus.Succeeded ? String(result.value || '') : '');
      });
    });

    return selected.then(function (selectedText) {
      var basic = { label: 'PowerPoint', text: 'Selected text:\n' + (selectedText.trim() === '' ? '(nothing selected)' : truncate(selectedText, 4000)) };
      if (!supported('PowerPointApi', '1.2')) {
        return { label: basic.label, text: basic.text + '\n\n(Slide details need a newer PowerPoint.)' };
      }
      return PowerPoint.run(function (context) {
        var slides = context.presentation.slides;
        slides.load('items');
        return context.sync().then(function () {
          var lines = ['The deck has ' + slides.items.length + ' slides. Slide numbers start at 1.'];
          var shown = Math.min(slides.items.length, 20);
          var shapeLists = [];
          for (var s = 0; s < shown; s += 1) {
            var shapes = slides.items[s].shapes;
            shapes.load('items/name,items/textFrame/hasText');
            shapeLists.push(shapes);
          }
          return context.sync().then(function () {
            var withText = [];
            for (var list = 0; list < shapeLists.length; list += 1) {
              var items = shapeLists[list].items;
              for (var item = 0; item < items.length; item += 1) {
                var shape = items[item];
                if (shape.textFrame && shape.textFrame.hasText) {
                  shape.textFrame.textRange.load('text');
                  withText.push({ slide: list, shape: shape });
                }
              }
            }
            return context.sync().then(function () {
              var bySlide = {};
              withText.forEach(function (entry) {
                var value = String(entry.shape.textFrame.textRange.text || '').replace(/\s+/g, ' ').trim();
                if (value === '') return;
                if (!bySlide[entry.slide]) bySlide[entry.slide] = [];
                bySlide[entry.slide].push(entry.shape.name + ': ' + truncate(value, 200));
              });
              for (var index = 0; index < shown; index += 1) {
                var texts = bySlide[index] || [];
                lines.push('Slide ' + (index + 1) + ': ' + (texts.length === 0 ? '(no text)' : texts.join(' | ')));
              }
              if (slides.items.length > shown) lines.push('...the rest of the deck was left out.');
              if (selectedText.trim() !== '') lines.push('', 'Selected text:', truncate(selectedText, 2000));
              return { label: 'PowerPoint ' + slides.items.length + ' slides', text: lines.join('\n') };
            });
          });
        });
      });
    });
  }

  function supported(set, version) {
    try {
      return Office.context.requirements.isSetSupported(set, version);
    } catch (error) {
      return false;
    }
  }

  /** Stand-in file data so the pane can be looked at without Office. */
  function previewContext() {
    if (state.host === 'Word') {
      return {
        label: 'Word Quarterly report 18 paragraphs',
        text: [
          'Document title: Quarterly report.',
          'The document has 18 paragraphs. Each line below is one paragraph, with its style.',
          '1. [Title] Quarterly report',
          '2. [Heading 1] Where we are',
          '3. [Normal] Revenue came in at 3,350 against a plan of 3,000. Costs were 1,607, well under the 2,985 we budgeted, so the quarter closes ahead.',
          '4. [Heading 1] What went well',
          '5. [List Bullet] Freelance work doubled.',
          '6. [List Bullet] Utilities came in under budget.',
          '',
          'Selected text:',
          'Revenue came in at 3,350 against a plan of 3,000.',
        ].join('\n'),
      };
    }
    if (state.host === 'PowerPoint') {
      return {
        label: 'PowerPoint 6 slides',
        text: [
          'The deck has 6 slides. Slide numbers start at 1.',
          'Slide 1: Title 1: Zuri | Subtitle 2: The quarter in numbers',
          'Slide 2: Title 1: Where we are',
          'Slide 3: Title 1: Costs | TextBox 3: Rent 1,200 / Utilities 95',
          'Slide 4: Title 1: What went well',
          'Slide 5: Title 1: What we will change',
          'Slide 6: Title 1: Thank you',
        ].join('\n'),
      };
    }
    var sample = [
      'Workbook sheets: Budget, Transactions, Summary.',
      'Active sheet: "Budget".',
      'The used area A1:F30 is shown as A1:F30: 30 rows, 6 columns, with cell A1 first.',
      'Every line starts with its row number. Cells are separated by a tab. The first line names the columns.',
      '\t[A]\t[B]\t[C]\t[D]\t[E]\t[F]',
      '1\tCategory\tType\tPlanned\tActual\tRemaining\t% of plan',
      '2\tSalary\tIncome\t3000\t3000\t0\t1',
      '3\tFreelance / side work\tIncome\t300\t300\t0\t1',
      '4\tOther income\tIncome\t50\t0\t50\t0',
      '5\tRent or mortgage\tExpense\t1200\t1200\t0\t1',
      '6\tUtilities\tExpense\t150\t95\t55\t0.6333333333',
      '7\tGroceries\tExpense\t400\t160.6\t239.4\t0.4015',
      '28\tTotal income\tIncome\t3350\t3300\t50\t0.985074627',
      '29\tTotal expenses\tExpense\t2985\t1607.34\t1377.66\t0.538472362',
      '30\tNet (income minus expenses)\t\t365\t1692.66\t-1327.66\t',
      '',
      'Formulas already in this area, so a new one can match their style:',
      'E2 = =C2-D2',
      'F2 = =IF(C2=0,"",D2/C2)',
      'E30 = =C30-D30',
    ];
    return { label: 'Excel Budget A1:F30', text: sample.join('\n') };
  }

  /* Drawing the conversation ----------------------------------------------- */

  function paintProse(parent, source) {
    var lines = String(source).split('\n');
    var paragraph = [];
    var list = null;

    function flushParagraph() {
      if (paragraph.length === 0) return;
      var node = el('p');
      appendInline(node, paragraph.join(' '));
      parent.appendChild(node);
      paragraph = [];
    }

    function flushList() {
      if (list === null) return;
      parent.appendChild(list);
      list = null;
    }

    for (var index = 0; index < lines.length; index += 1) {
      var trimmed = lines[index].trim();
      if (trimmed === '') {
        flushParagraph();
        flushList();
        continue;
      }

      var heading = /^#{1,4}\s+(.*)$/.exec(trimmed);
      if (heading !== null) {
        flushParagraph();
        flushList();
        var line = el('p');
        line.appendChild(el('strong', null, heading[1]));
        parent.appendChild(line);
        continue;
      }

      var bullet = /^[-*]\s+(.*)$/.exec(trimmed);
      var numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
      if (bullet !== null || numbered !== null) {
        flushParagraph();
        var wanted = numbered !== null ? 'ol' : 'ul';
        if (list === null || list.tagName.toLowerCase() !== wanted) {
          flushList();
          list = el(wanted);
        }
        var item = el('li');
        appendInline(item, numbered !== null ? numbered[2] : bullet[1]);
        list.appendChild(item);
        continue;
      }

      flushList();
      paragraph.push(trimmed);
    }
    flushParagraph();
    flushList();
  }

  /** Bold, inline code and links, built as nodes so reply text is never HTML. */
  function appendInline(parent, text) {
    var pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
    var last = 0;
    var match = pattern.exec(text);
    while (match !== null) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      var piece = match[0];
      if (piece.slice(0, 2) === '**') {
        parent.appendChild(el('strong', null, piece.slice(2, -2)));
      } else if (piece.charAt(0) === '`') {
        parent.appendChild(el('code', null, piece.slice(1, -1)));
      } else {
        var link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(piece);
        var anchor = el('a', null, link[1]);
        anchor.href = link[2];
        anchor.target = '_blank';
        anchor.rel = 'noreferrer noopener';
        parent.appendChild(anchor);
      }
      last = match.index + piece.length;
      match = pattern.exec(text);
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function buildMessage(message) {
    var node = el('div', 'msg ' + (message.role === 'user' ? 'msg-user' : 'msg-assistant'));
    if (message.role === 'user') {
      node.appendChild(el('div', 'bubble', message.content));
      return node;
    }
    node.appendChild(el('span', 'caption', 'Zuri'));
    paintAssistant(node, message);
    return node;
  }

  function paintAssistant(node, message) {
    while (node.lastChild && node.lastChild.className !== 'caption') node.removeChild(node.lastChild);

    var segments = ZuriOps.splitReply(message.content);
    if (segments.length === 0) {
      node.appendChild(el('div', 'ops-open', 'Thinking...'));
      return;
    }

    for (var index = 0; index < segments.length; index += 1) {
      var segment = segments[index];
      if (segment.type === 'text') {
        var prose = segment.text.trim();
        if (prose === '') continue;
        var bubble = el('div', 'bubble');
        paintProse(bubble, prose);
        node.appendChild(bubble);
        continue;
      }
      if (segment.type === 'ops') {
        node.appendChild(buildChangeCard(segment));
        continue;
      }
      if (segment.type === 'ops-open') {
        node.appendChild(el('div', 'ops-open', 'Preparing a change to the file...'));
        continue;
      }
      var codeBlock = el('pre');
      codeBlock.appendChild(el('code', null, segment.text));
      node.appendChild(codeBlock);
    }
  }

  /**
   * Whether Zuri may change the file without being asked. "Always allow" is the
   * standing answer, so it survives a reload; "ask" is the safe default.
   * @returns {'ask'|'always'}
   */
  function readEditsMode() {
    try {
      return window.localStorage.getItem('zuri.addin.edits') === 'always' ? 'always' : 'ask';
    } catch (error) {
      return 'ask';
    }
  }

  function writeEditsMode(mode) {
    state.edits = mode === 'always' ? 'always' : 'ask';
    if (pane.edits) pane.edits.value = state.edits;
    try {
      window.localStorage.setItem('zuri.addin.edits', state.edits);
    } catch (error) {
      // A private window refuses storage; the choice still holds for this session.
    }
  }

  function buildChangeCard(segment) {
    var card = el('div', 'ops');

    if (!segment.result.ok) {
      card.appendChild(el('div', 'ops-head', 'That change could not be read'));
      card.appendChild(el('div', 'ops-error', segment.result.error));
      card.appendChild(el('div', 'ops-note', 'Ask Zuri again, or say what to change in a different way.'));
      return card;
    }

    var plan = segment.result;
    card.appendChild(el('div', 'ops-head', plan.summary || 'Proposed change to ' + describeTarget()));

    var list = el('ul', 'ops-list');
    for (var index = 0; index < plan.operations.length; index += 1) {
      list.appendChild(el('li', null, ZuriOps.describeOperation(plan.operations[index])));
    }
    card.appendChild(list);

    var preview = firstPreview(plan.operations);
    if (preview !== null) card.appendChild(preview);

    var actions = el('div', 'ops-actions');
    var applyButton = el('button', 'apply', 'Apply');
    applyButton.type = 'button';
    actions.appendChild(applyButton);

    // The second button answers the question for good, the way an agent that is
    // trusted with a file works: apply this one and stop asking.
    var alwaysButton = el('button', 'ghost', 'Always allow');
    alwaysButton.type = 'button';
    alwaysButton.title = 'Apply this change and apply later ones without asking';
    actions.appendChild(alwaysButton);
    card.appendChild(actions);

    applyButton.addEventListener('click', function () {
      applyPlan(card, actions, applyButton, plan);
    });
    alwaysButton.addEventListener('click', function () {
      writeEditsMode('always');
      applyPlan(card, actions, applyButton, plan);
    });

    if (state.edits === 'always') {
      // No second permission question: the standing answer was given already.
      actions.appendChild(el('span', 'ops-note', 'Applying automatically, because edits are always allowed.'));
      applyPlan(card, actions, applyButton, plan);
    } else {
      actions.appendChild(el('span', 'ops-note', 'Nothing changes until you press Apply.'));
    }

    return card;
  }

  /** A small table of the first few cells, so the change can be eyeballed. */
  function firstPreview(operations) {
    for (var index = 0; index < operations.length; index += 1) {
      if (operations[index].op !== 'setValues' && operations[index].op !== 'setFormulas') continue;
      var grid = ZuriOps.previewGrid(operations[index]);
      if (grid === null) continue;
      var table = el('table', 'ops-preview');
      for (var r = 0; r < grid.rows.length; r += 1) {
        var row = el('tr');
        for (var c = 0; c < grid.rows[r].length; c += 1) {
          var cell = grid.rows[r][c];
          var td = el('td', operations[index].op === 'setFormulas' && cell.charAt(0) === '=' ? 'formula' : null, cell);
          row.appendChild(td);
        }
        if (grid.columns > grid.rows[r].length) row.appendChild(el('td', null, '...'));
        table.appendChild(row);
      }
      var wrap = el('div');
      wrap.appendChild(table);
      if (grid.more > 0) wrap.appendChild(el('div', 'ops-note', 'and ' + grid.more + ' more row' + (grid.more === 1 ? '' : 's')));
      return wrap;
    }
    return null;
  }

  /**
   * Carry out a plan and report what happened to every operation in it.
   *
   * A plan may only be run once: the card is rebuilt for each streamed word, so
   * "Always allow" used to apply the same plan again on every one of those rebuilds.
   * @param {HTMLElement} card
   * @param {HTMLElement} actions
   * @param {HTMLButtonElement} button
   * @param {object} plan
   * @returns {void}
   */
  function applyPlan(card, actions, button, plan) {
    var key = planKey(plan);
    var earlier = appliedPlans[key];
    // The same card may try again when nothing reached the file. Every other card is a
    // repaint of this one, and a repaint must never start the plan a second time.
    var retry = earlier !== undefined && earlier.button === button && earlier.done === true && earlier.reached !== true;
    if (earlier !== undefined && retry !== true) {
      // In flight, already applied, or a repainted card: it says what happened the
      // first time and offers only what is still allowed.
      actions.textContent = '';
      var settled = earlier.done === true && earlier.reached === true;
      actions.appendChild(el('span', settled ? 'done' : 'ops-note', earlier.note));
      // A plan that reached nothing can be pressed again by hand; one that landed cannot.
      button.disabled = earlier.done !== true || earlier.reached === true;
      return;
    }
    // Recorded before the first await, so a card painted mid-apply knows the plan is
    // spoken for rather than starting it a second time.
    appliedPlans[key] = { done: false, reached: false, note: 'Applying...', button: button };
    button.disabled = true;
    button.textContent = 'Applying...';

    applyOperations(plan.operations)
      .then(function (report) {
        var applied = report.applied.length;
        var failed = report.failures.length;

        actions.textContent = '';
        if (applied > 0) {
          actions.appendChild(el('span', 'done', 'Applied ' + countChanges(applied) + '. Press Ctrl+Z in Office to undo.'));
        } else {
          // Nothing reached the file, so the button comes back for another go.
          button.disabled = false;
          button.textContent = 'Apply';
        }
        // Each refusal is named with the line of the plan it belongs to: one sentence
        // that named no operation is what the person could not act on.
        for (var failureIndex = 0; failureIndex < failed; failureIndex += 1) {
          card.appendChild(el('div', 'ops-error', 'Could not ' + lowerFirst(report.failures[failureIndex].description) + ': ' + report.failures[failureIndex].message));
        }
        if (applied > 0 && failed > 0) {
          card.appendChild(el('div', 'ops-note', countChanges(applied) + ' did reach the file. The rest can be asked for again.'));
        }
        appliedPlans[key] = {
          done: true,
          reached: applied > 0,
          button: button,
          note: applied === 0 ? 'Nothing was applied.'
            : failed === 0 ? 'Applied ' + countChanges(applied) + '.'
              : 'Applied ' + applied + ' of ' + (applied + failed) + ' changes.',
        };

        if (applied === 0) {
          setStatus('The change was not applied.', true);
          return;
        }
        setStatus(failed === 0
          ? 'Done. The file has been changed.'
          : 'Some changes were applied. The rest are listed on the card.', failed !== 0);
        // The file has moved on, so the next question is answered against what is there now.
        return readContext().then(function (context) {
          state.context = context;
          pane.contextText.textContent = context.label;
        }, function () { /* the chip can catch up on the next read */ });
      })
      .catch(function (error) {
        button.disabled = false;
        button.textContent = 'Apply';
        card.appendChild(el('div', 'ops-error', error.message || 'Office would not accept that change.'));
        // A guard refused the plan outright (a preview, or another app's change), so a
        // repaint must not try it again either.
        appliedPlans[key] = { done: true, reached: false, note: error.message || 'That change was not applied.', button: button };
        setStatus('The change was not applied.', true);
      });
  }

  /* Writing to the file ---------------------------------------------------- */

  /** The app named in a failure, so the sentence reads "Excel would not accept that change." */
  var APPLIER_NAMES = { excel: 'Excel', word: 'Word', powerpoint: 'PowerPoint' };

  /**
   * Run a plan one operation at a time, so one refusal cannot cancel the rest.
   *
   * Office throws away a whole batch when a single call in it is wrong, which used to
   * leave the file untouched and answer with one sentence that named no operation.
   * Each operation therefore goes through its applier on its own, in the order the
   * plan lists them.
   * @param {Array<object>} operations
   * @param {string} host The app these operations belong to: excel, word or powerpoint.
   * @param {function(Array<object>): Promise<Array>} applier Writes exactly one operation.
   * @param {function(object): Promise<void>} [preflight] Refuses a doomed operation first.
   * @returns {Promise<{ applied: string[], failures: Array<{ description: string, message: string }> }>}
   */
  function runPlanOneByOne(operations, host, applier, preflight) {
    var applied = [];
    var failures = [];
    var chain = Promise.resolve();

    for (var index = 0; index < operations.length; index += 1) {
      // A plan may mix apps, so this app carries out its own lines and leaves the rest.
      if (hostFor(operations[index]) !== host) continue;
      chain = chain.then(runPlanStep(operations[index], host, applier, preflight, applied, failures));
    }

    return chain.then(function () {
      return { applied: applied, failures: failures };
    });
  }

  /**
   * One operation of a plan, as a step the chain above waits for.
   *
   * The failure handler belongs to the same promise as the success handler, so a
   * refusal is recorded and the operations after it still run.
   * @param {object} operation
   * @param {string} host
   * @param {function(Array<object>): Promise<Array>} applier
   * @param {function(object): Promise<void>|undefined} preflight
   * @param {string[]} applied
   * @param {Array<{ description: string, message: string }>} failures
   * @returns {function(): Promise<void>}
   */
  function runPlanStep(operation, host, applier, preflight, applied, failures) {
    return function () {
      var refusal = preflight ? preflight(operation) : Promise.resolve();
      return refusal.then(function () {
        return applier([operation]);
      }).then(function () {
        applied.push(ZuriOps.describeOperation(operation));
      }, function (error) {
        failures.push({
          description: ZuriOps.describeOperation(operation),
          message: officeMessage(error, APPLIER_NAMES[host] + ' would not accept that change.'),
        });
      });
    };
  }

  /**
   * Skip a chart or a table whose source range holds nothing.
   *
   * Excel answers such a request with an argument error that names no cause, and a
   * chart of empty cells is never what was asked for, so the range is read first and
   * the operation is refused with a reason a person can act on.
   * @param {object} operation
   * @returns {Promise<void>} Rejects with a plain reason when the range is empty.
   */
  function checkExcelSource(operation) {
    if (operation.op !== 'addChart' && operation.op !== 'createTable') return Promise.resolve();
    return excelSourceIsEmpty(operation).then(function (empty) {
      if (!empty) return;
      throw new Error(operation.op === 'addChart'
        ? 'that range has no data yet, so there is nothing to chart.'
        : 'that range has no data yet, so there is nothing to make a table from.');
    });
  }

  /**
   * Whether every cell in the range holds nothing.
   *
   * A range that cannot be read answers "no": the operation that follows reports its
   * own refusal, which says more than a guess made here.
   * @param {object} operation
   * @returns {Promise<boolean>}
   */
  function excelSourceIsEmpty(operation) {
    return Excel.run(function (context) {
      var sheet = operation.sheet === '' ? context.workbook.worksheets.getActiveWorksheet() : context.workbook.worksheets.getItem(operation.sheet);
      var range = sheet.getRange(operation.range).load('values');
      return context.sync().then(function () {
        var values = range.values || [];
        for (var row = 0; row < values.length; row += 1) {
          var line = values[row] || [];
          for (var column = 0; column < line.length; column += 1) {
            var cell = line[column];
            if (cell !== '' && cell !== null && cell !== undefined) return false;
          }
        }
        return true;
      });
    }).catch(function () {
      return false;
    });
  }

  function applyOperations(operations) {
    if (previewHost !== '') {
      return Promise.reject(new Error('This is a preview, so nothing is written to a file.'));
    }
    // A plan written for another app must not half-apply: the pane stops before
    // dispatching rather than skipping the operations it does not recognise.
    var wanted = state.host.toLowerCase();
    for (var index = 0; index < operations.length; index += 1) {
      var owner = hostFor(operations[index]);
      if (owner !== '' && owner !== wanted) {
        return Promise.reject(new Error('That change was written for another Office app, so nothing was applied.'));
      }
    }
    if (state.host === 'Excel') return runPlanOneByOne(operations, 'excel', applyExcel, checkExcelSource);
    if (state.host === 'PowerPoint') return runPlanOneByOne(operations, 'powerpoint', applyPowerPoint);
    return runPlanOneByOne(operations, 'word', applyWord);
  }

  function hostFor(operation) {
    return ZuriOps.OPERATIONS[operation.op];
  }

  /** The chart names Excel's own API expects, for the short names a plan uses. */
  var CHART_KINDS = {
    column: 'ColumnClustered',
    bar: 'BarClustered',
    line: 'Line',
    pie: 'Pie',
    area: 'Area',
    scatter: 'XYScatter',
  };

  function applyExcel(operations) {
    return Excel.run(function (context) {
      var applied = [];
      for (var index = 0; index < operations.length; index += 1) {
        var operation = operations[index];
        if (hostFor(operation) !== 'excel') continue;
        var sheet;
        try {
          sheet = operation.sheet ? context.workbook.worksheets.getItem(operation.sheet) : context.workbook.worksheets.getActiveWorksheet();
        } catch (error) {
          throw new Error('There is no sheet called "' + operation.sheet + '".');
        }

        if (operation.op === 'addWorksheet') {
          var added = context.workbook.worksheets.add(operation.name);
          if (operation.activate) added.activate();
          applied.push(operation);
          continue;
        }

        var range = sheet.getRange(operation.range);

        if (operation.op === 'setValues' || operation.op === 'setFormulas') {
          // Write to the exact range when the reviewed matrix matches it. Older
          // plans use the range as an anchor for a shorter generated grid, so keep
          // the resized fallback for that explicitly supported shape.
          var exactShape = operation.grid.length === operation.rangeRows && operation.grid[0].length === operation.rangeColumns;
          var target = exactShape ? range : sheet.getRange(operation.range.split(':')[0]).getResizedRange(operation.grid.length - 1, operation.grid[0].length - 1);
          if (operation.op === 'setFormulas') target.formulas = operation.grid;
          else target.values = operation.grid;
        } else if (operation.op === 'setNumberFormat') {
          // Office.js expects numberFormat to be a matrix matching the range shape.
          var formatRows = operation.rangeRows || 1;
          var formatColumns = operation.rangeColumns || 1;
          range.numberFormat = Array.from({ length: formatRows }, function () {
            return Array.from({ length: formatColumns }, function () { return operation.format; });
          });
        } else if (operation.op === 'format') {
          if (operation.bold !== undefined) range.format.font.bold = operation.bold;
          if (operation.italic !== undefined) range.format.font.italic = operation.italic;
          if (operation.fill !== undefined) range.format.fill.color = operation.fill;
          if (operation.color !== undefined) range.format.font.color = operation.color;
          if (operation.size !== undefined) range.format.font.size = operation.size;
          if (operation.wrapText !== undefined) range.format.wrapText = operation.wrapText;
          if (operation.align !== undefined) {
            var alignments = { left: 'Left', center: 'Center', right: 'Right', general: 'General' };
            range.format.horizontalAlignment = alignments[operation.align] || 'General';
          }
        } else if (operation.op === 'columnWidth') {
          // Set on the range itself: this is the documented way to size the columns a
          // range touches, and it skips getEntireColumn(), one more host call that can
          // fail on its own and leave the width unchanged.
          range.format.columnWidth = operation.width;
        } else if (operation.op === 'autofit') {
          range.format.autofitColumns();
          range.format.autofitRows();
        } else if (operation.op === 'clear') {
          range.clear('Contents');
        } else if (operation.op === 'createTable') {
          var table = context.workbook.tables.add(range, operation.hasHeaders !== false);
          if (operation.name) table.name = operation.name;
        } else if (operation.op === 'addChart') {
          var chart = sheet.charts.add(CHART_KINDS[operation.chartType] || 'ColumnClustered', range, 'Auto');
          if (operation.title) chart.title.text = operation.title;
          // Office places the chart where it is told, which is beside the data by default.
          chart.setPosition(operation.at);
        }
        applied.push(operation);
      }
      return context.sync().then(function () {
        return applied.map(function (operation) { return ZuriOps.describeOperation(operation); });
      });
    }, function (error) {
      throw new Error(officeMessage(error, 'Excel would not accept that change.'));
    });
  }

  function applyWord(operations) {
    return Word.run(function (context) {
      var applied = [];
      var searches = [];
      var body = context.document.body;
      var selection = context.document.getSelection();

      for (var index = 0; index < operations.length; index += 1) {
        var operation = operations[index];
        if (hostFor(operation) !== 'word') continue;

        if (operation.op === 'replaceSelection') {
          selection.insertText(operation.text, 'Replace');
        } else if (operation.op === 'insertAfterSelection') {
          selection.insertParagraph(operation.text, 'After');
        } else if (operation.op === 'insertParagraphs') {
          var where = operation.where === 'start' ? 'Start'
            : operation.where === 'afterSelection' ? 'After'
              : operation.where === 'replaceSelection' ? 'Replace'
                : 'End';
          var anchor = where === 'After' || where === 'Replace' ? selection : body;
          for (var p = 0; p < operation.paragraphs.length; p += 1) {
            var paragraph = operation.paragraphs[p];
            anchor = anchor.insertParagraph(paragraph.text, where);
            applyWordStyle(anchor, paragraph.style);
            // Later paragraphs follow the one just written, or they arrive in reverse.
            where = 'After';
          }
        } else if (operation.op === 'applyStyle') {
          applyWordStyle(selection, operation.style);
        } else if (operation.op === 'replaceAll') {
          searches.push({ found: body.search(operation.find, { matchCase: operation.matchCase }), replace: operation.replace });
        } else if (operation.op === 'insertTable') {
          var tableWhere = operation.where === 'start' ? 'Start' : operation.where === 'afterSelection' ? 'After' : 'End';
          var tableAnchor = tableWhere === 'After' ? selection : body;
          tableAnchor.insertTable(operation.grid.length, operation.grid[0].length, tableWhere, operation.grid);
        }
        applied.push(operation);
      }

      searches.forEach(function (entry) { entry.found.load('items'); });

      return context.sync().then(function () {
        searches.forEach(function (entry) {
          entry.found.items.forEach(function (range) { range.insertText(entry.replace, 'Replace'); });
        });
        return context.sync().then(function () {
          return applied.map(function (operation) { return ZuriOps.describeOperation(operation); });
        });
      });
    }, function (error) {
      throw new Error(officeMessage(error, 'Word would not accept that change.'));
    });
  }

  // Built-in Word styles are portable only through styleBuiltIn. Assigning a
  // display name such as "Heading 1" through paragraph.style can make desktop
  // Word reject the whole batch, leaving even the plain text unwritten.
  function applyWordStyle(paragraph, requestedStyle) {
    var key = String(requestedStyle || '').trim().toLowerCase().replace(/[ _-]+/g, '');
    var builtIn = {
      normal: 'Normal',
      nospacing: 'NoSpacing',
      heading1: 'Heading1',
      heading2: 'Heading2',
      heading3: 'Heading3',
      heading4: 'Heading4',
      heading5: 'Heading5',
      heading6: 'Heading6',
      heading7: 'Heading7',
      heading8: 'Heading8',
      heading9: 'Heading9',
      title: 'Title',
      subtitle: 'Subtitle',
      quote: 'Quote',
      intensequote: 'IntenseQuote',
      subtleemphasis: 'SubtleEmphasis',
      emphasis: 'Emphasis',
      intenseemphasis: 'IntenseEmphasis',
      listparagraph: 'ListParagraph',
    }[key];
    if (builtIn) paragraph.styleBuiltIn = builtIn;
  }

  function applyPowerPoint(operations) {
    var replaceSelection = null;
    var rest = [];
    for (var index = 0; index < operations.length; index += 1) {
      if (operations[index].op === 'setSelectedText') replaceSelection = operations[index];
      else if (hostFor(operations[index]) === 'powerpoint') rest.push(operations[index]);
    }

    var chain = Promise.resolve([]);
    if (replaceSelection !== null) {
      chain = new Promise(function (resolve, reject) {
        Office.context.document.setSelectedDataAsync(replaceSelection.text, { coercionType: Office.CoercionType.Text }, function (result) {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve([replaceSelection]);
          else reject(new Error('PowerPoint would not replace the selected text.'));
        });
      });
    }
    if (rest.length === 0) return chain;

    if (!supported('PowerPointApi', '1.2')) {
      return chain.then(function (applied) {
        if (applied.length > 0) {
          setStatus('PowerPoint on this machine only allows replacing selected text. Update Office for the rest.');
          return applied;
        }
        throw new Error('This version of PowerPoint cannot add or change slides. Updating Office enables it.');
      });
    }

    return chain.then(function (applied) {
      return PowerPoint.run(function (context) {
        var slides = context.presentation.slides;
        var byIndex = {};

        function slideAt(number) {
          if (byIndex[number]) return byIndex[number];
          var slide = number > 0 ? slides.getItemAt(number - 1) : slides.getItemAt(0);
          byIndex[number] = slide;
          return slide;
        }

        rest.forEach(function (operation) {
          if (operation.op === 'addSlide') {
            var slide = slides.add();
            if (operation.title) placeBox(slide, operation.title, 36, 28, 560, 60, 26, true);
            if (operation.body) placeBox(slide, operation.body, 36, 104, 560, 260, 16, false);
            return;
          }
          var target = slideAt(operation.slide || 1);
          if (operation.op === 'setSlideTitle') {
            var titleShapes = target.shapes;
            titleShapes.load('items/name');
            var title = titleShapes.items.filter(function (shape) { return /^title/i.test(shape.name); })[0];
            if (title) title.textFrame.textRange.text = operation.title;
            else placeBox(target, operation.title, 36, 28, 560, 60, 26, true);
            return;
          }
          if (operation.op === 'setShapeText') {
            var shapes = target.shapes;
            shapes.load('items/name');
            var match = null;
            for (var s = 0; s < shapes.items.length; s += 1) {
              var shape = shapes.items[s];
              if (operation.shape === '' || shape.name === operation.shape || (match === null && shape.name.toLowerCase().indexOf(operation.shape.toLowerCase()) !== -1)) {
                match = shape;
                if (operation.shape !== '' && shape.name === operation.shape) break;
              }
            }
            if (match === null) throw new Error('Slide ' + (operation.slide || 1) + ' has no shape called "' + operation.shape + '".');
            match.textFrame.textRange.text = operation.text;
            return;
          }
          if (operation.op === 'addTextBox') {
            placeBox(target, operation.text, operation.left === undefined ? 40 : operation.left, operation.top === undefined ? 120 : operation.top, operation.width === undefined ? 540 : operation.width, operation.height === undefined ? 120 : operation.height, operation.size || 16, operation.bold === true);
          }
        });

        return context.sync().then(function () {
          return applied.concat(rest).map(function (operation) { return ZuriOps.describeOperation(operation); });
        });
      }, function (error) {
        throw new Error(officeMessage(error, 'PowerPoint would not accept that change.'));
      });
    });
  }

  function placeBox(slide, text, left, top, width, height, size, bold) {
    var box = slide.shapes.addTextBox(text);
    box.left = left;
    box.top = top;
    box.width = width;
    box.height = height;
    try {
      box.textFrame.textRange.font.size = size;
      box.textFrame.textRange.font.bold = bold;
    } catch (error) {
      // Styling is a nicety: the text is what matters, so a font failure is not fatal.
    }
    return box;
  }

  /** "1 change", "2 changes": a count that reads as a sentence. */
  function countChanges(count) {
    return count + ' change' + (count === 1 ? '' : 's');
  }

  /** "Set the column width of H1" only reads after "Could not " once it is lowercase. */
  function lowerFirst(text) {
    var value = String(text === undefined || text === null ? '' : text);
    return value === '' ? value : value.charAt(0).toLowerCase() + value.slice(1);
  }

  function officeMessage(error, fallback) {
    if (error && typeof error.message === 'string' && error.message.trim() !== '') return error.message;
    return fallback;
  }

  /* Talking to Zuri -------------------------------------------------------- */

  function sendMessage() {
    var text = pane.prompt.value.trim();
    if (text === '' || state.streaming) return;
    // Without a host there is no file to work on, and a request sent anyway would be
    // answered as if it were about a Word document.
    if (state.host === '') {
      setStatus('Zuri is not connected to Office yet. Press Try again above.', true);
      return;
    }

    pane.prompt.value = '';
    autosize();
    state.messages.push({ role: 'user', content: text });
    renderThread();
    scrollToEnd(true);

    setStatus('Reading the file...');
    readContext()
      .then(function (context) {
        state.context = context;
        pane.contextText.textContent = context.label;
        setStatus('');
        startStream(context.text);
      })
      .catch(function (error) {
        // A document the pane cannot read is still worth answering: the person asked
        // a question, and the model can say what it needs.
        setStatus(error.message || 'Zuri could not read the file.', true);
        startStream('');
      });
  }

  function startStream(contextText) {
    state.streaming = true;
    toggleComposer(true);
    setStatus('Zuri is working...');

    var message = { role: 'assistant', content: '' };
    state.messages.push(message);
    var node = el('div', 'msg msg-assistant streaming');
    node.appendChild(el('span', 'caption', 'Zuri'));
    var body = el('div');
    node.appendChild(body);
    pane.empty.classList.add('is-hidden');
    pane.thread.appendChild(node);
    state.streamNode = body;
    // Paint the waiting state before the first network token arrives. Without this,
    // a slow provider leaves a blank assistant row even though the request is active.
    paintAssistant(body, message);
    scrollToEnd(true);

    var controller = new AbortController();
    state.controller = controller;

    var history = state.messages
      .slice(0, -1)
      .slice(-STORED_TURNS)
      .map(function (entry) { return { role: entry.role, content: entry.content }; });

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zuri-token': token },
      body: JSON.stringify({ host: state.host.toLowerCase(), context: contextText, messages: history }),
      signal: controller.signal,
    })
      .then(function (response) {
        if (!response.ok || !response.body) throw new Error('Zuri could not answer that. Try again.');
        return readStream(response, message);
      })
      .then(function () {
        if (message.content.trim() === '') message.content = 'Zuri sent an empty reply. Try again.';
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') {
          if (message.content.trim() === '') message.content = 'Stopped.';
          return;
        }
        if (message.content.trim() === '') state.messages.pop();
        setStatus(error.message || 'Zuri could not answer that.', true);
      })
      .then(function () {
        state.streaming = false;
        state.controller = null;
        node.classList.remove('streaming');
        paintAssistant(node, message);
        toggleComposer(false);
        if (state.messages[state.messages.length - 1] === message) remember();
        scrollToEnd(true);
        pane.prompt.focus();
      });
  }

  /** Read the server's event stream: deltas, a status line, the end, or an error. */
  function readStream(response, message) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function frame(chunk) {
      buffer += chunk;
      var parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (var index = 0; index < parts.length; index += 1) handle(parts[index]);
    }

    function handle(raw) {
      var line = raw.split('\n').filter(function (entry) { return entry.indexOf('data:') === 0; })[0];
      if (!line) return;
      var payload;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch (error) {
        return;
      }
      if (typeof payload.delta === 'string') {
        message.content += payload.delta;
        paintAssistant(state.streamNode, message);
        scrollToEnd(false);
        return;
      }
      if (typeof payload.status === 'string' && payload.status !== '') {
        setStatus(payload.status);
        return;
      }
      if (payload.error) {
        throw new Error(payload.error.message || 'Zuri could not answer that.');
      }
      if (payload.done === true) {
        if (typeof payload.text === 'string' && payload.text.trim() !== '') message.content = payload.text;
        if (typeof payload.model === 'string' && payload.model !== '') {
          state.model = payload.model;
          pane.modelLabel.textContent = payload.model;
        }
        setStatus('');
      }
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buffer.trim() !== '') handle(buffer);
          return;
        }
        frame(decoder.decode(result.value, { stream: true }));
        return pump();
      });
    }

    return pump();
  }

  function remember() {
    var url = documentUrl();
    if (url === '') return;
    try {
      window.localStorage.setItem('zuri.addin.' + state.host, JSON.stringify({ url: url, messages: state.messages.slice(-STORED_TURNS), model: state.model }));
    } catch (error) {
      // A full or blocked store is not worth an error: the chat still works.
    }
  }

  function restore() {
    var url = documentUrl();
    if (url === '') return;
    try {
      var saved = JSON.parse(window.localStorage.getItem('zuri.addin.' + state.host) || 'null');
      // A chat belongs to the file it was about: opening another document starts clean.
      if (!saved || saved.url !== url || !Array.isArray(saved.messages)) return;
      state.messages = saved.messages.filter(function (entry) {
        return entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string';
      });
      state.model = typeof saved.model === 'string' ? saved.model : '';
      if (state.model !== '') pane.modelLabel.textContent = state.model;
    } catch (error) {
      state.messages = [];
    }
  }

  /**
   * Record every plan a restored conversation already applied.
   *
   * The cards are drawn again when the pane opens, and in "Always allow" mode a card
   * applies its plan, so without this a reload would write those changes to the file
   * a second time.
   * @returns {void}
   */
  function markRestoredPlans() {
    for (var index = 0; index < state.messages.length; index += 1) {
      var segments = ZuriOps.splitReply(state.messages[index].content);
      for (var part = 0; part < segments.length; part += 1) {
        if (segments[part].type !== 'ops' || segments[part].result.ok !== true) continue;
        var key = planKey(segments[part].result);
        if (appliedPlans[key]) continue;
        appliedPlans[key] = { done: true, reached: true, note: 'Applied earlier in this chat.', button: null };
      }
    }
  }

  function documentUrl() {
    try {
      return (Office.context.document.url || '').split('#')[0];
    } catch (error) {
      return '';
    }
  }

  /* The screen ------------------------------------------------------------- */

  var COPY = {
    Excel: {
      title: 'What should we do in this sheet?',
      line: 'Zuri can fill a column with formulas, tidy a table, total things up, or build a summary. Ask for as much as you like.',
      suggestions: [
        'Fill the remaining column with formulas that match the rows above',
        'Total each type on a new Summary sheet',
        'Check my formulas for mistakes and fix them',
        'Make this table easier to read: headers, number formats, widths',
        'Draw a column chart of the main numbers',
      ],
    },
    Word: {
      title: 'What should we write?',
      line: 'Zuri can rewrite a section, restructure the whole document, or draft something new in the style you already use.',
      suggestions: [
        'Rewrite the selected text more formally',
        'Turn this into a one-page brief with headings',
        'Tighten every paragraph by a quarter without losing facts',
        'Add a summary table of the key numbers at the end',
      ],
    },
    PowerPoint: {
      title: 'What should we change in this deck?',
      line: 'Zuri can add a slide, rewrite a slide so it reads cleanly, or put the key numbers into a closing slide.',
      suggestions: [
        'Rewrite this slide so the message is clear in one line',
        'Add a closing slide with the three main points',
        'Turn the selected text into five short bullets',
        'Write a title slide for this deck',
      ],
    },
  };

  /** Shown when Office has not named the app: no host, so no promise is made about one. */
  var UNKNOWN_COPY = {
    title: 'Zuri cannot tell which Office app this is',
    line: 'Office has not said whether this is Word, Excel or PowerPoint, so Zuri will not touch the file. Try again, or close this pane and open it from the Zuri button on the ribbon.',
    suggestions: [],
  };

  /** The pane opened before Office answered; ask again without closing it. */
  function retryHost() {
    var host = detectHost(null);
    if (host === '') {
      setStatus('Office still has not said which app this is. Close the pane and open it again from the ribbon.', true);
      return;
    }
    setStatus('');
    startPane();
  }

  function paintHostCopy() {
    var copy = COPY[state.host] || UNKNOWN_COPY;
    pane.emptyTitle.textContent = copy.title;
    pane.emptyLine.textContent = copy.line;
    pane.suggestions.textContent = '';

    if (state.host === '') {
      var again = el('button', 'suggestion', 'Try again');
      again.type = 'button';
      again.addEventListener('click', retryHost);
      pane.suggestions.appendChild(again);
      return;
    }

    copy.suggestions.forEach(function (suggestion) {
      var button = el('button', 'suggestion', suggestion);
      button.type = 'button';
      button.addEventListener('click', function () {
        pane.prompt.value = suggestion;
        autosize();
        pane.prompt.focus();
        pane.send.disabled = false;
      });
      pane.suggestions.appendChild(button);
    });
  }

  function renderThread() {
    pane.thread.textContent = '';
    if (state.messages.length === 0) {
      pane.thread.appendChild(pane.empty);
      pane.empty.classList.remove('is-hidden');
      return;
    }
    pane.empty.classList.add('is-hidden');
    for (var index = 0; index < state.messages.length; index += 1) {
      pane.thread.appendChild(buildMessage(state.messages[index]));
    }
    scrollToEnd(false);
  }

  function toggleComposer(busy) {
    pane.send.classList.toggle('is-hidden', busy);
    pane.stop.classList.toggle('is-hidden', !busy);
    pane.prompt.disabled = busy;
    pane.refreshContext.disabled = busy;
    pane.send.disabled = busy || pane.prompt.value.trim() === '';
  }

  function autosize() {
    pane.prompt.style.height = 'auto';
    var height = Math.min(pane.prompt.scrollHeight, 132);
    pane.prompt.style.height = height + 'px';
    pane.prompt.style.overflowY = pane.prompt.scrollHeight > 132 ? 'auto' : 'hidden';
  }

  function refreshContext() {
    if (state.host === '') {
      pane.contextText.textContent = 'Waiting for Office';
      pane.refreshContext.disabled = false;
      return;
    }
    pane.refreshContext.disabled = true;
    pane.contextText.textContent = 'Reading the file...';
    readContext()
      .then(function (context) {
        state.context = context;
        pane.contextText.textContent = context.label;
        setStatus('');
      })
      .catch(function (error) {
        pane.contextText.textContent = 'The file could not be read';
        setStatus(error.message || 'Zuri could not read the file.', true);
      })
      .then(function () {
        pane.refreshContext.disabled = state.streaming;
      });
  }

  function newChat() {
    if (state.streaming && state.controller) state.controller.abort();
    state.messages = [];
    // A new chat is a fresh start, so a change applied in the old one can be asked
    // for again here.
    appliedPlans = {};
    state.model = '';
    pane.modelLabel.textContent = '';
    setStatus('');
    renderThread();
    try {
      window.localStorage.removeItem('zuri.addin.' + state.host);
    } catch (error) {
      // Nothing to do: the conversation is already gone from the screen.
    }
    pane.prompt.focus();
  }

  function startPane() {
    pane.hostLabel.textContent = previewHost !== '' ? 'Preview (' + state.host + ')'
      : state.host === '' ? 'Waiting for Office'
        : state.host;
    pane.prompt.placeholder = state.host === 'Excel' ? 'Ask Zuri to change this sheet'
      : state.host === 'PowerPoint' ? 'Ask Zuri to change this slide'
        : state.host === 'Word' ? 'Ask Zuri to change this document'
          : 'Ask Zuri to change this file';
    paintHostCopy();
    restore();
    // Restored cards are marked as already applied before they are drawn, so opening
    // the pane never writes those changes to the file again.
    markRestoredPlans();
    renderThread();

    // A retry after a slow start reuses the screen, so the listeners are wired only once.
    if (wired === true) {
      refreshContext();
      return;
    }
    wired = true;

    // The standing answer to "may I change the file", restored on every open.
    writeEditsMode(readEditsMode());
    if (pane.edits) {
      pane.edits.addEventListener('change', function () {
        writeEditsMode(pane.edits.value);
        setStatus(state.edits === 'always'
          ? 'Zuri will apply its changes to this file without asking.'
          : 'Zuri will ask before changing this file.');
      });
    }

    pane.send.addEventListener('click', sendMessage);
    pane.stop.addEventListener('click', function () {
      if (state.controller) state.controller.abort();
    });
    pane.refreshContext.addEventListener('click', refreshContext);
    pane.newChat.addEventListener('click', newChat);
    pane.prompt.addEventListener('input', function () {
      autosize();
      pane.send.disabled = pane.prompt.value.trim() === '';
    });
    pane.prompt.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    pane.send.disabled = true;
    autosize();
    refreshContext();
  }

  function boot() {
    if (previewHost !== '') {
      state.host = normaliseHostName(previewHost) || 'Word';
      startPane();
      return;
    }

    var opened = false;
    var poll = 0;
    var deadline = 0;

    function open(info) {
      if (opened) return;
      var host = detectHost(info);
      if (host === '') return;
      opened = true;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      state.host = host;
      startPane();
    }

    if (typeof Office !== 'undefined' && typeof Office.onReady === 'function') {
      Office.onReady(open);
    }
    // office.js comes from Microsoft's servers, so onReady can be late or never arrive at
    // all. The other sources are polled meanwhile rather than guessed at.
    poll = window.setInterval(function () { open(null); }, 250);
    deadline = window.setTimeout(function () {
      if (opened) return;
      opened = true;
      window.clearInterval(poll);
      state.host = '';
      startPane();
      setStatus('Office has not said which app this is. Close this pane and open it again from the Zuri button.', true);
    }, 15000);
  }

  boot();
})();
