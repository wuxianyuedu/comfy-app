"use client";

/**
 * SettingsView —— 设置界面的**一份**主体：三态（首帧 loading / 失败降级 /
 * 就绪）+ 外壳与分区导航。
 *
 * 为什么要有这个文件：此前它存在两份逐字相近的实现 —— 独立路由
 * `src/app/(main)/settings/page.tsx` 与工作区内的全屏浮层
 * `SettingsOverlay.tsx`（后者还反过来从路由文件 import 降级视图，方向是拧的）。
 * 两份「三态」意味着改一处状态机要记得改两处，而漏掉的那处只在特定分支才现形。
 * 现在两个挂载点各只负责「多高」，内容只有一份。
 *
 * 两个挂载点的差别（刻意只剩一条：多高）：
 *   · 独立路由 `/settings`：自己给出视口高度（`SettingsShell` 的默认档）——
 *     它是浏览器地址栏直达的入口，没有「返回工作区」这一层。
 *   · 工作区视图（页签「设置」）：高度由外层视图容器给（`fillHeight`），
 *     而「关」这件事由页签自己的关闭按钮承担，视图内部不再另画一枚。
 *     （这里曾有一个 `onBack` prop 给失败态加一条「返回工作区」退路，但两个挂载点
 *     都不传 ⇒ 那条分支永远进不去，失败态看着有退路其实没有。按 §12.16 删掉。）
 */

import { useCallback, useState } from "react";
import { ChevronRight, Copy } from "lucide-react";

