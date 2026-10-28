import { CodeIcon, ChartIcon, FileIcon, FolderIcon, IdeaIcon } from './Icons.jsx';

// The keys match PROJECT_ICONS in src/main/store.js: main stores the key, and this
// table is the only place the renderer turns it into a picture.
export const PROJECT_ICON_CHOICES = [
  { key: 'folder', label: 'Folder', Icon: FolderIcon },
  { key: 'document', label: 'Document', Icon: FileIcon },
  { key: 'code', label: 'Code', Icon: CodeIcon },
  { key: 'chart', label: 'Chart', Icon: ChartIcon },
  { key: 'idea', label: 'Idea', Icon: IdeaIcon },
];

/** The icon for a stored key; an unknown key falls back to the folder. */
export function projectIconFor(key) {
  return (PROJECT_ICON_CHOICES.find((choice) => choice.key === key) ?? PROJECT_ICON_CHOICES[0]).Icon;
}
