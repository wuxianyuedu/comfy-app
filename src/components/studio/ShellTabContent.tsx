"use client";

/* ── ShellTabContent · 桌面壳 iframe 页签的内容（第③层视图）──────────
 * 渲染在 `AppShell` 的内容列里，与主应用内容同列、用 CSS 显隐切换 ——
 * 不再整窗覆盖：覆盖式渲染会把侧栏（页签切换器的宿主，#4770）与标题行
 * 窗口按钮一起藏掉，用户切不回主应用（ISSUE #4898）。
 * 已打开的页签保持挂载（切走不卸载，ComfyUI 不因切回主应用而重载）。
 * 两条契约沿用 #1244：可嵌 → iframe（`title` = 页签名）；不可嵌 → 页签内
 * 可读说明（带地址），不塞注定空白的 iframe。
 */

import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { Button } from "~/components/ui/button";
import { TruncatedText } from "~/components/ui/truncated-text";
import type { ShellTab } from "~/lib/shell/shell-tabs-store";

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
   * 而成功亮一下「已复制」，让用户知道点中了。 */
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

export function ShellTabContent({
  activeTabId,
  tabs,
}: {
  /** 当前激活的页签 id；主应用页签激活时这里所有页签都显隐成 hidden。 */
  activeTabId: string;
  /** 已打开的非主应用页签（主应用内容由 `AppShell` 直接承载，不在这里）。 */
  tabs: Array<ShellTab>;
}) {
  return (
    <>
      {tabs.map((tab) => (
        <div
          aria-hidden={activeTabId !== tab.id}
          className={activeTabId === tab.id ? "min-h-0 flex-1" : "hidden min-h-0 flex-1"}
          key={tab.id}
        >
          {tab.blockedReason !== undefined &&
          tab.blockedReason !== null &&
          tab.blockedReason !== "" ? (
            <TabBlockedNotice label={tab.label} reason={tab.blockedReason} url={tab.blockedUrl} />
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
    </>
  );
}
