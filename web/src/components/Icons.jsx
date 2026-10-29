// The web app draws every icon from the desktop app's family, so the two
// surfaces cannot drift apart: one grid, one stroke, one size ladder, defined
// once in src/renderer-react/Icons.jsx. This file only adds the brand mark, which
// is a picture rather than a glyph, so a page never names two icon modules.
export {
  AgentIcon,
  AlertIcon,
  AlignLeftIcon,
  ApprovalIcon,
  ArchiveIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  AutomationIcon,
  BackIcon,
  BellIcon,
  BoltIcon,
  BrainIcon,
  CardIcon,
  ChartIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CloudIcon,
  CodeIcon,
  CommandIcon,
  CopyIcon,
  DeleteIcon,
  DeviceIcon,
  DownloadIcon,
  EditIcon,
  ExpandIcon,
  FeaturesIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GaugeIcon,
  GlobeIcon,
  GridIcon,
  HistoryIcon,
  ICON_SIZE,
  IdeaIcon,
  ImageIcon,
  LockIcon,
  LogOutIcon,
  MenuIcon,
  MessageIcon,
  MicIcon,
  MoonIcon,
  MoreIcon,
  NewChatIcon,
  OverlayIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelLeftOpenIcon,
  PaperclipIcon,
  PinIcon,
  PlusIcon,
  PreviewIcon,
  ReceiptIcon,
  RegenerateIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShareIcon,
  ShieldIcon,
  SignOutIcon,
  SkillsIcon,
  SlashCommandIcon,
  SparkIcon,
  StopIcon,
  SunIcon,
  TaskIcon,
  UserIcon,
  UserPlusIcon,
  WalletIcon,
} from '../../../src/renderer-react/Icons.jsx';

/**
 * The real Zuri app icon, the same file the desktop build ships as its
 * application icon, so the web surface and the installed app wear one mark.
 * `/zuri-logo.png` is copied straight from the main assets by the web build, and
 * its plate is the brand navy rather than the bright blue it used to be.
 *
 * @param {{ size?: number, className?: string }} props
 */
export function LogoMark({ size = 32, className = '' }) {
  return (
    <img
      className={`zuri-logo ${className}`.trim()}
      src="/zuri-logo.png"
      width={size}
      height={size}
      // Explicit size: the width/height attributes are only hints, and a
      // stylesheet `width: auto` would let the 512px source take over.
      style={{ width: size, height: size }}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );
}
