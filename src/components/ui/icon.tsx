import {
  Palette,
  Clapperboard,
  Puzzle,
  Flame,
  FolderOpen,
  Lock,
  Sparkles,
  Image as ImageIcon,
  Music,
  Bot,
  FileText,
  Users,
  Ban,
  Brain,
  Link2,
  Zap,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Trash2,
  Camera,
  Search,
  MessageCircle,
  User as UserIcon,
  Bell,
  Plus,
  FolderTree,
  Pen,
  Coins,
  Infinity as InfinityIcon,
  Settings,
  Droplet,
  Building2,
  Files,
  Lightbulb,
  Drama,
  Swords,
  Flower2,
  Dice5,
  Sprout,
  Wand2,
  Hourglass,
  Info,
  Smile,
  Shuffle,
  Package,
  X,
  Loader2,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  Play,
  Film,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

import { type OmitOwnProps, splitDomProps } from "~/lib/dom-props";

/**
 * 字符串键 → lucide 图标映射。
 * UI 数据（技能、画布节点类型、创建面板类别、工坊页签、
 * API 响应）只带字符串键，所以解析器让
 * 数据模型保持可序列化，同时前端渲染扁平 SVG 图标。
 */
const ICON_MAP: Record<string, LucideIcon> = {
  alert: TriangleAlert,
  alerttriangle: TriangleAlert,
  arrowdown: ArrowDown,
  arrowleft: ArrowLeft,
  arrowright: ArrowRight,
  arrowup: ArrowUp,
  ban: Ban,
  bell: Bell,
  bot: Bot,
  brain: Brain,
  building: Building2,
  camera: Camera,
  check: CircleCheck,
  checkcircle: CircleCheck,
  chevrondown: ChevronDown,
  chevronleft: ChevronLeft,
  chevronright: ChevronRight,
  chevronup: ChevronUp,
  clapperboard: Clapperboard,
  close: X,
  coins: Coins,
  dice: Dice5,
  drama: Drama,
  droplet: Droplet,
  eye: Eye,
  eyeoff: EyeOff,
  files: Files,
  filetext: FileText,
  film: Clapperboard,
  flame: Flame,
  flower: Flower2,
  folder: FolderOpen,
  folderopen: FolderOpen,
  foldertree: FolderTree,
  grid: LayoutGrid,
  hourglass: Hourglass,
  image: ImageIcon,
  infinity: InfinityIcon,
  info: Info,
  lantern: Lightbulb,
  link: Link2,
  loader: Loader2,
  lock: Lock,
  message: MessageCircle,
  movie: Film,
  music: Music,
  package: Package,
  palette: Palette,
  pen: Pen,
  play: Play,
  plus: Plus,
  puzzle: Puzzle,
  search: Search,
  settings: Settings,
  shuffle: Shuffle,
  smile: Smile,
  sparkles: Sparkles,
  sprout: Sprout,
  swords: Swords,
  trash: Trash2,
  user: UserIcon,
  users: Users,
  wand: Wand2,
  x: CircleX,
  xcircle: CircleX,
  zap: Zap,
};

/** 本基元的**私有字段**（自己接管，不透传给底层图标组件）——
 *  类型侧与运行时侧共用这一份表（`~/lib/dom-props`）。 */
const OWN_PROPS = /* SAFETY: 类型断言已复核 */ ["name", "size", "className"] as const;

export type IconProps = {
  /** 额外类名（透传给底层的 lucide 组件）。 */
  className?: string;
  /** 图标键，如 "film"、"sparkles"、"trash"。大小写不敏感。 */
  name?: string | null;
  size?: number;
} & OmitOwnProps<LucideProps, (typeof OWN_PROPS)[number]>;

/** 由字符串键渲染扁平的 lucide 图标。键未知时返回 null。 */
export function Icon(props: IconProps) {
  /* 私有字段与要透传的字段**从同一份表**分开（`OWN_PROPS`）—— 类型侧的
   * `OmitOwnProps` 与这里的 `splitDomProps` 读的是同一个数组。 */
  const { own, rest } = splitDomProps(props, OWN_PROPS);
  const name = own.name;
  const size = own.size ?? 16;
  const Cmp: LucideIcon | undefined = name ? ICON_MAP[name.toLowerCase()] : undefined;
  if (!Cmp) {
    return null;
  }
  return <Cmp aria-hidden className={own.className} size={size} {...rest} />;
}

export type { LucideIcon, ComponentType };