import { SettingsShell } from "~/components/settings/SettingsShell";
import { Button, buttonVariants } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Hint } from "~/components/ui/hint";
import { PageLoading } from "~/components/ui/page-loading";
import { copyFailureText, useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { cn } from "~/lib/utils";
import { useLogPanel } from "~/components/studio/logs/LogProvider";

import { SettingsPageView } from "~/app/(main)/settings/SettingsPageView";
import { useSettingsPage } from "~/app/(main)/settings/hooks/use-settings-page";

export type SettingsViewProps = {
  /** 撑满父级高度（工作区视图里由外层给视口高度）；缺省走外壳自己的视口档。 */
  fillHeight?: boolean;
  /**
   * 跳转时要求直接停驻的目标分区 id（来自 `workspace:navigate` 事件的一次性
   * 载荷）。工作区页签挂载点会传；独立路由 `/settings` 不传，保持默认分区。
   * 合法性由 `useSettingsPage` 按 `SETTINGS_SECTIONS` 收敛。
   */
  initialSection?: string | null;
  /** 目标分区已落定后回调（容器据此清空一次性载荷）。 */
  onConsumeSection?: () => void;
};

export function SettingsView({ fillHeight, initialSection, onConsumeSection }: SettingsViewProps) {
  const c = useSettingsPage({
    initialSection,
    onConsumeInitialSection: onConsumeSection,
  });

  /* 屏名只在「这一屏才出现」时给可见标题（ISSUE #1872）：工作区页签（`fillHeight`）
   * 的页签条与顶栏已经在写「设置」，屏内再写一遍是同一个名字的第三次出现 —— 那时
   * 不传 `title`，屏名以 `sr-only` 留在 DOM；独立路由 `/settings` 没有顶栏也不显示
   * 页签，屏名只在这一屏出现，仍给可见标题。 */
  const frame = {
    onSelect: c.setSection,
    section: c.section,
    /* 跳转载荷的落点透给外壳：三态壳也带着它 —— 加载壳没有分区节、滚不过去也
     * 不会消费载荷；就绪壳挂上后再滚到目标分区。 */
    jumpSection: c.pendingJump,
    onJumpApplied: c.ackJumpSection,
    ...(fillHeight ? { className: "h-full" } : { title: "设置" }),
  };

  /* 打开即先渲染「外壳 + 分区导航」，内容区走三态；不再用整屏 loading 挡导航。 */
  if (c.isInitialLoad) {
    return (
      <SettingsShell {...frame} fallback={<PageLoading className="bg-bg min-h-[60vh] pb-6" />} />
    );
  }

  if (c.hasError) {
    return (
      <SettingsShell
        {...frame}
        fallback={
          <div className="relative">
            <SettingsLoadError errorText={c.errorText} onRetry={c.retry} />
          </div>
        }
      />
    );
  }

  /* 兜底：既没在加载、也没失败，草稿却仍为空。正常流程不可达（查询成功必然
   * 播种草稿），真出现说明状态机漏了一个分支 —— 给出**可操作**的出口
   *（重试 + 日志面板），不给一句没有下文的冻住文案。 */
  if (!c.drafts) {
    return (
      <SettingsShell
        {...frame}
        fallback={
          <div className="relative">
            <SettingsLoadError
              errorText="配置数据未就绪（查询已结束但未返回可用配置）"
              onRetry={c.retry}
            />
          </div>
        }
      />
    );
  }

  /* `drafts` 已收窄为非空 —— 视图据此免判空。 */
  return (
    <SettingsPageView
      c={{ ...c, drafts: c.drafts }}
      {...(fillHeight ? { className: "h-full" } : { title: "设置" })}
    />
  );
}

/* ── 设置页加载失败降级视图 ──────────────────────────────────────────────
 * 此前只有一行被截断的错误文案，原始报错（如 tRPC 拿到 HTML 的
 *"Unexpected token'<'"）既看不全也没有任何出口，问题无从排查（#220）。
 * 现在：完整错误可展开、可复制；并提示打开日志面板（Ctrl+Shift+L）看
 * 全局错误与启动日志——错误本身也已由 LogProvider 的全局钩子收进面板。
 * 渲染在「设置外壳」内容区：去掉整屏高度，仅居中于内容区，随外壳滚动。 */
function SettingsLoadError({ errorText, onRetry }: { errorText: string; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const copied = useFlashState();
  /* 成败都改口（规范 16 §16.2.4.43）：收口前这里是
   *`if (await copyText(errorText)) copied.flash();` —— 失败时按钮一动不动，
   * 用户以为复制到了。 */
  const [copyFailed, setCopyFailed] = useState(false);
  const copyError = useCopyFeedback({
    onFailure: () => setCopyFailed(true),
    onSuccess: () => {
      setCopyFailed(false);
      copied.flash();
    },
  });
  const togglePanel = useLogPanel((s) => s.toggleOpen);

  /* 复制的是用户看到的这段可读文案（`errorText` 也已优先取服务端原文）；
   * 原始报错（tRPC code / 服务端 message / 堆栈首行）另见日志面板的同条记录
   * —— 视图不再手拼第二份原文，避免两处措辞漂移。 */
  const copyErrorText = useCallback(() => copyError(errorText), [copyError, errorText]);

  return (
    <div className="grid min-h-[60vh] place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-xl text-center">
        <p className="text-danger-strong">加载设置失败，请刷新重试</p>
        <p className="text-muted-foreground mt-2 truncate text-xs" title={errorText}>
          {errorText}
        </p>
        {/* 「完整错误」是一个 disclosure：点它把下面的`<pre>` 展开 —— 用
`Disclosure` 而不是自绘 chevron + 条件渲染（规范 16 §16.2.4.13；
 自绘那份没有`aria-expanded` /`aria-controls`）。
 一排按钮里只有中间那个是折叠开关，其余两个走`leading` /`trailing`
 —— 基元的 trigger 是`<button>`，往它里面塞`<Button>` 在 HTML 里
 非法（会触发水合错误）。开关自己的外观经`className` 给（它本身就是
 按钮，直接穿`buttonVariants` 的 outline 档），整排的排布在
`rootClassName`，面板靠`basis-full` 独占一行。 */}
        <Disclosure
          className={cn(
            buttonVariants({ variant: "outline" }),
            "text-muted-foreground h-auto w-auto gap-1 rounded-lg px-3 py-2 text-xs",
          )}
          leading={
            <Button className="h-auto rounded-lg px-4 py-2 text-sm" onClick={onRetry}>
              重试
            </Button>
          }
          marker="none"
          onOpenChange={setExpanded}
          open={expanded}
          panelClassName="basis-full"
          rootClassName="mt-3 flex flex-wrap items-center justify-center gap-2"
          trailing={
            <Hint label={copyFailed ? copyFailureText("下方展开区") : "复制这段错误文案"}>
              <Button
                className="text-muted-foreground h-auto items-center gap-1 rounded-lg px-3 py-2 text-xs"
                onClick={copyErrorText}
                variant="outline"
              >
                <Copy data-icon="inline-start" size={13} />
                {copyFailed ? "复制失败" : copied.on ? "已复制" : "复制"}
              </Button>
            </Hint>
          }
          trigger={
            <>
              <ChevronRight
                className={`transition-transform group-aria-expanded/disclosure:rotate-90`}
                size={13}
              />
              完整错误
            </>
          }
        >
          <pre className="border-border bg-surface-1 custom-scrollbar text-2xs mt-3 max-h-64 overflow-auto rounded-lg border p-3 text-left font-mono break-all whitespace-pre-wrap">
            {errorText}
          </pre>
        </Disclosure>
        <div className="text-muted-foreground mt-4 flex flex-col gap-1 text-xs">
          <p>
            本次失败已写入日志面板（按{""}
            <kbd className="border-border rounded border px-1 font-mono">Ctrl+Shift+L</kbd>
            {""}
            打开，筛选「错误」可快速定位）。
          </p>
          <p>
            若反复出现，先看日志面板里这条错误：启动阶段（应用服务未就绪 / 正在重启）
            和运行阶段的读取失败（如数据库表 / 字段缺失）都可能是原因——只当“服务在
            重启”处理会漏掉后者，重试也不会好。
          </p>
          <Button className="text-primary mt-1 h-auto p-0" onClick={togglePanel} variant="link">
            打开日志面板查看
          </Button>
        </div>
      </div>
    </div>
  );
}
