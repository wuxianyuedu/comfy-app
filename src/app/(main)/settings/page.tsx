"use client";

/**
 * 设置页容器（规范 17 §17.2 第④层）。
 *
 * 全部 tRPC 查询、草稿状态、Ollama 探测与保存动作搬进
 * `hooks/use-settings-page.ts`，两处裸 `fetch` 搬进 `lib/llm/ollama-client.ts`，
 * JSX 搬进 `SettingsPageView.tsx`。
 *
 * 打开即先渲染「设置外壳（header + 分区导航）+ 内容区三态」，让界面框架秒开；
 * 不再用整屏 loading 挡掉导航，等全部配置就绪。就绪后内容区交回
 * `SettingsPageView`（其自身也复用同一外壳）。
 *
 * 加载失败态复用日志面板的可读报错视图（`SettingsLoadError`，见文件底部）：
 * 完整错误可展开 / 复制，并引导打开日志面板定位（#220）。原生的简单重试视图
 * 已被其取代，这里仅在内容区渲染外壳 + 该错误视图。
 */

import { useCallback, useState } from "react";
import { ChevronRight, Copy } from "lucide-react";

import { Button, buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { PageLoading } from "~/components/ui/page-loading";
import { Disclosure } from "~/components/ui/disclosure";
import { SettingsShell } from "~/components/settings/SettingsShell";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

import { SettingsPageView } from "./SettingsPageView";
import { useSettingsPage } from "./hooks/use-settings-page";

export default function SettingsPage() {
  const c = useSettingsPage();

  const frame = { section: c.section, onSelect: c.setSection };

  // 仅在首次加载且无数据时，内容区显示局部 loading（框架与导航已秒开）
  if (c.isInitialLoad) {
    return (
      <SettingsShell {...frame}>
        <PageLoading className="bg-bg min-h-[60vh] pb-6" />
      </SettingsShell>
    );
  }

  if (c.hasError) {
    return (
      <SettingsShell {...frame}>
        <SettingsLoadError errorText={c.errorText} onRetry={c.retry} />
      </SettingsShell>
    );
  }

  /* 兜底：既没在加载、也没失败，草稿却仍为空。正常流程不可达（查询成功必然
   * 播种草稿），真出现说明状态机漏了一个分支——给出**可操作**的出口（重试 +
   * 日志面板），而不是一句没有下文的「配置数据未就绪」冻住用户。 */
  if (!c.drafts) {
    return (
      <SettingsShell {...frame}>
        <SettingsLoadError
          errorText="配置数据未就绪（查询已结束但未返回可用配置）"
          onRetry={c.retry}
        />
      </SettingsShell>
    );
  }

  /* `drafts` 已收窄为非空 —— 视图据此免判空。 */
  return <SettingsPageView c={{ ...c, drafts: c.drafts }} />;
}

/* ── 设置页加载失败降级视图 ──────────────────────────────────────────────
 * 此前只有一行被截断的错误文案，原始报错（如 tRPC 拿到 HTML 的
 * "Unexpected token '<'"）既看不全也没有任何出口，问题无从排查（#220）。
 * 现在：完整错误可展开、可复制；并提示打开日志面板（Ctrl+Shift+L）看
 * 全局错误与启动日志——错误本身也已由 LogProvider 的全局钩子收进面板。
 * 渲染在「设置外壳」内容区：去掉整屏高度，仅居中于内容区，随外壳滚动。 */
export function SettingsLoadError({
  errorText,
  onRetry,
}: {
  errorText: string;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const copied = useFlashState();
  /* 成败都改口（规范 16 §16.2.4.43）：收口前这里是
   * `if (await copyText(errorText)) copied.flash();` —— 失败时按钮一动不动，
   * 用户以为复制到了。 */
  const [copyFailed, setCopyFailed] = useState(false);
  const copyError = useCopyFeedback({
    onSuccess: () => {
      setCopyFailed(false);
      copied.flash();
    },
    onFailure: () => setCopyFailed(true),
  });
  const togglePanel = useLogPanel((s) => s.toggleOpen);

  /* 复制的是用户看到的这段可读文案（`errorText` 也已优先取服务端原文）；
   * 原始报错（tRPC code / 服务端 message / 堆栈首行）另见日志面板的同条记录
   * —— 视图不再手拼第二份原文，避免两处措辞漂移。 */
  const copyErrorText = useCallback(
    () => copyError(errorText),
    [copyError, errorText],
  );

  return (
    <div className="grid min-h-[60vh] place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-xl text-center">
        <p className="text-danger-strong">加载设置失败，请刷新重试</p>
        <p
          className="text-muted-foreground mt-2 truncate text-xs"
          title={errorText}
        >
          {errorText}
        </p>
        {/* 「完整错误」是一个 disclosure：点它把下面的 `<pre>` 展开 —— 用
            `Disclosure` 而不是自绘 chevron + 条件渲染（规范 16 §16.2.4.13；
            自绘那份没有 `aria-expanded` / `aria-controls`）。
            一排按钮里只有中间那个是折叠开关，其余两个走 `leading` / `trailing`
            —— 基元的 trigger 是 `<button>`，往它里面塞 `<Button>` 在 HTML 里
            非法（会触发水合错误）。开关自己的外观经 `className` 给（它本身就是
            按钮，直接穿 `buttonVariants` 的 outline 档），整排的排布在
            `rootClassName`，面板靠 `basis-full` 独占一行。 */}
        <Disclosure
          open={expanded}
          onOpenChange={setExpanded}
          marker="none"
          rootClassName="mt-3 flex flex-wrap items-center justify-center gap-2"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "text-muted-foreground h-auto w-auto gap-1 rounded-lg px-3 py-2 text-xs",
          )}
          panelClassName="basis-full"
          leading={
            <Button
              onClick={onRetry}
              className="h-auto rounded-lg px-4 py-2 text-sm"
            >
              重试
            </Button>
          }
          trigger={
            <>
              <ChevronRight
                size={13}
                className={`transition-transform group-aria-expanded/disclosure:rotate-90`}
              />
              完整错误
            </>
          }
          trailing={
            <Button
              variant="outline"
              onClick={copyErrorText}
              className="text-muted-foreground h-auto items-center gap-1 rounded-lg px-3 py-2 text-xs"
              title={
                copyFailed
                  ? "复制失败：剪贴板不可用，请在下方展开后手动选中复制"
                  : "复制这段错误文案"
              }
            >
              <Copy size={13} />
              {copyFailed ? "复制失败" : copied.on ? "已复制" : "复制"}
            </Button>
          }
        >
          <pre className="border-border bg-surface-1 custom-scrollbar mt-3 max-h-64 overflow-auto rounded-lg border p-3 text-left font-mono text-[11px] break-all whitespace-pre-wrap">
            {errorText}
          </pre>
        </Disclosure>
        <div className="text-muted-foreground mt-4 space-y-1 text-xs">
          <p>
            本次失败已写入日志面板（按{" "}
            <kbd className="border-border rounded border px-1 font-mono">
              Ctrl+Shift+L
            </kbd>{" "}
            打开，筛选「错误」可快速定位）。
          </p>
          <p>
            若反复出现，先看日志面板里这条错误：启动阶段（应用服务未就绪 /
            正在重启） 和运行阶段的读取失败（如数据库表 /
            字段缺失）都可能是原因——只当“服务在
            重启”处理会漏掉后者，重试也不会好。
          </p>
          <Button
            variant="link"
            onClick={togglePanel}
            className="text-primary mt-1 h-auto p-0"
          >
            打开日志面板查看
          </Button>
        </div>
      </div>
    </div>
  );
}
