import { useEffect, useState } from 'react';
import { ArrowRightIcon } from './Icons.jsx';
import { DOWNLOAD_PLATFORMS, fetchDownloads, formatDownloadSize, recommendedPlatform } from '../lib/downloads.js';

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
  const preferredPlatform = recommendedPlatform();

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
        const isRecommended = platform.platform === preferredPlatform;

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
          <a
            className={`download-card${isRecommended ? ' is-recommended' : ''}`}
            href={file.url}
            download={file.name}
            key={platform.platform}
            aria-label={`Download Zuri for ${platform.label}`}
          >
            <span className="download-card-copy">
              <strong>{platform.label}{isRecommended ? ' (your device)' : ''}</strong>
              <span>
                {platform.detail}
                {size ? ` - ${size}` : ''}
                {file.version ? ` - version ${file.version}` : ''}
              </span>
            </span>
            <span className="download-card-action">
              Download
              <ArrowRightIcon />
            </span>
          </a>
        );
      })}
      {files.some((file) => file.releaseUrl) && (
        <p className="download-release-note">
          <a href={files.find((file) => file.releaseUrl)?.releaseUrl} target="_blank" rel="noreferrer">
            View release notes
          </a>
        </p>
      )}
    </div>
  );
}
