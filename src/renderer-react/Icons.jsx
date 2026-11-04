// The one icon family for Zuri.
//
// Every glyph is drawn on the same rules, measured from the icon set ChatGPT
// ships rather than guessed: a 24 unit grid, a 2 unit stroke with round caps and
// joins, closed shapes with real corner radii, and no more than about three
// separate elements in a glyph. A thinner stroke is the most visible difference
// between a set that looks finished and one that looks borrowed, so the stroke is
// set here and never at the call site.
//
// Only three sizes are ever used: 16 in the chrome, 20 in a large empty state, 24
// in a page header. ICON_SIZE names them so a call site states its intent instead
// of picking a number.
import {
  AlignLeft,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Bot,
  Brain,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Cloud,
  Code,
  Command,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Globe,
  Grid2x2,
  History,
  Image,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Lock,
  LogOut,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  MonitorSmartphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  PictureInPicture2,
  Pin,
  Plus,
  Receipt,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  Sun,
  Trash2,
  TriangleAlert,
  User,
  UserPlus,
  Volume2,
  Wallet,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';

/** The only sizes an icon may take, named so a call site states its intent. */
export const ICON_SIZE = { sm: 16, md: 18, lg: 20, xl: 24 };

/**
 * Wrap a glyph in the family's rules.
 *
 * `filled` is the on state: the same outline with its inside filled, which is how
 * ChatGPT marks a toggle that is switched on. It is offered only on glyphs that
 * stand for a switch, because filling a chevron would mean nothing.
 *
 * @param {import('react').ComponentType<any>} Glyph
 * @param {{ name: string, dot?: boolean }} options
 */
function family(Glyph, { name, dot = false }) {
  function ZuriIcon({ size = ICON_SIZE.sm, strokeWidth = 2, filled = false, label, className = '', ...rest }) {
    // A dot glyph is solid in both states: it is punctuation rather than a shape,
    // and a stroked ring would read as a hole at 16px.
    const paint = dot || filled ? { fill: 'currentColor' } : null;
    return (
      <Glyph
        size={size}
        strokeWidth={paint ? 0 : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`zuri-icon ${className}`.trim()}
        aria-hidden={label ? undefined : 'true'}
        aria-label={label || undefined}
        role={label ? 'img' : undefined}
        focusable="false"
        {...paint}
        {...rest}
      />
    );
  }
  ZuriIcon.displayName = name;
  return ZuriIcon;
}

/** Three dots, drawn as filled circles rather than three short strokes. */
function MoreGlyph({ size = ICON_SIZE.sm, className = '', label, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

/**
 * Stop is a filled rounded square, the way a transport control draws it. An
 * outlined square reads as a checkbox at 16px, which is the wrong promise.
 */
function StopGlyph({ size = ICON_SIZE.sm, className = '', label, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/**
 * A new chat is a pencil on a page, not a speech bubble with a plus: the gesture
 * is writing, and a bubble with a plus is what a support widget uses.
 */
function NewChatGlyph({ size = ICON_SIZE.sm, className = '', label, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      <path d="M19 13.5V18a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18V8a2.5 2.5 0 0 1 2.5-2.5h4.5" />
      <path d="M17.8 3.6a1.9 1.9 0 0 1 2.7 2.7l-6.3 6.3-3.4.7.7-3.4Z" />
    </svg>
  );
}

/** The panel toggle: a rounded frame with its left third marked off. */
function PanelLeftGlyph({ size = ICON_SIZE.sm, className = '', label, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

export const AgentIcon = family(Bot, { name: 'AgentIcon' });
export const AlertIcon = family(TriangleAlert, { name: 'AlertIcon' });
export const AlignLeftIcon = family(AlignLeft, { name: 'AlignLeftIcon' });
export const ApprovalIcon = family(ShieldCheck, { name: 'ApprovalIcon' });
export const ArchiveIcon = family(Archive, { name: 'ArchiveIcon' });
export const ArrowRightIcon = family(ArrowRight, { name: 'ArrowRightIcon' });
export const ArrowUpIcon = family(ArrowUp, { name: 'ArrowUpIcon' });
export const BackIcon = family(ArrowLeft, { name: 'BackIcon' });
export const AutomationIcon = family(Clock3, { name: 'AutomationIcon' });
export const BellIcon = family(Bell, { name: 'BellIcon' });
export const BoltIcon = family(Zap, { name: 'BoltIcon' });
export const BrainIcon = family(Brain, { name: 'BrainIcon' });
export const CardIcon = family(CreditCard, { name: 'CardIcon' });
export const ChartIcon = family(ChartColumn, { name: 'ChartIcon' });
export const ChatIcon = family(MessageSquare, { name: 'ChatIcon' });
export const CheckIcon = family(Check, { name: 'CheckIcon' });
export const ChevronDownIcon = family(ChevronDown, { name: 'ChevronDownIcon' });
export const ChevronLeftIcon = family(ChevronLeft, { name: 'ChevronLeftIcon' });
export const ChevronRightIcon = family(ChevronRight, { name: 'ChevronRightIcon' });
export const ChevronUpIcon = family(ChevronUp, { name: 'ChevronUpIcon' });
export const CloseIcon = family(X, { name: 'CloseIcon' });
export const CloudIcon = family(Cloud, { name: 'CloudIcon' });
export const CodeIcon = family(Code, { name: 'CodeIcon' });
export const CommandIcon = family(Command, { name: 'CommandIcon' });
export const CopyIcon = family(Copy, { name: 'CopyIcon' });
export const DeleteIcon = family(Trash2, { name: 'DeleteIcon' });
export const DeviceIcon = family(MonitorSmartphone, { name: 'DeviceIcon' });
export const DownloadIcon = family(Download, { name: 'DownloadIcon' });
export const EditIcon = family(Pencil, { name: 'EditIcon' });
// A pencil with sparkles: the message box being rewritten, not the chat being edited.
export const EnhanceIcon = family(WandSparkles, { name: 'EnhanceIcon' });
export const ExpandIcon = family(Maximize2, { name: 'ExpandIcon' });
export const FeaturesIcon = family(LayoutGrid, { name: 'FeaturesIcon' });
export const FileIcon = family(FileText, { name: 'FileIcon' });
export const FolderIcon = family(Folder, { name: 'FolderIcon' });
export const FolderOpenIcon = family(FolderOpen, { name: 'FolderOpenIcon' });
export const FolderPlusIcon = family(FolderPlus, { name: 'FolderPlusIcon' });
export const GaugeIcon = family(Gauge, { name: 'GaugeIcon' });
export const GlobeIcon = family(Globe, { name: 'GlobeIcon' });
export const GridIcon = family(Grid2x2, { name: 'GridIcon' });
export const HistoryIcon = family(History, { name: 'HistoryIcon' });
export const IdeaIcon = family(Lightbulb, { name: 'IdeaIcon' });
export const ImageIcon = family(Image, { name: 'ImageIcon' });
export const LockIcon = family(Lock, { name: 'LockIcon' });
export const LogOutIcon = family(LogOut, { name: 'LogOutIcon' });
export const MenuIcon = family(Menu, { name: 'MenuIcon' });
export const MessageIcon = family(MessageSquare, { name: 'MessageIcon' });
export const MicIcon = family(Mic, { name: 'MicIcon' });
export const MoonIcon = family(Moon, { name: 'MoonIcon' });
export const MoreIcon = MoreGlyph;
export const NewChatIcon = NewChatGlyph;
export const OverlayIcon = family(PictureInPicture2, { name: 'OverlayIcon' });
export const PanelLeftCloseIcon = family(PanelLeftClose, { name: 'PanelLeftCloseIcon' });
export const PanelLeftIcon = PanelLeftGlyph;
export const PanelLeftOpenIcon = family(PanelLeftOpen, { name: 'PanelLeftOpenIcon' });
export const PaperclipIcon = family(Paperclip, { name: 'PaperclipIcon' });
export const PinIcon = family(Pin, { name: 'PinIcon' });
export const PlusIcon = family(Plus, { name: 'PlusIcon' });
export const PreviewIcon = family(Eye, { name: 'PreviewIcon' });
export const ReceiptIcon = family(Receipt, { name: 'ReceiptIcon' });
export const RegenerateIcon = family(RotateCw, { name: 'RegenerateIcon' });
export const SpeakIcon = family(Volume2, { name: 'SpeakIcon' });
export const SearchIcon = family(Search, { name: 'SearchIcon' });
export const SendIcon = family(ArrowUp, { name: 'SendIcon' });
export const SettingsIcon = family(Settings, { name: 'SettingsIcon' });
export const ShareIcon = family(Share2, { name: 'ShareIcon' });
export const ShieldIcon = family(Shield, { name: 'ShieldIcon' });
export const SignOutIcon = family(LogOut, { name: 'SignOutIcon' });
export const SkillsIcon = family(Sparkles, { name: 'SkillsIcon' });
export const SlashCommandIcon = family(SquareSlash, { name: 'SlashCommandIcon' });
export const SparkIcon = family(Sparkles, { name: 'SparkIcon' });
export const StopIcon = StopGlyph;
export const SunIcon = family(Sun, { name: 'SunIcon' });
export const SyncIcon = family(RefreshCw, { name: 'SyncIcon' });
export const TaskIcon = family(ListChecks, { name: 'TaskIcon' });
export const UserIcon = family(User, { name: 'UserIcon' });
export const UserPlusIcon = family(UserPlus, { name: 'UserPlusIcon' });
export const WalletIcon = family(Wallet, { name: 'WalletIcon' });
