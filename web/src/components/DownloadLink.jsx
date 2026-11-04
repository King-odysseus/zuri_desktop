import { useEffect, useState } from 'react';
import { fetchDownloads, recommendedPlatform } from '../lib/downloads.js';

/**
 * A direct link to the desktop installer, for the footer and the dashboard
 * sidebar. Renders nothing until an installer is known to exist, so neither
 * place ever shows a link that cannot download anything.
 *
 * @param {{ className?: string, icon?: import('react').ReactNode }} props
 */
export default function DownloadLink({ className = 'foot-download', icon = null }) {
  const [file, setFile] = useState(null);

  useEffect(() => {
    let active = true;
    fetchDownloads().then((list) => {
      if (!active) return;
      const preferred = recommendedPlatform();
      setFile(list.find((entry) => entry.platform === preferred) ?? list[0] ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!file) return null;
  return (
    <a className={className} href={file.url} download={file.name}>
      {icon}
      Download for {file.label}
    </a>
  );
}
