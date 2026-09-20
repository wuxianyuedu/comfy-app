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
  palette: Palette,
  film: Clapperboard,
  clapperboard: Clapperboard,
  puzzle: Puzzle,
  flame: Flame,
  folder: FolderOpen,
  folderopen: FolderOpen,
  foldertree: FolderTree,
  lock: Lock,
  sparkles: Sparkles,
  image: ImageIcon,
  music: Music,
  bot: Bot,
  filetext: FileText,
  users: Users,
  ban: Ban,
  brain: Brain,
  link: Link2,
  zap: Zap,
  check: CircleCheck,
  checkcircle: CircleCheck,
  x: CircleX,
  xcircle: CircleX,
  alert: TriangleAlert,
  alerttriangle: TriangleAlert,
  trash: Trash2,
  camera: Camera,
  search: Search,
  message: MessageCircle,
  user: UserIcon,
  bell: Bell,
  plus: Plus,
  pen: Pen,
  coins: Coins,
  infinity: InfinityIcon,
  settings: Settings,
  droplet: Droplet,
  building: Building2,
  files: Files,
  lantern: Lightbulb,
  drama: Drama,
  swords: Swords,
  flower: Flower2,
  dice: Dice5,
  sprout: Sprout,
  wand: Wand2,
  hourglass: Hourglass,
  info: Info,
  smile: Smile,
  shuffle: Shuffle,
  package: Package,
  close: X,
  loader: Loader2,
  eye: Eye,
  eyeoff: EyeOff,
  chevronup: ChevronUp,
  chevrondown: ChevronDown,
  chevronleft: ChevronLeft,
  chevronright: ChevronRight,
  arrowup: ArrowUp,
  arrowdown: ArrowDown,
  arrowleft: ArrowLeft,
  arrowright: ArrowRight,
  grid: LayoutGrid,
  play: Play,
  movie: Film,
};

/** 本基元的**私有字段**（自己接管，不透传给底层图标组件）——
 *  类型侧与运行时侧共用这一份表（`~/lib/dom-props`）。 */
const OWN_PROPS = ["name", "size", "className"] as const;

export interface IconProps extends OmitOwnProps<
  LucideProps,
  (typeof OWN_PROPS)[number]
> {
  /** 图标键，如 "film"、"sparkles"、"trash"。大小写不敏感。 */
  name?: string | null;
  size?: number;
  /** 额外类名（透传给底层的 lucide 组件）。 */
  className?: string;
}

/** 由字符串键渲染扁平的 lucide 图标。键未知时返回 null。 */
export function Icon(props: IconProps) {
  /* 私有字段与要透传的字段**从同一份表**分开（`OWN_PROPS`）—— 类型侧的
   * `OmitOwnProps` 与这里的 `splitDomProps` 读的是同一个数组。 */
  const { own, rest } = splitDomProps(props, OWN_PROPS);
  const name = own.name;
  const size = own.size ?? 16;
  const Cmp: LucideIcon | undefined = name
    ? ICON_MAP[name.toLowerCase()]
    : undefined;
  if (!Cmp) return null;
  return <Cmp size={size} className={own.className} aria-hidden {...rest} />;
}

export type { LucideIcon, ComponentType };
