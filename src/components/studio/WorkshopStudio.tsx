"use client";

import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ScriptGenerator } from "@/components/workshop/ScriptGenerator";
import { CharacterDesigner } from "@/components/workshop/CharacterDesigner";
import { StoryboardPlanner } from "@/components/workshop/StoryboardPlanner";
import { LLMProvider, LLMStatusChip, LLMSettingsButton } from "@/components/workshop/LLMContext";
import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";

/** Wire type of the generate mutation input (was `payload as any`). */
type GenerateInput = RouterInputs["generate"]["generate"];

/** Runtime shape of an SSE frame from /api/tasks/[id]/stream — only the
 *  fields consumed here.  `JSON.parse` yields unknown; guards narrow. */
interface SseFrame {
  type?: unknown;
  image?: unknown;
  images?: unknown;
}
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
  const [generating] = React.useState(false);

  // Load styles (skills) + checkpoints
  React.useEffect(() => {
    vanillaApi.skill.list
      .query({})
      .then((data) => {
        // skill.list rows are `{...record, tags}` — the router spread drops the
        // record props, so read fields off a record view.  Values are asserted
        // (not coerced) so malformed payloads behave exactly as before.
        const list: StyleRef[] = (data.skills ?? []).map((raw) => {
          const skill = raw as Record<string, unknown>;
          return {
            slug: skill.slug as string,
            name: skill.name as string,
            icon: skill.icon as string,
            promptTemplate: skill.promptTemplate as string,
            negativePrompt: (skill.negativePrompt as string | undefined) ?? undefined,
            defaultParams:
              (skill.defaultParams as Record<string, unknown> | undefined) ?? undefined,
          };
        });
        setStyles(list);
      })
      .catch(() => {
        /* 初始加载失败静默忽略（用户可手动重试） */
      });
    vanillaApi.model.list
      .query({ type: "CHECKPOINT" })
      .then((data) => {
        const names: string[] = (data.models ?? []).map((model) => model.fileName);
        setCheckpoints(names);
        if (names.length) setCheckpoint(names[0]!);
      })
      .catch(() => {
        /* 初始加载失败静默忽略（用户可手动重试） */
      });
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
      sampler: typeof shot.params.sampler === "string" ? shot.params.sampler : "euler_ancestral",
      scheduler: typeof shot.params.scheduler === "string" ? shot.params.scheduler : "normal",
      size: typeof shot.params.size === "string" ? shot.params.size : "832x1216",
      count: 1,
      skillSlug: style?.slug,
      skillName: style?.name,
    };

    try {
      const data = await vanillaApi.generate.generate.mutate(payload as GenerateInput);
      if (data.taskId) {
        setShots((prev) =>
          prev.map((prev) =>(prev.id === shot.id ? { ...prev, status: "done", taskId: data.taskId } : prev))
        );
        // Poll for result to embed preview
        void pollTask(data.taskId, shot.id);
      } else {
        throw new Error("生成失败");
      }
    } catch (err) {
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
        const msg = JSON.parse(ev.data as string) as SseFrame;
        if (msg.type === "done" || msg.type === "image") {
          const images = msg.images;
          const url =
            (msg.image as string | undefined) ??
            (Array.isArray(images) ? (images[0] as string | undefined) : undefined);
          if (url) {
            setShots((prev) =>
              prev.map((prev) =>(prev.id === shotId ? { ...prev, imageUrl: url } : prev))
            );
          }
          if (msg.type === "done") es.close();
        }
      } catch {
        /* malformed SSE frame — ignore this message */
      }
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
              href="/workspace"
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-subtle"
            >
              前往创作空间 →
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
                className="!bg-white/3 !border-white/8 text-sm"
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
