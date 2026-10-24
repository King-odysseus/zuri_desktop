import { useEffect, useState } from 'react';
import { fetchDownloads } from '../lib/downloads.js';

/**
 * A direct link to the desktop installer, for the footer and the dashboard
 * sidebar. Renders nothing until an installer is known to exist, so neither
 * place ever shows a link that cannot download anything.
 *
 * @param {{ className?: string }} props
 */
export default function DownloadLink({ className = 'foot-download' }) {
  const [file, setFile] = useState(null);

  useEffect(() => {
    let active = true;
    fetchDownloads().then((list) => {
      if (active) setFile(list[0] ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!file) return null;
  return (
    <a className={className} href={file.url} download={file.name}>
      Download for {file.label}
    </a>
  );
}
