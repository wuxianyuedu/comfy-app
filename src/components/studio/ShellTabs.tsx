"use client";

/* ── ShellTabs · 应用级「页签」容器（桌面壳标题行页签 + 内容区）────
 * 在 Tauri 主窗口里把「主应用」（workspace）与「内嵌的 ComfyUI」收进同一窗口的页签，
 * 替代此前会弹出空白独立窗口的 `open_comfyui_window`（ISSUE #310 / #200）。
 * 两种形态（判据 `shouldUseTitleBarTabs`）：桌面壳内由 `TitleBarTabs` 承载页签 + 拖拽区
 * + 三个窗口按钮；浏览器 / dev 不渲染 iframe 页签栏（宿主自带页签，ComfyUI 走新浏览器
 * 页签），视图页签条照常渲染（`ProjectTabBar` 已退役）。
 *
 * **标题行放哪儿（ISSUE #3807）**：它不再是整窗 flex 流的第一行。此前 `TitleBarTabs`
 * 以 36px 全宽横条把内容区整体推下 36px，全局 CSS 还得把 fixed 侧栏一并下移，于是
 * 「浏览器里首页顶到窗口最上端、Tauri 壳里不是」。现在标题行经 `TitleBarSlotProvider`
 * 交给 `AppShell`，渲染在**内容列顶部**（与浏览器态 `ViewTabStrip` 同位、同款背景），
 * 侧栏不再让位，两形态都从视口 y=0 起。窗口按钮与拖拽区仍在标题行里，#310 的无边框
 * 窗口功能一条没丢；`ShellFullPage` 自带的精简标题行仍用 `data-shell` 让位，不受影响。
 *
 * 关键取舍：主应用内容与已打开的 ComfyUI iframe 都**始终挂载**、用 CSS 显隐切换，
 * 切页签不丢 workspace 的 viewMode / 画布编辑态，ComfyUI 也不因卸载重载；主应用页签
 * （`main`）不可关闭。标题栏高度与可点层级由 `TitleBarTabs` 自持（须走 chrome 档层级，
 * 否则被整视口遮罩压住命中测试，见 launch-and-build §5）；页签状态在 shell-tabs-store，
 * 本组件只做渲染与动作转发（规范 17 四层归属）。内容区两形态都占满视口，底部 `pb-6`
 * 给全局状态栏让位。
 */

import { useShellTabs, MAIN_TAB_ID } from "~/lib/shell/shell-tabs-store";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { TitleBarSlotProvider } from "./TitleBarSlot";
import { TitleBarTabs } from "./TitleBarTabs";
import type { ViewTab } from "./workspace-tabs";
import type { OpenableView } from "./ViewTabStrip";
import type { WorkspaceView } from "./NavItems";
import { Button } from "~/components/ui/button";
import { TruncatedText } from "~/components/ui/truncated-text";

type ShellTabsProps = {
  /** 当前视图页签 key。 */
  activeViewKey?: string;
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
  /** 关闭某个视图页签。 */
  onCloseViewTab?: (key: string) => void;
  /** 从「+」菜单里选了一个视图。 */
  onOpenView?: (view: WorkspaceView) => void;
  /** 选中某个视图页签。 */
  onSelectViewTab?: (key: string) => void;
  /** 「+」菜单里可打开的视图（页面知识，见 ViewTabStrip）。 */
  openableViews?: Array<OpenableView>;
  /** 项目 id → 项目名（页签标题用「工坊·雾中来信」区分同视图多页）。 */
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  /**
   * 视图页签（首页 / 模型 / 工坊·项目名 …）。不传时本组件行为与从前一致：
   * 只渲染 iframe 页签，主应用是唯一的「主应用」页签。
   */
  viewTabs?: Array<ViewTab>;
};

