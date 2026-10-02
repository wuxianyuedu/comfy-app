"use client";

/* ── ShellTabs · 应用级「页签」容器（桌面壳标题行页签 + 内容区）────
 *
 * 设计目标：在 Tauri 主窗口里把「主应用」（workspace）与「内嵌的 ComfyUI」
 * 收进同一个窗口的页签，一条可切换、可关闭的页签栏，替代此前会弹出空白独立
 * 窗口的 open_comfyui_window 方案（ISSUE #310 / #200）。
 *
 * 两种环境形态（判据见`shouldUseTitleBarTabs`）：
 * - **桌面壳内**：主窗口关闭原生装饰，由`TitleBarTabs` 接管整条标题栏
 * （页签 + 拖拽区 + 最小化/最大化/关闭），不再额外占用应用内区域。
 * - **浏览器 / dev**：**不渲染 iframe 页签栏**（不是「任何页签栏」）。浏览器自带
 * 页签栏，再画一条切外部页面的假页签栏既占纵向空间又与原生重复；ComfyUI 改由「新浏览器页签」打开。
 * 但**视图页签条照常渲染** —— 它切的是应用内视图，与浏览器自己的标签页不是同一件事，
 * 不构成重复；而且它是项目内那六个视图的唯一入口（`ProjectTabBar` 已退役）。
 * （见 `use-settings-page` 的 openComfy 浏览器分支 + `comfy-embed.ts`
 * `shouldUseBrowserTab`）。此时 store 里恒只有主应用页签、iframe 区为空，
 * 本组件只承载 children。
 *
 * 标题栏的高度与可点层级由`TitleBarTabs` 自行持有（本组件不再渲染标题行）：
 * 全屏视图层按标题行高度让位，且标题行须走 chrome 档层级，否则会被整视口遮罩
 * 压住命中测试（见 launch-and-build §5）。
 *
 * 关键取舍：
 * - 主应用内容（children）与已打开的 ComfyUI iframe 都**始终挂载**，
 * 用 CSS 显隐切换，而不是条件卸载——这样切页签不会丢 workspace 的
 * viewMode / 画布编辑态，ComfyUI 页面也不会因卸载而重载。
 * - 主应用页签（id="main"）不可关闭；ComfyUI 页签（仅桌面壳内存在）可按需关闭。
 * - 页签状态由 shell-tabs-store 管理（纯状态层），本组件只做渲染与
 * 动作转发，符合规范 17 的四层归属。
 *
 * 样式说明：内容区高度为「窗口高 - 页签栏高（桌面壳）/ 全高（浏览器）」，主应用内部用 h-full 布局。
 */

import { useShellTabs, MAIN_TAB_ID } from "~/lib/shell/shell-tabs-store";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { TitleBarTabs } from "./TitleBarTabs";
import { type ViewTab } from "./workspace-tabs";
import { type OpenableView } from "./ViewTabStrip";
import { type WorkspaceView } from "./NavItems";
import { Button } from "~/components/ui/button";

interface ShellTabsProps {
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
  /**
   * 视图页签（首页 / 模型 / 工坊·项目名 …）。不传时本组件行为与从前一致：
   * 只渲染 iframe 页签，主应用是唯一的「主应用」页签。
   */
  viewTabs?: ViewTab[];
  /** 当前视图页签 key。 */
  activeViewKey?: string;
  /** 项目 id → 项目名（页签标题用「工坊·雾中来信」区分同视图多页）。 */
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  /** 选中某个视图页签。 */
  onSelectViewTab?: (key: string) => void;
  /** 关闭某个视图页签。 */
  onCloseViewTab?: (key: string) => void;
  /** 「+」菜单里可打开的视图（页面知识，见 ViewTabStrip）。 */
  openableViews?: OpenableView[];
  /** 从「+」菜单里选了一个视图。 */
  onOpenView?: (view: WorkspaceView) => void;
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
  /* 这一枚「复制地址」的文本就在旁边那行`<code>` 里印着，失败时用户能直接
   * 手动选中复制 —— 所以失败**显式静默**（规范 16 §16.2.4.43 的`"silent"`），
   * 而成功亮一下「已复制」，让用户知道点中了。收口前两者都没有：点下去
   * 界面上什么都不变，成没成全靠猜。 */
  const copied = useFlashState();
  const copyUrl = useCopyFeedback({
    onSuccess: () => copied.flash(),
    onFailure: "silent",
  });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-xl gap-3 text-center">
        <p className="text-ink-bright text-base font-medium">
          无法在此页签中显示 {label}
        </p>
        <p className="text-ink-muted text-sm leading-relaxed">{reason}</p>
        <p className="text-ink-fainter text-xs leading-relaxed">
          通常重启 ComfyUI 即可恢复（应用会自动以放行内嵌的参数拉起它）。
        </p>
      </div>
      {/* 地址是唯一能「自己验证」的信息：复制到浏览器里能打开 → 拦的是应用外壳
       * 的跨源 frame 策略；浏览器里也打不开 → 拦的是 ComfyUI 自己。此前只剩
       * 「已阻止此内容」一句时，两种情形长得一模一样（ISSUE #310）。 */}
      {url && (
        <div className="border-border-subtle bg-subtle/40 flex max-w-xl items-center gap-2 rounded-md border px-3 py-2">
          <code className="text-ink-muted truncate text-xs">{url}</code>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => copyUrl(url)}
            className="text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto shrink-0 rounded px-2 py-1"
          >
            {copied.on ? "已复制" : "复制地址"}
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

  return (
    <div
      // 桌面壳里顶部有自定义标题行（TitleBarTabs）；打 data-shell 让全局 CSS 把
      // fixed 的 shadcn 侧栏容器让出标题行高度（否则侧栏顶部会被那条标题行盖住）。
      // 浏览器 / dev 无标题行，不打此属性，侧栏仍从视口顶起。
      data-shell={useTitleBar ? "" : undefined}
      className="bg-canvas text-ink flex h-screen w-screen flex-col overflow-hidden"
    >
      {useTitleBar ? (
        <TitleBarTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
          viewTabs={viewTabs}
          activeViewKey={activeViewKey}
          projectNameOf={projectNameOf}
          onSelectViewTab={onSelectViewTab}
          onCloseViewTab={onCloseViewTab}
          openableViews={openableViews}
          onOpenView={onOpenView}
        />
      ) : null}

      {/* 浏览器 / dev 形态的视图页签栏**不在这里渲染** —— 本组件这一层是整窗宽度，
          而侧栏是 fixed 定位，栏放在这里会被侧栏压住（实测关闭按钮「subtree intercepts
          pointer events」）。它渲染在 `AppShell` 的内容列里，那里已经算好了侧栏偏移。 */}

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
              <div className="text-ink-muted flex h-full items-center justify-center">
                页签内容为空
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
