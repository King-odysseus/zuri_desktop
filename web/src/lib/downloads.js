const RELEASES_URL = 'https://github.com/King-odysseus/zuri_desktop/releases';

export const DOWNLOADS = {
  windows: {
    label: 'Windows installer',
    detail: 'Windows 10 or 11, x64',
    href: RELEASES_URL,
    available: true,
  },
  macos: {
    label: 'macOS build',
    detail: 'Not published yet',
    href: RELEASES_URL,
    available: false,
  },
};

export { RELEASES_URL };
