"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { Button } from "~/components/ui/button";
import type { ModalWidth } from "~/components/ui/dialog-width";
import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

/**
 * 「面板的加宽档」与它的触发钮——**唯一出口**（规范 16 §16.2.4.18）。
 *
 * 这条账的形状与 `dialog-width` 相邻但**不是同一件事**：那个模块管的是
 * 「宽度写成 `w-*` 而不是 `max-w-*`」（ISSUE #720 的加宽按钮点了没反应的
 * 静默失效），本模块管的是**加宽这个动作在三个日志面板里被各写一遍**：
 *
 * ```tsx
 * /* 三份逐字同形（`LogPanel` / `GlobalStepLogPanel` / `WorkflowRunLogModal`）*\/
 * 档位状态：`const [wide, setWide] = useState(false);`
 * 宽度档：`popupClassName={wide ? W.wide : W.base}`
 * 同一文件里第二处：`className={`…h-[85vh]… ${wide ? W.wide : W.base}`}`
 * 触发钮：`<Button onClick={() => setWide((w) => !w)} title={wide ? "收缩" : "加宽"}>`
 * 图标：`{wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}`
 * 闭合：`</Button>`
 * ```
 *
 * 实测三份各自欠着同一件事：**「加宽」这个选择没有任何记忆**。
 * 用户把执行日志加宽、关掉、再打开 —— 又变回窄档；三个面板都是如此，
 * 而这不是「设计如此」，是**没有人负责持久化**（三份实现都只写了
 * `useState`）。所以本出口除了收掉重复，还把「记忆」补上：加宽态按
 * `storageKey` 落 `localStorage`，同一面板下次打开仍是用户选过的档。
 *
 * ── 为什么不复用 `use-flash-state` / `use-expansion-set` 的 `useState` 形态 ──
 * 那两个是**组件内**的一次性状态（亮一下就复位、树形展开随视图生命周期走）；
 * 加宽档是**跨会话的偏好**，与 `WorkflowCanvasSettings` 的「画布偏好」
 * 同类。所以这里走「模块级 store + `useSyncExternalStore`」——与
 * `useCanvasSettings` 同一套机制（同一面板可能同时挂两份实例：按钮在标题栏、
 * 面板体在 Portal 里），纯 `useState` 会让两边各有一份真相。
 */

const WIDE_PANELS = new Map<string, boolean>();
const WIDE_LISTENERS = new Set<() => void>();

function notify() {
  for (const l of WIDE_LISTENERS) l();
}

function storageKey(id: string): string {
  return `comfyapp:wide-panel:${id}`;
}

/** 读取已记忆的加宽态（SSR / 隐私模式下返回缺省）。 */
function readWide(id: string, fallback: boolean): boolean {
  /* 先看内存（同会话内的 `setItem` 立即生效，不依赖 storage 事件的时机）。 */
  const cached = WIDE_PANELS.get(id);
  if (cached !== undefined) return cached;
  /* 配额满 / 隐私模式 / storage 被禁用：本会话仍然生效，只是丢了记忆。
   * 「能不能用 storage」与「读失败怎么办」收在 `~/lib/browser-storage`
   *（§16.2.4.28）。 */
  const raw = readStorageItem(storageKey(id));
  const value = raw === "1" ? true : raw === "0" ? false : fallback;
  WIDE_PANELS.set(id, value);
  return value;
}

function writeWide(id: string, wide: boolean): void {
  WIDE_PANELS.set(id, wide);
  /* 同上：静默 —— 记忆是增强，不是功能。 */
  writeStorageItem(storageKey(id), wide ? "1" : "0");
}

/* 订阅集合：`useSyncExternalStore` 的 subscribe 必须是稳定引用。 */
const subscribe = (cb: () => void) => {
  WIDE_LISTENERS.add(cb);
  return () => {
    WIDE_LISTENERS.delete(cb);
  };
};

export interface WidePanel {
  /** 当前是否处于加宽档。 */
  wide: boolean;
  /** 在窄 / 宽之间切换（并记忆）。 */
  toggle: () => void;
  /** 显式设置（供「恢复默认」这类动作）。 */
  set: (wide: boolean) => void;
  /** 当前档位对应的宽度类 —— 直接交给 `popupClassName` / `className`。 */
  widthClass: string;
  /** 触发钮的文案（`aria-label` / `title` 共用，避免两处写不一样）。 */
  toggleLabel: string;
}

/**
 * 面板加宽档的出口。
 *
 * ```tsx
 * 取出口：`const panel = useWidePanel("exec-log", EXEC_LOG_WIDTH);`
 * 弹窗外壳用它：`<DialogContent popupClassName={panel.widthClass}>`
 * 弹窗内容也用它：`<div className={`… ${panel.widthClass}`}>…</div>`
 * 触发钮：`<WidePanelToggle panel={panel} className="…" />`
 * ```
 *
 * `id` 是**记忆的键**，必须跨挂载稳定（面板 id，不是组件实例）。
 * `fallback` 让调用处表达「这个面板默认就该多宽」——
 * `modalWidth(base)` 的返回结构原样传进来即可。
 */
export function useWidePanel(
  id: string,
  widths: ModalWidth,
  /** 首次使用（localStorage 里没有记录）时的档位，默认窄档。 */
  defaultWide = false,
): WidePanel {
  const wide = useSyncExternalStore(
    subscribe,
    () => readWide(id, defaultWide),
    () => defaultWide,
  );

  const set = useCallback(
    (next: boolean) => {
      writeWide(id, next);
      notify();
    },
    [id],
  );

  const toggle = useCallback(
    () => set(!readWide(id, defaultWide)),
    [id, defaultWide, set],
  );

  return {
    wide,
    toggle,
    set,
    widthClass: wide ? widths.wide : widths.base,
    toggleLabel: wide ? "收缩" : "加宽",
  };
}

/**
 * 加宽触发钮（标题栏里那个 ⤢）。
 *
 * 收掉的不只是「图标与文案」：三个面板的 `title` / `aria-label` / 图标
 * 此前各写一遍，而它们是**同一件事的三种表达**——改名时漏一处，用户悬停看到
 * 的就与图标的含义不一致。现在由 `panel.toggleLabel` 一处给出。
 *
 * 外观（尺寸、圆角、hover）仍由调用处经 `className` 给 —— 与
 * §16.2.4.2 第 9 条一致：验收标准是渲染结果不变。
 */
export function WidePanelToggle({
  panel,
  className,
}: {
  panel: WidePanel;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      onClick={panel.toggle}
      title={panel.toggleLabel}
      aria-label={panel.toggleLabel}
      className={className}
    >
      {panel.wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </Button>
  );
}

/** 测试用：清掉已记忆的加宽态（`WIDE_PANELS` 是模块级单例，跨用例会串）。 */
export function resetWidePanelsForTest(): void {
  WIDE_PANELS.clear();
}