/**
 * 无法内嵌时在**页签内**渲染的说明：以前会弹一个（多半也空白的）独立窗口，用户既没得到内容也不知道为什么；现在页签照常打开，给出成因与下一步，让失败可读、可行动而不是一片空白（ISSUE #310）。
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
  /* 这一枚「复制地址」的文本就在旁边那行`<code>` 里印着，失败时用户能直接
   * 手动选中复制 —— 所以失败**显式静默**（规范 16 §16.2.4.43 的`"silent"`），
   * 而成功亮一下「已复制」，让用户知道点中了。收口前两者都没有：点下去
   * 界面上什么都不变，成没成全靠猜。 */
  const copied = useFlashState();
  const copyUrl = useCopyFeedback({
    onSuccess: () => {
      copied.flash();
    },
    onFailure: "silent",
  });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-xl gap-3 text-center">
        <p className="text-ink-bright text-base font-medium">无法在此页签中显示 {label}</p>
        <p className="text-ink-muted text-sm leading-relaxed">{reason}</p>
        <p className="text-ink-fainter text-xs leading-relaxed">
          通常重启 ComfyUI 即可恢复（应用会自动以放行内嵌的参数拉起它）。
        </p>
      </div>
      {/* 地址是唯一能「自己验证」的信息：复制到浏览器里能打开 → 拦的是应用外壳
       * 的跨源 frame 策略；浏览器里也打不开 → 拦的是 ComfyUI 自己。此前只剩
       * 「已阻止此内容」一句时，两种情形长得一模一样（ISSUE #310）。 */}
      {url !== undefined && url !== null && url !== "" && (
        <div className="border-border-subtle bg-subtle/40 flex max-w-xl items-center gap-2 rounded-md border px-3 py-2">
          <TruncatedText className="text-ink-muted truncate font-mono text-xs">{url}</TruncatedText>
          <Button
            className="text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto shrink-0 rounded px-2 py-1"
            onClick={() => {
              copyUrl(url);
            }}
            size="xs"
            variant="ghost"
          >
            {/* 文案自己换掉是「已复制」唯一的存在感 —— 而它在密集的工具条里
                只是一次极轻的字形变化，很容易被当成没反应。闪一下（`value-tick`，
                规范 06 §6.7 第 ③ 档）把这一格变成「按下去有东西发生」；
                时长 220ms、位移 0，与 `useFlashState` 的 1.5s 亮起期叠加不冲突。
                `key` 换值即重播，连点两次就有两次反馈（不必额外做重入判据）。 */}
            <span className="value-tick" key={copied.on ? "done" : "idle"}>
              {copied.on ? "已复制" : "复制地址"}
            </span>
          </Button>
        </div>
      )}
      <p className="text-ink-fainter max-w-xl text-center text-xs leading-relaxed">
        也可以到 设置 → 创作后端，点「在浏览器打开」直接查看。
      </p>
    </div>
  );
}

export function ShellTabs({
  children,
  viewTabs,
  activeViewKey,
  projectNameOf,
  onSelectViewTab,
  onCloseViewTab,
  openableViews,
  onOpenView,
}: ShellTabsProps) {
  const tabs = useShellTabs((s) => s.tabs);
  const activeTabId = useShellTabs((s) => s.activeTabId);
  const activateTab = useShellTabs((s) => s.activateTab);
  const closeTab = useShellTabs((s) => s.closeTab);

  /* 壳探测（SSR 恒 false，客户端再取真值）—— 判据与 `AppShell` 共用一处，
     否则会出现「壳里两条栏、浏览器里零条栏」这种各自自洽的错。 */
  const useTitleBar = useTitleBarTabsActive();

  const contentTabs = tabs.filter((t) => t.id !== MAIN_TAB_ID);

  /* ISSUE #3807：标题行在这里**组装**、在 `AppShell` 的内容列顶部**落位**。
     整窗第一行会把侧栏一起推下 36px，那正是「壳里首页不贴顶」的根因；
     放内容列里则与浏览器态 `ViewTabStrip` 同位，折叠侧栏时左边缘也自动跟着收窄。 */
  const titleBarSlot = useTitleBar ? (
    <TitleBarTabs
      activeTabId={activeTabId}
      activeViewKey={activeViewKey}
      onActivate={activateTab}
      onClose={closeTab}
      onCloseViewTab={onCloseViewTab}
      onOpenView={onOpenView}
      onSelectViewTab={onSelectViewTab}
      openableViews={openableViews}
      projectNameOf={projectNameOf}
      tabs={tabs}
      viewTabs={viewTabs}
    />
  ) : null;

  return (
    <TitleBarSlotProvider slot={titleBarSlot}>
      <div className="bg-canvas text-ink flex h-screen w-screen flex-col overflow-hidden">
        {/* 内容区：主应用与 ComfyUI 均保持挂载，用 CSS 显隐切换，避免丢态。底部间距只给主应用（pb-6）：全局底部状态栏（根布局挂载的 24px 固定悬浮层）盖住窗口最底下一条。
            而 ComfyUI iframe 必须拿满「页签栏以下」的全部高度 —— 它与浏览器整窗打开时一样要容纳自绘的底部控件（运行操作栏、扩展面板），少一截就出现「浏览器里看得见、应用里被裁掉」（状态栏在非主应用页签会隐藏，见 BrowserStatusBar）。 */}
        <div className="relative min-h-0 flex-1">
          {/* 主应用页签（恒挂载，用 CSS 显隐） */}
          <div className={activeTabId === MAIN_TAB_ID ? "h-full pb-6" : "hidden h-full pb-6"}>
            {children}
          </div>

          {/* 已打开的非主应用页签（iframe），同样保持挂载 */}
          {contentTabs.map((tab) => (
            <div
              aria-hidden={activeTabId !== tab.id}
              className={activeTabId === tab.id ? "h-full" : "hidden h-full"}
              key={tab.id}
            >
              {tab.blockedReason !== undefined &&
              tab.blockedReason !== null &&
              tab.blockedReason !== "" ? (
                <TabBlockedNotice
                  label={tab.label}
                  reason={tab.blockedReason}
                  url={tab.blockedUrl}
                />
              ) : tab.url !== undefined && tab.url !== null && tab.url !== "" ? (
                <iframe
                  className="h-full w-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
                  src={tab.url}
                  title={tab.label}
                />
              ) : (
                <div className="text-ink-muted flex h-full items-center justify-center">
                  页签内容为空
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </TitleBarSlotProvider>
  );
}
