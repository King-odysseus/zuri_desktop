/*
 * Small, deterministic intelligence helpers for the Office pane.
 *
 * The model still receives the full context when a message is sent. This module
 * only turns facts the pane already read into useful starter prompts, so a slow or
 * unavailable provider cannot make the pane feel empty and no write can happen here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ZuriIntelligence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HOSTS = ['Excel', 'Word', 'PowerPoint'];

  function normaliseHost(host) {
    var value = String(host || '').trim().toLowerCase();
    if (value === 'excel') return 'Excel';
    if (value === 'word') return 'Word';
    if (value === 'powerpoint') return 'PowerPoint';
    return '';
  }

  function hasSelection(context) {
    return /(?:Selected cells|Selected text):\s*\n?\s*(?!\(nothing selected\)|$)/i.test(String(context || ''));
  }

  function hasSeveralSheets(context) {
    var match = /^Workbook sheets:\s*(.+?)\.$/im.exec(String(context || ''));
    return match !== null && match[1].split(',').map(function (name) { return name.trim(); }).filter(Boolean).length > 1;
  }

  function hasFormulas(context) {
    return /Existing formulas:/i.test(String(context || ''));
  }

  function hasTables(context) {
    return /Excel tables on this sheet:/i.test(String(context || ''));
  }

  function paragraphCount(context) {
    var match = /The document has (\d+) paragraphs\./i.exec(String(context || ''));
    return match === null ? 0 : Number(match[1]);
  }

  function slideCount(context) {
    var match = /The deck has (\d+) slides\./i.exec(String(context || ''));
    return match === null ? 0 : Number(match[1]);
  }

  function unique(items) {
    var seen = {};
    return items.filter(function (item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    }).slice(0, 4);
  }

  /**
   * Build starter prompts from the facts already loaded from Office.
   * @param {string} host
   * @param {string} context
   * @returns {string[]}
   */
  function getSmartSuggestions(host, context) {
    var normalised = normaliseHost(host);
    if (HOSTS.indexOf(normalised) === -1) return [];

    var text = String(context || '').replace(/\\n/g, '\n');
    var suggestions = [];
    if (normalised === 'Excel') {
      if (hasFormulas(text)) suggestions.push('Check the existing formulas for errors and explain any suspicious cells');
      if (hasSeveralSheets(text)) suggestions.push('Compare the important totals across the workbook and flag differences');
      if (hasTables(text)) suggestions.push('Review the tables for missing values, duplicates, and inconsistent formatting');
      if (hasSelection(text)) suggestions.push('Explain the selected cells and suggest the most useful next calculation');
      suggestions.push('Summarise the workbook in three useful findings');
    } else if (normalised === 'Word') {
      if (hasSelection(text)) suggestions.push('Improve the selected text for clarity while keeping every fact');
      if (paragraphCount(text) >= 10) suggestions.push('Create a concise outline of this document with its main points');
      if (/\[Heading [^\]]+\]/i.test(text)) suggestions.push('Check the heading structure and suggest a cleaner document outline');
      suggestions.push('Summarise this document and list the actions it implies');
    } else {
      if (hasSelection(text)) suggestions.push('Rewrite the selected text so the message is clear in one line');
      if (slideCount(text) >= 3) suggestions.push('Review the deck for missing or inconsistent slide titles');
      if (/\(no text\)/i.test(text)) suggestions.push('Find slides with no readable text and suggest what each needs');
      suggestions.push('Summarise this deck as three decisions or takeaways');
    }
    return unique(suggestions);
  }

  return { getSmartSuggestions: getSmartSuggestions };
});
