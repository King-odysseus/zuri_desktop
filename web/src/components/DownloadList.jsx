import { useEffect, useState } from 'react';
import { ArrowRightIcon } from './Icons.jsx';
import { DOWNLOAD_PLATFORMS, fetchDownloads, formatDownloadSize } from '../lib/downloads.js';

/**
 * Download cards, one per platform.
 *
 * A card is a link only when the server really holds that installer, and the
 * href carries `download` so a click saves the file instead of opening a blank
 * tab. Otherwise it stays plain text saying it is not available yet, because a
 * link to a file that was never built is worse than no link.
 */
export default function DownloadList() {
  const [files, setFiles] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetchDownloads().then((list) => {
      if (!active) return;
      setFiles(list);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="download-grid">
      {DOWNLOAD_PLATFORMS.map((platform) => {
        const file = files.find((entry) => entry.platform === platform.platform);
        const size = file ? formatDownloadSize(file.size) : '';

        if (!file) {
          return (
            <div className="download-card is-unavailable" key={platform.platform}>
              <span className="download-card-copy">
                <strong>{platform.label}</strong>
                <span>{platform.detail}</span>
              </span>
              <span className="download-card-action">{loaded ? 'Not available yet' : 'Checking...'}</span>
            </div>
          );
        }

        return (
          <a className="download-card" href={file.url} download={file.name} key={platform.platform}>
            <span className="download-card-copy">
              <strong>{platform.label}</strong>
              <span>
                {platform.detail}
                {size ? ` - ${size}` : ''}
              </span>
            </span>
            <span className="download-card-action">
              Download
              <ArrowRightIcon />
            </span>
          </a>
        );
      })}
    </div>
  );
}
