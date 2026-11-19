"use client";

// 项目主页 —— 进入项目后落在这里（不再直接上画布）。
// 项目此前没有门面：点开就是无限画布，而阶段/角色/镜头/成片/AI 自主成片进度散在三个视图里。
// 上半屏给状态，下半屏给「AI 自主成片」操纵台。分层（规范 17 §17.2）：逻辑 use-project-home，视图本文件
// + ProjectHomeStatus，复用 agent-run/RunControlBar。主页不复制画布/工坊/成片的功能 —— 只回答状态与入口，
// 两处都能编辑就会有两份真值。

import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { ProgressBar } from "~/components/ui/progress-bar";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { RunControlBar } from "~/components/agent-run/RunControlBar";
import { cn } from "~/lib/utils";
import type { WorkspaceView } from "../NavItems";
import { ProjectHomeStatus } from "./ProjectHomeStatus";
import { SeriesOrganizer } from "./SeriesOrganizer";
import { useProjectHome } from "./hooks/use-project-home";

/** 一处「去这个视图继续」的入口。 */
type HomeEntry = {
  desc: string;
  id: WorkspaceView;
  label: string;
};

const ENTRIES: Array<HomeEntry> = [
  { id: "workshop", label: "全链路工坊", desc: "剧本 → 分镜 → 成片" },
  { id: "canvas", label: "画布", desc: "自由编排节点工作流" },
  { id: "outputs", label: "产出", desc: "看这个项目生成了什么" },
  { id: "film", label: "成片", desc: "时间线与合成" },
];

export type ProjectHomePageProps = {
  /** 切到项目内的某个页签。 */
  onNavigate: (view: WorkspaceView) => void;
  /** 当前项目 id（活跃项目）—— 供「系列归层」面板把本项目挂到某集。 */
  projectId?: string;
  /** 当前项目名（由 workspace 从本地项目索引读，主页不重复读一份）。 */
  projectName: string;
};

export function ProjectHomePage({ projectName, onNavigate, projectId }: ProjectHomePageProps) {
  const controller = useProjectHome();
  const { overview, headline, loading } = controller;

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="flex flex-col gap-6 px-8 py-10"
      width="narrow"
    >
      {/* ── 项目标识 + 一句话进展 ─────────────────────────── */}
      <header className="flex flex-col gap-2">
        <Hint label={projectName}>
          <h1 className="u-title-page truncate">{projectName}</h1>
        </Hint>
        <p className="text-ink-muted text-sm">{loading ? "正在读取项目状态…" : headline}</p>
      </header>

      {/* ── 总进度：一条，口径 = 六个完成阶段的等权平均 ────── */}
      <ProgressBar
        ariaLabel="项目整体完成度"
        label="项目进度"
        trackClassName="h-1.5"
        value={loading ? null : overview.progressPct}
      />

      {/* ── 状态卡：阶段条 + 计数 ─────────────────────────── */}
      <ProjectHomeStatus loading={loading} onNavigate={onNavigate} overview={overview} />

      {/* ── AI 自主成片：与工坊 / 画布同一份 run 的操纵台 ──── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="u-title">AI 自主成片</h2>
          <span className="text-ink-faint text-xs">从剧本一路跑到合成，可随时叫停或逐步点头</span>
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
              className={cn(
                "border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2",
                "flex h-auto flex-col items-start gap-1 rounded-2xl border p-4 text-left font-normal",
              )}
              key={entry.id}
              onClick={() => {
                onNavigate(entry.id);
              }}
              variant="ghost"
            >
              <span className="text-ink-bright text-sm font-medium">{entry.label}</span>
              <span className="text-ink-muted text-xs">{entry.desc}</span>
            </Button>
          ))}
        </div>
      </section>

      {/* ── 系列归层：FR-SR-01/02（#2477）────────────────── */}
      <SeriesOrganizer projectId={projectId} />
    </DocumentFrame>
  );
}
