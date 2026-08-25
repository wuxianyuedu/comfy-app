"use client";

import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ScriptGenerator } from "@/components/workshop/ScriptGenerator";
import { CharacterDesigner } from "@/components/workshop/CharacterDesigner";
import { StoryboardPlanner } from "@/components/workshop/StoryboardPlanner";
import { LLMProvider, LLMStatusChip, LLMSettingsButton } from "@/components/workshop/llm-context";
import { vanillaApi } from "~/trpc/vanilla";
import type {
  ProjectMeta,
  Scene,
  Character,
  Shot,
  StyleRef,
} from "@/lib/workshop/types";
import { emptyProject } from "@/lib/workshop/script-parser";

type Tab = "script" | "character" | "storyboard";

const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
  { id: "script", label: "剧本生成", icon: "filetext", hint: "灵感 → 结构化场景" },
  { id: "character", label: "角色设计", icon: "drama", hint: "角色卡 → 生图提示词" },
  { id: "storyboard", label: "分镜规划", icon: "film", hint: "场景 → 镜头 → 生图" },
];

/**
 * Reusable 创作工坊 surface. Extracted from the standalone /workshop page so it
 * can be embedded directly inside the Workspace hub (replacing the old stub)
 * as well as rendered standalone. Wrapped in `.dark` so the semantic theme
 * tokens resolve to the app's dark palette regardless of the global theme
 * toggle (the hub itself is hard-coded dark-only).
 */
