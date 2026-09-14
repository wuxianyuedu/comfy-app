"use client";

/* ── ShellTabs · 应用级「页签」容器（窗口顶部一条页签栏 + 内容区）────
 *
 * 设计目标：把「主应用」（workspace）与「内嵌的 ComfyUI」都收进同一个
 * Tauri 主窗口内的页签里，一条可切换、可关闭的页签栏，替代此前会
 * 弹出空白独立窗口的 open_comfyui_window 方案。
 *
 * 两种渲染形态（判据见 `shouldUseTitleBarTabs`）：
 *  - **桌面壳内**：页签搬到窗口**标题行**——主窗口关闭原生装饰，由
 *    `TitleBarTabs` 接管整条标题栏（页签 + 拖拽区 + 最小化/最大化/关闭），
 *    不再额外占用应用内区域（ISSUE #310 / #200）。
 *  - **浏览器 / dev**：窗口由系统浏览器提供，没有原生标题栏可让位，
 *    退回「应用内页签栏」，保留原有行为与观感。
 *
 * 两种形态共用同一个高度量 `TITLE_BAR_HEIGHT_CLASS`（`h-title-bar` ←
 * `--spacing-title-bar`）：全屏视图层按 `top-title-bar` 让位，页签栏高度必须
 * 与它同源，否则让位量与实际高度对不上（多留空白或盖住一条）。
 *
 * 关键取舍：
 *  - 主应用内容（children）与已打开的 ComfyUI iframe 都**始终挂载**，
 *    用 CSS 显隐切换，而不是条件卸载——这样切页签不会丢 workspace 的
 *    viewMode / 画布编辑态，ComfyUI 页面也不会因卸载而重载。
 *  - 主应用页签（id="main"）不可关闭；ComfyUI 页签可按需关闭。
 *  - 页签状态由 shell-tabs-store 管理（纯状态层），本组件只做渲染与
 *    动作转发，符合规范 17 的四层归属。
 *
 * 样式说明：内容区高度为「窗口高 - 页签栏高」，主应用内部用 h-full 布局。
 */

