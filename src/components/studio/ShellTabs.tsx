"use client";

/* ── ShellTabs · 应用级「页签」容器（桌面壳标题行 + 内容区）──────────
 * 在 Tauri 主窗口里把「主应用」（workspace）与「内嵌的 ComfyUI」收进同一窗口，
 * 替代此前会弹出空白独立窗口的 `open_comfyui_window`（ISSUE #310 / #200）。
 * 两种形态（判据 `shouldUseTitleBarTabs`）：桌面壳内由 `TitleBar` 承载标题行
 * （拖拽区 + 窗口按钮，页签已退役，ISSUE #4770）；浏览器 / dev 无标题行。
 * 已打开页签的**切换器**在左侧栏「临时页签」组（`SidebarTempTabs`）—— 视图页签
 * 与 iframe 页签都在那里列出；本组件只负责**内容**：已打开的 iframe 页签保持
 * 挂载、用 CSS 显隐切换（切走不丢 workspace 状态，ComfyUI 不因卸载重载）。
 *
 * **标题行放哪儿（ISSUE #3807）**：它不是整窗 flex 流的第一行，而是经
 * `TitleBarSlotProvider` 交给 `AppShell`，渲染在**内容列顶部**，侧栏不让位，
 * 两形态都从视口 y=0 起。窗口按钮与拖拽区仍在标题行里，#310 的无边框窗口
 * 功能一条没丢；`ShellFullPage` 自带的精简标题行仍用 `data-shell` 让位，不受影响。
 *
 * 关键取舍：主应用内容与已打开的 ComfyUI iframe 都**始终挂载**、用 CSS 显隐切换；
 * 标题行高度与可点层级由 `TitleBar` 自持（须走 chrome 档层级，否则被整视口遮罩
 * 压住命中测试，见 launch-and-build §5）；iframe 页签状态在 shell-tabs-store，
 * 本组件只做渲染（规范 17 四层归属）。内容区占满视口，底部 `pb-6` 给全局状态栏让位。
 */

import { useShellTabs, MAIN_TAB_ID } from "~/lib/shell/shell-tabs-store";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { TitleBarSlotProvider } from "./TitleBarSlot";
import { TitleBar } from "./TitleBar";
import { Button } from "~/components/ui/button";
import { TruncatedText } from "~/components/ui/truncated-text";

type ShellTabsProps = {
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
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

export function ShellTabs({ children }: ShellTabsProps) {
  const tabs = useShellTabs((s) => s.tabs);
  const activeTabId = useShellTabs((s) => s.activeTabId);

  /* 壳探测（SSR 恒 false，客户端再取真值）—— 判据与 `AppShell` 共用一处，
     否则会出现「壳里两条栏、浏览器里零条栏」这种各自自洽的错。 */
  const useTitleBar = useTitleBarTabsActive();

  const contentTabs = tabs.filter((t) => t.id !== MAIN_TAB_ID);

  /* ISSUE #3807：标题行在这里**组装**、在 `AppShell` 的内容列顶部**落位**。
     整窗第一行会把侧栏一起推下 36px，那正是「壳里首页不贴顶」的根因；
     放内容列里则与浏览器态同位，折叠侧栏时左边缘也自动跟着收窄。
     页签已退役（ISSUE #4770）：标题行只剩拖拽区与窗口按钮。 */
  const titleBarSlot = useTitleBar ? <TitleBar /> : null;

  return (
    <TitleBarSlotProvider slot={titleBarSlot}>
      <div className="bg-canvas text-ink flex h-screen w-screen flex-col overflow-hidden">
        {/* 内容区：主应用与 ComfyUI 均保持挂载，用 CSS 显隐切换，避免丢态。底部间距只给主应用（pb-6）：全局底部状态栏（根布局挂载的 24px 固定悬浮层）盖住窗口最底下一条。
            而 ComfyUI iframe 必须拿满「标题行以下」的全部高度 —— 它与浏览器整窗打开时一样要容纳自绘的底部控件（运行操作栏、扩展面板），少一截就出现「浏览器里看得见、应用里被裁掉」（状态栏在非主应用页签会隐藏，见 BrowserStatusBar）。 */}
        <div className="relative min-h-0 flex-1">
          {/* 主应用页签（恒挂载，用 CSS 显隐） */}
          <div className={activeTabId === MAIN_TAB_ID ? "h-full pb-6" : "hidden h-full pb-6"}>
            {children}
          </div>

          {/* 已打开的非主应用页签（iframe），同样保持挂载；切换器在侧栏「临时页签」组 */}
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
