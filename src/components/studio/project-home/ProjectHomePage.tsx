"use client";

// 项目主页 —— 进入项目后落在这里（不再是直接怼上画布）。
//
// 为什么要有这一屏：项目此前**没有自己的门面**。点开一个项目直接就是无限画布，
// 而项目真正携带的信息（做到哪一阶段、有多少角色/镜头/成片、AI 自主成片跑到哪了）
// 散在三个视图里，没有一处能回答「这个项目现在是什么状态」。这里就是那一处：
// 上半屏给状态，下半屏给「AI 自主成片」这条主动作的操纵台。
//
// 分层（规范 17 §17.2）：
//   · 逻辑   `./hooks/use-project-home.ts`（取 production + 复用 agent-run 的 run）
//   · 视图   本文件（标题 + 状态条）与 `ProjectHomeStatus.tsx`（状态卡）
//   · 复用   `agent-run/RunControlBar`（工坊与画布共用同一份 run 的控制条，
//            主页不再新写一套「启动/暂停/确认」）
//
// ⚠️ 主页**不复制画布 / 工坊 / 成片的功能**：它只回答状态与入口。能不能创作
// 仍然去对应页签 —— 两处都能编辑就会有两份真值（§16.2.4 的同一教训）。

import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { RunControlBar } from "~/components/agent-run/RunControlBar";
import { cn } from "~/lib/utils";
import type { WorkspaceView } from "../NavItems";
import { ProjectHomeStatus } from "./ProjectHomeStatus";
import { useProjectHome } from "./hooks/use-project-home";

/** 一处「去这个视图继续」的入口。 */
interface HomeEntry {
  id: WorkspaceView;
  label: string;
  desc: string;
}

const ENTRIES: HomeEntry[] = [
  { id: "workshop", label: "全链路工坊", desc: "剧本 → 分镜 → 成片" },
  { id: "canvas", label: "画布", desc: "自由编排节点工作流" },
  { id: "outputs", label: "产出", desc: "看这个项目生成了什么" },
  { id: "film", label: "成片", desc: "时间线与合成" },
];

export interface ProjectHomePageProps {
  /** 当前项目名（由 workspace 从本地项目索引读，主页不重复读一份）。 */
  projectName: string;
  /** 切到项目内的某个页签。 */
  onNavigate: (view: WorkspaceView) => void;
}

export function ProjectHomePage({
  projectName,
  onNavigate,
}: ProjectHomePageProps) {
  const controller = useProjectHome();
  const { overview, headline, loading } = controller;

  return (
    <DocumentFrame
      width="narrow"
      className="flex flex-col gap-6 px-8 py-10"
      backdrop={<AuroraBackground />}
    >
      {/* ── 项目标识 + 一句话进展 ─────────────────────────── */}
      <header className="flex flex-col gap-2">
        <h1 className="u-title-page truncate">{projectName}</h1>
        <p className="text-ink-muted text-sm">
          {loading ? "正在读取项目状态…" : headline}
        </p>
      </header>

      {/* ── 总进度：一条，口径 = 六个完成阶段的等权平均 ────── */}
      <ProgressBar
        value={loading ? null : overview.progressPct}
        label="项目进度"
        ariaLabel="项目整体完成度"
        trackClassName="h-1.5"
      />

      {/* ── 状态卡：阶段条 + 计数 ─────────────────────────── */}
      <ProjectHomeStatus
        overview={overview}
        loading={loading}
        onNavigate={onNavigate}
      />

      {/* ── AI 自主成片：与工坊 / 画布同一份 run 的操纵台 ──── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="u-title">AI 自主成片</h2>
          <span className="text-ink-faint text-[11px]">
            从剧本一路跑到合成，可随时叫停或逐步点头
          </span>
        </div>
        {/* RunControlBar 自带容器边框与外层留白由这里给：它是「一条横条」的
                形态（工坊里顶在阶段轨上方），放进主页卡片里需要圆角与描边 —— 
                覆盖在调用处，不动那个被两处共用的组件。 */}
        <div className="border-border bg-panel overflow-hidden rounded-2xl border">
          <RunControlBar />
        </div>
      </section>

      {/* ── 继续创作的入口 ───────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="u-title">继续创作</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ENTRIES.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              onClick={() => onNavigate(entry.id)}
              className={cn(
                "border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2",
                "flex h-auto flex-col items-start gap-1 rounded-2xl border p-4 text-left font-normal",
              )}
            >
              <span className="text-ink-bright text-sm font-medium">
                {entry.label}
              </span>
              <span className="text-ink-muted text-xs">{entry.desc}</span>
            </Button>
          ))}
        </div>
      </section>
    </DocumentFrame>
  );
}
