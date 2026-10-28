import { useState } from 'react';
import { copyText } from './clipboard.js';

// Inline markers are matched in this order so a URL that happens to contain an
// asterisk is still read as a link rather than half-italic text.
const INLINE_PATTERN = /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+|\*\*[^*]+\*\*|\*[^*]+\*)/g;
const MARKDOWN_LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function trimLink(token) {
  let url = token;
  while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
  // A link written inside brackets, "(see https://x.com/a)", keeps the closing
  // parenthesis as prose rather than part of the address.
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1);
  }
  return url;
}

function inlineContent(text, keyPrefix) {
  const pieces = [];
  let lastIndex = 0;
  let match;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pieces.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      pieces.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      pieces.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const link = MARKDOWN_LINK.exec(token);
      if (link) {
        pieces.push(
          <a key={`${keyPrefix}-link-${match.index}`} href={link[2]} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline underline-offset-2">
            {link[1]}
          </a>,
        );
      } else {
        pieces.push(token);
      }
    } else if (token.startsWith('http')) {
      const url = trimLink(token);
      pieces.push(
        <a key={`${keyPrefix}-link-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline underline-offset-2">
          {url}
        </a>,
      );
      if (url.length < token.length) pieces.push(token.slice(url.length));
    } else {
      pieces.push(<em key={`${keyPrefix}-em-${match.index}`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    pieces.push(text.slice(lastIndex));
  }
  return pieces;
}

function CodeBlock({ language, lines, onOpen }) {
  const [state, setState] = useState('idle');

  async function copy() {
    const copied = await copyText(lines.join('\n'));
    setState(copied ? 'copied' : 'failed');
    window.setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl bg-surface-tertiary">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-xs text-muted">
        <span className="font-mono">{language || 'code'}</span>
        <span className="flex items-center gap-1">
          {/* Only the desktop chat has a side panel to open it in; the web chat passes
              nothing, so its code blocks keep the one Copy button they always had. */}
          {onOpen && (
            <button type="button" onClick={onOpen} className="rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground">
              Open in panel
            </button>
          )}
          <button type="button" onClick={() => void copy()} className="rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-foreground">
            {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{lines.join('\n')}</code>
      </pre>
    </div>
  );
}

function splitRow(line) {
  const trimmed = line.trim();
  const withoutStart = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutEnd = withoutStart.endsWith('|') ? withoutStart.slice(0, -1) : withoutStart;
  return withoutEnd.split('|').map((cell) => cell.trim());
}

function isSeparator(line) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function startsTable(lines, index) {
  return lines[index].trim().startsWith('|')
    && index + 1 < lines.length
    && isSeparator(lines[index + 1]);
}

export default function FormattedMessage({ content, onOpenCode }) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

  // Snapshot of the block at the moment it closes: the same `code` object is reused
  // for the next fence, so the handler must read its own copy of the lines.
  const openerFor = (block) => {
    if (typeof onOpenCode !== 'function') return undefined;
    const snapshot = { language: block.language, text: block.lines.join('\n') };
    return () => onOpenCode(snapshot);
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`paragraph-${blocks.length}`}>
        {paragraph.flatMap((line, index) => [
          index > 0 ? <br key={`break-${index}`} /> : null,
          ...inlineContent(line, `paragraph-${blocks.length}-${index}`),
        ])}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const ListTag = list.type === 'ordered' ? 'ol' : 'ul';
    blocks.push(
      <ListTag key={`list-${blocks.length}`} className={`list-inside space-y-1 ${list.type === 'ordered' ? 'list-decimal' : 'list-disc'}`}>
        {list.items.map((item, index) => <li key={`${list.type}-${index}`}>{inlineContent(item, `list-${blocks.length}-${index}`)}</li>)}
      </ListTag>,
    );
    list = null;
  };

  const flushText = () => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (code) {
      if (/^```/.test(line.trim())) {
        blocks.push(<CodeBlock key={`code-${blocks.length}`} language={code.language} lines={code.lines} onOpen={openerFor(code)} />);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flushText();
      code = { language: trimmed.replace(/^```/, '').trim(), lines: [] };
      continue;
    }
    if (trimmed === '') {
      flushText();
      continue;
    }

    if (startsTable(lines, index)) {
      flushText();
      const header = splitRow(line);
      const rows = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length && lines[rowIndex].trim().startsWith('|')) {
        rows.push(splitRow(lines[rowIndex]));
        rowIndex += 1;
      }
      blocks.push(
        <div key={`table-${blocks.length}`} className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-tertiary">
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`} className="whitespace-nowrap px-3 py-2 font-semibold">{inlineContent(cell, `table-${blocks.length}-head-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-t border-border">
                  {header.map((_, cellIndex) => (
                    <td key={`cell-${cellIndex}`} className="px-3 py-2 align-top">{inlineContent(row[cellIndex] ?? '', `table-${blocks.length}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = rowIndex - 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushText();
      blocks.push(<h3 key={`heading-${blocks.length}`} className="text-base font-semibold">{inlineContent(heading[2], `heading-${blocks.length}`)}</h3>);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      const type = unordered ? 'unordered' : 'ordered';
      if (!list || list.type !== type) {
        flushText();
        list = { type, items: [] };
      }
      list.items.push((unordered ?? ordered)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code) {
    blocks.push(<CodeBlock key={`code-${blocks.length}`} language={code.language} lines={code.lines} onOpen={openerFor(code)} />);
  }
  flushText();

  return <div className="space-y-3 leading-6">{blocks}</div>;
}
