function inlineContent(text, keyPrefix) {
  const pieces = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pieces.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**')) {
      pieces.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      pieces.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>);
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

export default function FormattedMessage({ content }) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

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
      <ListTag key={`list-${blocks.length}`} className="list-inside space-y-1">
        {list.items.map((item, index) => <li key={`${list.type}-${index}`}>{inlineContent(item, `list-${blocks.length}-${index}`)}</li>)}
      </ListTag>,
    );
    list = null;
  };

  const flushText = () => {
    flushParagraph();
    flushList();
  };

  lines.forEach((line) => {
    if (code) {
      if (/^```/.test(line.trim())) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-xl bg-surface-tertiary p-3 text-xs leading-relaxed">
            <code>{code.lines.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        code.lines.push(line);
      }
      return;
    }

    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      flushText();
      code = { lines: [] };
      return;
    }
    if (trimmed === '') {
      flushText();
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushText();
      blocks.push(<h3 key={`heading-${blocks.length}`} className="text-base font-semibold">{inlineContent(heading[2], `heading-${blocks.length}`)}</h3>);
      return;
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
      return;
    }

    flushList();
    paragraph.push(line);
  });

  if (code) {
    blocks.push(
      <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-xl bg-surface-tertiary p-3 text-xs leading-relaxed">
        <code>{code.lines.join('\n')}</code>
      </pre>,
    );
  }
  flushText();

  return <div className="space-y-3 leading-6">{blocks}</div>;
}
