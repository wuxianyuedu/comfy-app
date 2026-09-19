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

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";

import { Button } from "~/components/ui/button";
import { copyText } from "~/lib/browser-io";
import { PageLoading } from "~/components/ui/page-loading";
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
  const [copied, setCopied] = useState(false);
  const togglePanel = useLogPanel((s) => s.toggleOpen);

  /* 复制的是用户看到的这段可读文案（`errorText` 也已优先取服务端原文）；
   * 原始报错（tRPC code / 服务端 message / 堆栈首行）另见日志面板的同条记录
   * —— 视图不再手拼第二份原文，避免两处措辞漂移。 */
  const copyError = async () => {
    /* 剪贴板不可用（非安全上下文等）时静默失败，用户仍可展开后手动选择复制。 */
    if (await copyText(errorText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

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
        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            onClick={onRetry}
            className="h-auto rounded-lg px-4 py-2 text-sm"
          >
            重试
          </Button>
          <Button
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground h-auto items-center gap-1 rounded-lg px-3 py-2 text-xs"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            完整错误
          </Button>
          <Button
            variant="outline"
            onClick={() => void copyError()}
            className="text-muted-foreground h-auto items-center gap-1 rounded-lg px-3 py-2 text-xs"
          >
            <Copy size={13} />
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
        {expanded && (
          <pre className="border-border bg-surface-1 custom-scrollbar mt-3 max-h-64 overflow-auto rounded-lg border p-3 text-left font-mono text-[11px] break-all whitespace-pre-wrap">
            {errorText}
          </pre>
        )}
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
