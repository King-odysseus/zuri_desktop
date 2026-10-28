/* Zuri task pane for Word, Excel and PowerPoint. Plain browser script: Office's web view has no module loader. */
(function () {
  var token = document.querySelector('meta[name="zuri-token"]').content;
  var promptBox = document.getElementById('prompt');
  var contextBox = document.getElementById('context');
  var refreshContextButton = document.getElementById('refresh-context');
  var answerBox = document.getElementById('answer');
  var askButton = document.getElementById('ask');
  var replaceButton = document.getElementById('replace');
  var insertButton = document.getElementById('insert');
  var statusText = document.getElementById('status');
  // Set by Office.onReady; decides which Office API reads and writes the file.
  var host = '';

  function setStatus(text, isError) {
    statusText.textContent = text;
    statusText.className = isError ? 'error' : '';
  }

  function refreshActions() {
    var hasAnswer = answerBox.value.trim() !== '';
    replaceButton.disabled = !hasAnswer;
    insertButton.disabled = !hasAnswer;
  }

  function refreshContext() {
    refreshContextButton.disabled = true;
    setStatus('Reading the selection...', false);
    return readContext()
      .then(function (text) {
        contextBox.value = text;
        setStatus(text.trim() === '' ? 'Nothing selected in the document.' : 'Context refreshed.', false);
        return text;
      })
      .catch(function (error) {
        setStatus(error.message || 'Office would not provide the file text.', true);
        throw error;
      })
      .then(function (text) {
        refreshContextButton.disabled = false;
        return text;
      }, function (error) {
        refreshContextButton.disabled = false;
        throw error;
      });
  }

  // The selection when there is one, otherwise the whole body, sheet or slide.
  function readContext() {
    if (host === 'Excel') return readExcel();
    if (host === 'PowerPoint') return readSelectedText();
    return readWord();
  }

  function readWord() {
    return Word.run(function (context) {
      var selection = context.document.getSelection();
      selection.load('text');
      var body = context.document.body;
      body.load('text');
      return context.sync().then(function () {
        return selection.text.trim() !== '' ? selection.text : body.text;
      });
    });
  }

  function rowsToText(rows) {
    return rows.map(function (row) { return row.join('\t'); }).join('\n');
  }

  function readExcel() {
    return Excel.run(function (context) {
      var selection = context.workbook.getSelectedRange();
      selection.load('text');
      var used = context.workbook.worksheets.getActiveWorksheet().getUsedRangeOrNullObject();
      used.load('text');
      return context.sync().then(function () {
        var picked = rowsToText(selection.text);
        if (picked.replace(/\s/g, '') !== '' || used.isNullObject) return picked;
        return rowsToText(used.text);
      });
    });
  }

  // PowerPoint only exposes the selected text through the common API.
  function readSelectedText() {
    return new Promise(function (resolve, reject) {
      Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, function (result) {
        if (result.status !== Office.AsyncResultStatus.Succeeded) reject(new Error('PowerPoint would not provide the selected text.'));
        else resolve(String(result.value || ''));
      });
    });
  }

  function ask() {
    var prompt = promptBox.value.trim();
    if (prompt === '') {
      setStatus('Type what you want Zuri to do first.', true);
      return;
    }
    askButton.disabled = true;
    setStatus('Zuri is working...', false);
    refreshContext()
      .then(function (text) {
        return fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zuri-token': token },
          body: JSON.stringify({ prompt: prompt, context: text }),
        });
      })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result.ok) throw new Error((result.error && result.error.message) || 'Zuri could not answer.');
        answerBox.value = result.data.text;
        setStatus('Done. Edit the answer if you like, then use it.', false);
      })
      .catch(function (error) { setStatus(error.message || 'Zuri could not answer.', true); })
      .then(function () {
        askButton.disabled = false;
        refreshActions();
      });
  }

  function place(mode) {
    var text = answerBox.value;
    if (text.trim() === '') return;
    var done;
    if (host === 'Excel') done = placeInExcel(text, mode);
    else if (host === 'PowerPoint') done = placeInPowerPoint(text);
    else done = placeInWord(text, mode);
    done.catch(function () { setStatus('Office would not accept that change.', true); });
  }

  function placeInWord(text, mode) {
    return Word.run(function (context) {
      var selection = context.document.getSelection();
      if (mode === 'replace') selection.insertText(text, 'Replace');
      else selection.insertParagraph(text, 'After');
      return context.sync();
    });
  }

  // A multi-line answer fills one row per line, tab-separated text fills columns.
  function placeInExcel(text, mode) {
    var rows = text.split('\n').map(function (line) { return line.split('\t'); });
    var width = Math.max.apply(null, rows.map(function (row) { return row.length; }));
    rows = rows.map(function (row) { while (row.length < width) row.push(''); return row; });
    return Excel.run(function (context) {
      var selection = context.workbook.getSelectedRange();
      var start = mode === 'replace' ? selection.getCell(0, 0) : selection.getLastRow().getOffsetRange(1, 0).getCell(0, 0);
      start.getResizedRange(rows.length - 1, width - 1).values = rows;
      return context.sync();
    });
  }

  // PowerPoint can only replace the selected text, so "Insert below" does the same.
  function placeInPowerPoint(text) {
    return new Promise(function (resolve, reject) {
      Office.context.document.setSelectedDataAsync(text, { coercionType: Office.CoercionType.Text }, function (result) {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
        else reject(new Error('PowerPoint would not accept that change.'));
      });
    });
  }

  Office.onReady(function (info) {
    host = info && info.host === Office.HostType.Excel ? 'Excel' : info && info.host === Office.HostType.PowerPoint ? 'PowerPoint' : 'Word';
    askButton.addEventListener('click', ask);
    refreshContextButton.addEventListener('click', function () { refreshContext(); });
    replaceButton.addEventListener('click', function () { place('replace'); });
    insertButton.addEventListener('click', function () { place('insert'); });
    answerBox.addEventListener('input', refreshActions);
    refreshContext();
  });
})();