import { useCallback, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  useShellTabs,
  MAIN_TAB_ID,
  type ShellTab,
} from "~/lib/shell-tabs-store";
import { isDesktopShell } from "~/lib/desktop-shell-client";
import { shouldUseTitleBarTabs } from "~/lib/title-bar-derive";
import { TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";
import { TitleBarTabs } from "./TitleBarTabs";

interface ShellTabsProps {
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
}

/** 单个页签按钮：标题 + 可选关闭按钮（浏览器形态用）。 */
function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: ShellTab;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(tab.id);
        }
      }}
      className={`group flex h-full cursor-pointer items-center gap-2 border-r border-border-subtle px-4 text-sm transition-colors ${
        active
          ? "bg-canvas text-ink-bright"
          : "bg-subtle/60 text-ink-muted hover:bg-subtle hover:text-ink-strong"
      }`}
    >
      <span className="truncate">{tab.label}</span>
      {tab.closable && (
        <button
          type="button"
          aria-label={`关闭 ${tab.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="rounded p-0.5 text-ink-fainter hover:bg-subtle hover:text-ink-strong"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** 应用内页签栏（浏览器 / dev 形态）。 */
function InAppTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: ShellTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="应用页签"
      className={`flex ${TITLE_BAR_HEIGHT_CLASS} shrink-0 items-stretch border-b border-border-subtle bg-subtle/40`}
    >
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onSelect={onActivate}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

/**
 * 无法内嵌时在**页签内**渲染的说明。
 *
 * 为什么要有它：以前这种情况会弹一个（多半也空白的）独立窗口 —— 用户既没
 * 得到内容，也不知道为什么。现在页签照常打开，这里给出成因与下一步，
 * 至少让失败是**可读、可行动**的，而不是一片空白（ISSUE #310）。
 */
function TabBlockedNotice({
  label,
  reason,
  url,
}: {
  label: string;
  reason: string;
  url?: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-xl space-y-3 text-center">
        <p className="text-base font-medium text-ink-bright">
          无法在此页签中显示 {label}
        </p>
        <p className="text-sm leading-relaxed text-ink-muted">
          {reason}
        </p>
        <p className="text-xs leading-relaxed text-ink-fainter">
          通常重启 ComfyUI 即可恢复（应用会自动以放行内嵌的参数拉起它）。
        </p>
      </div>
      {/* 地址是唯一能「自己验证」的信息：复制到浏览器里能打开 → 拦的是应用外壳
       * 的跨源 frame 策略；浏览器里也打不开 → 拦的是 ComfyUI 自己。此前只剩
       * 「已阻止此内容」一句时，两种情形长得一模一样（ISSUE #310）。 */}
      {url && (
        <div className="flex max-w-xl items-center gap-2 rounded-md border border-border-subtle bg-subtle/40 px-3 py-2">
          <code className="truncate text-xs text-ink-muted">
            {url}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url);
            }}
            className="shrink-0 rounded px-2 py-1 text-xs text-ink-muted hover:bg-subtle hover:text-ink-strong"
          >
            复制地址
          </button>
        </div>
      )}
      <p className="max-w-xl text-center text-xs leading-relaxed text-ink-fainter">
        也可以到 设置 → 创作后端，点「在浏览器打开」直接查看。
      </p>
    </div>
  );
}

export function ShellTabs({ children }: ShellTabsProps) {
  const tabs = useShellTabs((s) => s.tabs);
  const activeTabId = useShellTabs((s) => s.activeTabId);
  const activateTab = useShellTabs((s) => s.activateTab);
  const closeTab = useShellTabs((s) => s.closeTab);

  // 壳探测只能在客户端进行（SSR 无 window）。用 useSyncExternalStore 取
  // 客户端快照（服务端恒 false）——首帧按「非壳」渲染，客户端再取真实值，
  // 既不触发 set-state-in-effect（规范 08 §8.6），也不会 hydration 报错。
  const inShell = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    () => isDesktopShell(),
    () => false,
  );

  const contentTabs = tabs.filter((t) => t.id !== MAIN_TAB_ID);
  const useTitleBar = shouldUseTitleBarTabs(inShell);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-ink">
      {useTitleBar ? (
        <TitleBarTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
      ) : (
        <InAppTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
      )}

      {/* 内容区：主应用与 ComfyUI 均保持挂载，用 CSS 显隐切换，避免丢态。
       *
       * 底部间距只给主应用（pb-6）：全局底部状态栏（根布局挂载的 24px 固定
       * 悬浮层）盖住窗口最底下一条，主应用内容留在它上方；而 ComfyUI iframe
       * 必须拿满「页签栏以下」的全部高度——它要和浏览器整窗打开时一样容纳
       * 自绘的底部控件（运行操作栏、扩展面板），少一截就出现「浏览器里看得见、
       * 应用里被裁掉」的适配差（状态栏在非主应用页签会隐藏，见 BrowserStatusBar）。
       */}
      <div className="relative min-h-0 flex-1">
        {/* 主应用页签（恒挂载，用 CSS 显隐） */}
        <div
          className={
            activeTabId !== MAIN_TAB_ID ? "hidden h-full pb-6" : "h-full pb-6"
          }
        >
          {children}
        </div>

        {/* 已打开的非主应用页签（iframe），同样保持挂载 */}
        {contentTabs.map((tab) => (
          <div
            key={tab.id}
            className={activeTabId === tab.id ? "h-full" : "hidden h-full"}
            aria-hidden={activeTabId !== tab.id}
          >
            {tab.blockedReason ? (
              <TabBlockedNotice
                label={tab.label}
                reason={tab.blockedReason}
                url={tab.blockedUrl}
              />
            ) : tab.url ? (
              <iframe
                src={tab.url}
                title={tab.label}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-ink-muted">
                页签内容为空
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
