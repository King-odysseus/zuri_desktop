/* Zuri task pane for Word. Plain browser script: Word's web view has no module loader. */
(function () {
  var token = document.querySelector('meta[name="zuri-token"]').content;
  var promptBox = document.getElementById('prompt');
  var answerBox = document.getElementById('answer');
  var askButton = document.getElementById('ask');
  var replaceButton = document.getElementById('replace');
  var insertButton = document.getElementById('insert');
  var statusText = document.getElementById('status');

  function setStatus(text, isError) {
    statusText.textContent = text;
    statusText.className = isError ? 'error' : '';
  }

  function refreshActions() {
    var hasAnswer = answerBox.value.trim() !== '';
    replaceButton.disabled = !hasAnswer;
    insertButton.disabled = !hasAnswer;
  }

  // The selection when there is one, otherwise the whole body.
  function readContext() {
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

  function ask() {
    var prompt = promptBox.value.trim();
    if (prompt === '') {
      setStatus('Type what you want Zuri to do first.', true);
      return;
    }
    askButton.disabled = true;
    setStatus('Zuri is working...', false);
    readContext()
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
    Word.run(function (context) {
      var selection = context.document.getSelection();
      if (mode === 'replace') selection.insertText(text, 'Replace');
      else selection.insertParagraph(text, 'After');
      return context.sync();
    }).catch(function () { setStatus('Word would not accept that change.', true); });
  }

  Office.onReady(function () {
    askButton.addEventListener('click', ask);
    replaceButton.addEventListener('click', function () { place('replace'); });
    insertButton.addEventListener('click', function () { place('insert'); });
    answerBox.addEventListener('input', refreshActions);
  });
})();
