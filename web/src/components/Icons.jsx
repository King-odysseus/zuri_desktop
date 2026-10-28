// Lucide supplies the drawing; this file only keeps the names the pages already
// import. One stroke weight, one size default, so a new icon cannot arrive with
// its own look.
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  Folder,
  ListChecks,
  Settings,
  ArrowRight,
  Brain,
  Check,
  CreditCard,
  BarChart3,
  Globe,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  MonitorSmartphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Shield,
  Sparkles,
  Sun,
  User,
  X,
  Zap,
} from 'lucide-react';

// 18px matches the page rules in styles.css and keeps an icon visible wherever
// no rule sizes it. Colours come from the icon's computed CSS colour.
const base = { size: 18, strokeWidth: 1.8, 'aria-hidden': true };

/**
 * The real Zuri app icon, the same file the desktop build ships as its
 * application icon, so the web surface and the installed app wear one mark.
 * `/zuri-logo.png` is copied straight from the main assets by the web build.
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

export const BoltIcon = (props) => <Zap {...base} {...props} />;
export const LockIcon = (props) => <Lock {...base} {...props} />;
export const GlobeIcon = (props) => <Globe {...base} {...props} />;
export const BrainIcon = (props) => <Brain {...base} {...props} />;
export const ArrowRightIcon = (props) => <ArrowRight {...base} {...props} />;
export const SparkIcon = (props) => <Sparkles {...base} {...props} />;
export const SunIcon = (props) => <Sun {...base} {...props} />;
export const MoonIcon = (props) => <Moon {...base} {...props} />;
export const CheckIcon = (props) => <Check {...base} strokeWidth={2.2} {...props} />;
export const ShieldIcon = (props) => <Shield {...base} {...props} />;
export const DeviceIcon = (props) => <MonitorSmartphone {...base} {...props} />;
export const CardIcon = (props) => <CreditCard {...base} {...props} />;
export const ChartIcon = (props) => <BarChart3 {...base} {...props} />;
export const GridIcon = (props) => <LayoutGrid {...base} {...props} />;
export const ReceiptIcon = (props) => <Receipt {...base} {...props} />;
export const UserIcon = (props) => <User {...base} {...props} />;
export const CloseIcon = (props) => <X {...base} {...props} />;
export const MessageIcon = (props) => <MessageSquare {...base} {...props} />;
export const BackIcon = (props) => <ArrowLeft {...base} {...props} />;
/** The menu button that opens the navigation drawer on a phone. */
export const MenuIcon = (props) => <Menu {...base} {...props} />;
/** Closing the navigation panel, and opening it again from the icons left behind. */
export const PanelLeftCloseIcon = (props) => <PanelLeftClose {...base} {...props} />;
export const PanelLeftOpenIcon = (props) => <PanelLeftOpen {...base} {...props} />;
/** Leaving the account: the signed-in shell carries it in its own panel. */
export const SignOutIcon = (props) => <LogOut {...base} {...props} />;
// The rail of the app preview on the landing page uses the same five glyphs as the desktop sidebar.
export const SendIcon = (props) => <ArrowUp {...base} {...props} />;
export const TaskIcon = (props) => <ListChecks {...base} {...props} />;
export const BellIcon = (props) => <Bell {...base} {...props} />;
export const FolderIcon = (props) => <Folder {...base} {...props} />;
export const SettingsIcon = (props) => <Settings {...base} {...props} />;
