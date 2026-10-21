/**
 * documents.js - the pure half of the Summarize flow.
 *
 * Naming the Markdown file and laying out its text need no Electron, no disk and
 * no provider, so they live here. `main.js` puts them between the three tools,
 * and a script can check the formatting without booting the app.
 */

/** Long enough for a real title, short enough to stay readable in Files. */
const NAME_LIMIT = 80;

/**
 * A workspace file name derived from the source document. Windows-reserved
 * characters become hyphens, so writeFile cannot fail on a name like
 * `report: final`. The name is stable, so summarizing the same document again
 * replaces its summary instead of piling up copies.
 * @param {string} sourceName File name or path of the document that was read.
 * @returns {string} A `.md` file name, never empty.
 */
export function summaryFileName(sourceName) {
  const full = String(sourceName ?? '').trim();
  // A source may arrive as a full path; the summary always lands at the
  // workspace root, so only the final segment is kept.
  const leaf = full.split(/[/\\]/).pop() ?? '';
  const stem = leaf
    .replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, NAME_LIMIT)
    .trim();

  return `${stem === '' ? 'document' : stem}-summary.md`;
}

/**
 * The formatted Markdown saved in the workspace: where the text came from, which
 * model wrote it, when, and the summary itself under a rule. The saved file, not
 * the Files card, is the durable result, so it carries its own provenance.
 * @param {{ sourceName: string, sourcePath: string, summary: string, model: string, truncated: boolean }} parts
 * @returns {string}
 */
export function formatSummaryMarkdown({ sourceName, sourcePath, summary, model, truncated }) {
  const savedAt = new Date();
  const date = [
    savedAt.getFullYear(),
    String(savedAt.getMonth() + 1).padStart(2, '0'),
    String(savedAt.getDate()).padStart(2, '0'),
  ].join('-');
  const clock = [
    String(savedAt.getHours()).padStart(2, '0'),
    String(savedAt.getMinutes()).padStart(2, '0'),
  ].join(':');

  const name = String(sourceName ?? '').trim() === '' ? 'document' : String(sourceName).trim();
  const lines = [
    `# Summary: ${name}`,
    '',
    `- Source: \`${String(sourcePath ?? '')}\``,
    `- Model: ${String(model ?? '').trim() === '' ? 'unknown' : String(model).trim()}`,
    `- Summarized: ${date} ${clock}`,
  ];
  if (truncated === true) {
    lines.push('- Note: only the start of the document was read, so the summary covers part of it.');
  }
  lines.push('', '---', '', String(summary ?? '').trim(), '');

  return lines.join('\n');
}