export function WorkshopStudio() {
  const [tab, setTab] = React.useState<Tab>("script");
  const [meta, setMeta] = React.useState<ProjectMeta>(emptyProject("short_video"));
  const [scenes, setScenes] = React.useState<Scene[]>([]);
  const [characters, setCharacters] = React.useState<Character[]>([]);
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [styles, setStyles] = React.useState<StyleRef[]>([]);
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState("");
  const [generating, setGenerating] = React.useState(false);

  // Load styles (skills) + checkpoints
  React.useEffect(() => {
    vanillaApi.skill.list
      .query({})
      .then((data) => {
        const list: StyleRef[] = (data.skills ?? []).map((skill: any) => ({
          slug: skill.slug,
          name: skill.name,
          icon: skill.icon,
          promptTemplate: skill.promptTemplate,
          negativePrompt: skill.negativePrompt ?? undefined,
          defaultParams: (skill.defaultParams as Record<string, unknown>) ?? undefined,
        }));
        setStyles(list);
      })
      .catch(() => {});
    vanillaApi.model.list
      .query({ type: "CHECKPOINT" })
      .then((data) => {
        const names: string[] = (data.models ?? []).map((model: any) => model.fileName);
        setCheckpoints(names);
        if (names.length) setCheckpoint(names[0]!);
      })
      .catch(() => {});
  }, []);

  async function generateShot(shot: Shot) {
    if (!checkpoint) {
      alert("请先在右侧选择一个大模型（Checkpoint）");
      return;
    }
    // Mark running
    setShots((prev) => prev.map((prev) =>(prev.id === shot.id ? { ...prev, status: "running" } : prev)));

    const style = styles.find((st) => st.slug === shot.skillSlug);
    const payload: Record<string, unknown> = {
      workflow: "txt2img",
      prompt: shot.prompt,
      negative: shot.negativePrompt || undefined,
      checkpoint,
      steps: Number(shot.params.steps ?? 28),
      cfg: Number(shot.params.cfg ?? 7),
      sampler: String(shot.params.sampler ?? "euler_ancestral"),
      scheduler: String(shot.params.scheduler ?? "normal"),
      size: String(shot.params.size ?? "832x1216"),
      count: 1,
      skillSlug: style?.slug,
      skillName: style?.name,
    };

    try {
      const data = await vanillaApi.generate.generate.mutate(payload as any);
      if (data.taskId) {
        setShots((prev) =>
          prev.map((prev) =>(prev.id === shot.id ? { ...prev, status: "done", taskId: data.taskId } : prev))
        );
        // Poll for result to embed preview
        pollTask(data.taskId, shot.id);
      } else {
        throw new Error("生成失败");
      }
    } catch (err: any) {
      setShots((prev) =>
        prev.map((prev) =>(prev.id === shot.id ? { ...prev, status: "failed" } : prev))
      );
      console.error(err);
    }
  }

  async function pollTask(taskId: string, shotId: string) {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "done" || msg.type === "image") {
          const url = msg.image || (msg.images && msg.images[0]);
          if (url) {
            setShots((prev) =>
              prev.map((prev) =>(prev.id === shotId ? { ...prev, imageUrl: url } : prev))
            );
          }
          if (msg.type === "done") es.close();
        }
      } catch {}
    };
    es.onerror = () => es.close();
  }

  // Progress indicator
  const progress = {
    script: scenes.length,
    character: characters.length,
    storyboard: shots.length,
  };

  return (
    <LLMProvider>
      <div className="dark px-4 py-6 sm:px-8">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink">创作工坊 · 全链路管线</h1>
            <p className="mt-1 text-sm text-muted">
              剧本生成 → 角色设计 → 分镜规划 → 一键生图，串联你的整个创作流程。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LLMStatusChip />
            <LLMSettingsButton />
            <Link
              href="/create"
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-subtle"
            >
              前往自由创作 →
            </Link>
          </div>
        </div>

      {/* Tabs */}
      <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface p-1.5">
        {TABS.map((TABS) =>
{
          const active = tab === TABS.id;
          return (
            <button
              key={TABS.id}
              onClick={() => setTab(TABS.id)}
              className={`relative flex flex-col items-center rounded-lg px-2 py-3 text-center transition-colors ${
                active ? "bg-primary-soft text-primary" : "text-muted hover:text-ink"
              }`}
            >
              <Icon name={TABS.icon} size={20} />
              <span className="mt-1 text-sm font-medium">{TABS.label}</span>
              <span className="mt-0.5 text-[10px] opacity-70">{TABS.hint}</span>
              {progress[TABS.id] > 0 && (
                <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-white">
                  {progress[TABS.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content grid: tool + global settings */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          {tab === "script" && (
            <ScriptGenerator
              meta={meta}
              scenes={scenes}
              onMetaChange={setMeta}
              onScenesChange={setScenes}
            />
          )}
          {tab === "character" && (
            <CharacterDesigner
              characters={characters}
              styles={styles}
              onCharactersChange={setCharacters}
            />
          )}
          {tab === "storyboard" && (
            <StoryboardPlanner
              scenes={scenes}
              characters={characters}
              styles={styles}
              shots={shots}
              onShotsChange={setShots}
              onGenerate={generateShot}
              generating={generating}
            />
          )}
        </div>

        {/* Side panel: global settings + pipeline summary */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="u-title mb-3">生成设置</h3>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">大模型（Checkpoint）</span>
              <DarkSelect
                className="!bg-white/[0.03] !border-white/[0.08] text-sm"
                value={checkpoint}
                onChange={(value) => setCheckpoint(value)}
                options={checkpoints}
                placeholder={checkpoints.length === 0 ? "（无可用模型）" : "选择模型"}
              />
            </label>
            <p className="mt-2 text-xs text-muted">
              分镜生图将统一使用此模型；风格细节由所选 Skill / 角色风格标签控制。
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="u-title mb-3">管线进度</h3>
            <PipelineRow icon="filetext" label="剧本场景" count={scenes.length} active={tab === "script"} onClick={() => setTab("script")} />
            <PipelineRow icon="drama" label="角色" count={characters.length} active={tab === "character"} onClick={() => setTab("character")} />
            <PipelineRow icon="film" label="分镜镜头" count={shots.length} active={tab === "storyboard"} onClick={() => setTab("storyboard")} />
            <div className="mt-2 border-t border-border pt-2 text-xs text-muted">
              已完成生图：{shots.filter((shot) => shot.status === "done").length} / {shots.length}
            </div>
          </div>

          {meta.title && (
            <div className="rounded-xl border-primary-soft bg-primary-soft/30 p-4">
              <p className="text-xs text-muted">当前项目</p>
              <p className="mt-1 text-sm font-medium text-ink">{meta.title}</p>
              {meta.logline && <p className="mt-1 text-xs text-muted">{meta.logline}</p>}
            </div>
          )}
        </aside>
      </div>
      </div>
    </LLMProvider>
  );
}

function PipelineRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-subtle"
      }`}
    >
      <Icon name={icon} size={16} />
      <span className="flex-1">{label}</span>
      <span className="rounded-full bg-bg px-2 py-0.5 text-xs">{count}</span>
    </button>
  );
}
