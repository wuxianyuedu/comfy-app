"use client";

import React from "react";
import { Icon } from "@/components/ui/Icon";
import type {
  Scene,
  Character,
  Shot,
  StyleRef,
  ProjectMeta,
} from "@/lib/workshop/types";
import { LLMProvider, LLMStatusChip } from "@/components/workshop/LLMContext";
import { ScriptGenerator } from "@/components/workshop/ScriptGenerator";
import { CharacterDesigner } from "@/components/workshop/CharacterDesigner";
import { StoryboardPlanner } from "@/components/workshop/StoryboardPlanner";
import { ScriptMarkdownEditor } from "@/components/workshop/ScriptMarkdownEditor";
import { ShotStudio } from "@/components/workshop/ShotStudio";
import { VideoStudio } from "@/components/workshop/VideoStudio";
import { FinalComposer } from "@/components/workshop/FinalComposer";
import { ApiChannelSettings } from "@/components/workshop/ApiChannelSettings";
import {
  fetchApiChannels,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "@/lib/workshop/generation-client";
import type { ApiChannelsView } from "@/lib/workshop/api-channel-shared";

/** 全部阶段始终可进入 — 顺序仅是推荐流(自动预填沿此方向推进)。 */
const STAGE_DEFS = [
  { id: "script", label: "剧本" },
  { id: "character", label: "角色卡" },
  { id: "storyboard", label: "场景分镜" },
  { id: "shots", label: "镜头生图" },
  { id: "video", label: "视频生成" },
  { id: "render", label: "成片合成" },
] as const;

type Tab = (typeof STAGE_DEFS)[number]["id"];

const SCENE_PLACEHOLDERS = [
  "天台初遇",
  "旧收音机",
  "未来声音",
  "旧城区夜",
  "神秘电波",
  "记忆闪回",
  "城市拆除",
  "时间裂缝",
  "十年之后",
  "拯救计划",
  "天台对峙",
  "真相揭露",
  "最后广播",
  "城市黎明",
  "新的开始",
  "尾声字幕",
];

/** /api/skills 返回 payload：用于在 fetch 边界收窄，消除 any 散落。 */
type SkillsApiResponse = {
  skills?: Array<{
    slug: string;
    name: string;
    icon: string;
    promptTemplate: string;
    negativePrompt?: string | null;
    defaultParams?: Record<string, unknown> | null;
  }>;
};

/** /api/models?type=CHECKPOINT 返回 payload。 */
type ModelsApiResponse = {
  models?: Array<{ fileName: string }>;
};

/** 安全读取 Shot 参数：对象/数组等会被拒绝，返回 fallback。 */
function paramString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
function paramNumber(value: unknown, fallback: number): number {
  const n =
    typeof value === "string"
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** catch 抛出值（unknown）→ 消息提取：带 string message 的对象取 message。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

/** 阶段前置温和提示条（不阻断操作 — 按钮仍可用）。 */
function StageHint({ text, onGo }: { text: string; onGo: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-(--color-amber)/10 px-4 py-2.5 text-xs text-(--color-amber)">
      <Icon name="info" size={13} className="shrink-0" />
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={onGo}
        className="rounded-lg bg-(--color-amber)/15 px-3 py-1 font-medium hover:bg-(--color-amber)/25"
      >
        去完成 →
      </button>
    </div>
  );
}

export function WorkshopPipeline() {
  const [tab, setTab] = React.useState<Tab>("script");
  const [meta, setMeta] = React.useState<ProjectMeta>({
    title: "未命名项目",
    type: "short_video",
    tone: "",
    logline: "",
  });
  const [scenes, setScenes] = React.useState<Scene[]>([]);
  const [characters, setCharacters] = React.useState<Character[]>([]);
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [styles, setStyles] = React.useState<StyleRef[]>([]);
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  /** 每个镜头节点的实时生成进度（pct + 当前 ComfyUI 节点类别），用于节点上渲染进度条 */
  const [shotProgress, setShotProgress] = React.useState<Record<string, { pct: number; label?: string }>>({});
  const [rendered, setRendered] = React.useState(false);
  const [apiChannels, setApiChannels] = React.useState<ApiChannelsView | null>(null);
  const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);

  const [outline, setOutline] = React.useState(
    "少女小满在旧城区的天台邂逅一台会说话的旧收音机，它声称能播放“未来的声音”。随着电波里浮现陌生又熟悉的话语，小满逐渐发现，那些声音来自十年后试图拯救这座即将被拆除的城市的自己……",
  );
  const [scriptMarkdown, setScriptMarkdown] = React.useState(
    meta.scriptMarkdown ?? "# 未命名剧本\n\n## 故事大纲\n\n" + outline + "\n",
  );
  const [isScriptEditorOpen, setIsScriptEditorOpen] = React.useState(false);
  const [editingOutline, setEditingOutline] = React.useState(false);
  const [draftOutline, setDraftOutline] = React.useState(outline);

  React.useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((data: SkillsApiResponse) => {
        const list: StyleRef[] = (data.skills ?? []).map((skill) => ({
          slug: skill.slug,
          name: skill.name,
          icon: skill.icon,
          promptTemplate: skill.promptTemplate,
          negativePrompt: skill.negativePrompt ?? undefined,
          defaultParams: skill.defaultParams ?? undefined,
        }));
        setStyles(list);
      })
      .catch(() => undefined);
    fetch("/api/models?type=CHECKPOINT")
      .then((res) => res.json())
      .then((data: ModelsApiResponse) => {
        const names: string[] = (data.models ?? []).map(
          (model) => model.fileName,
        );
        setCheckpoints(names);
        const first = names[0];
        if (first) setCheckpoint(first);
      })
      .catch(() => undefined);
    // API 直连通道(生图/视频)的脱敏配置视图;失败按未配置处理。
    void fetchApiChannels().then(setApiChannels);
  }, []);

  /**
   * 分镜阶段的单镜生图(StoryboardPlanner 的 onGenerate 契约不变):
   * 走与画布一致的本地 ComfyUI 链路(tRPC generate → SSE 任务流),
   * 结果回写 Shot.imageUrl / status,镜头生图阶段自动继承。
   */
  async function generateShot(shot: Shot) {
    if (!checkpoint) {
      alert("请先在右侧「生成资源」选择一个本地 Checkpoint");
      return;
    }
    setGenerating(true);
    setShots((prev) =>
      prev.map((s) => (s.id === shot.id ? { ...s, status: "running" } : s)),
    );
    try {
      const input: GenerateInput = {
        workflow: "txt2img",
        prompt: shot.prompt,
        negative: shot.negativePrompt || undefined,
        checkpoint,
        steps: Math.round(paramNumber(shot.params.steps, 28)),
        cfg: paramNumber(shot.params.cfg, 7),
        sampler: paramString(shot.params.sampler, "euler_ancestral"),
        scheduler: paramString(shot.params.scheduler, "normal"),
        size: paramString(shot.params.size, "832x1216"),
        count: 1,
      };
      const taskId = await startLocalGenerate(input);
      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, taskId } : s)),
      );
      await new Promise<void>((resolve) => {
        watchTask(taskId, {
          onProgress: (pct, node) => {
            setShotProgress((prev) => ({
              ...prev,
              [shot.id]: { pct, ...(node?.label ? { label: node.label } : {}) },
            }));
          },
          onOutput: (out) => {
            if (out.kind !== "video") {
              setShots((prev) =>
                prev.map((s) =>
                  s.id === shot.id ? { ...s, imageUrl: out.url } : s,
                ),
              );
            }
          },
          onSettled: (r) => {
            setShotProgress((prev) => {
              const next = { ...prev };
              delete next[shot.id];
              return next;
            });
            setShots((prev) =>
              prev.map((s) =>
                s.id === shot.id ? { ...s, status: r.ok ? "done" : "failed" } : s,
              ),
            );
            resolve();
          },
        });
      });
    } catch (err: unknown) {
      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, status: "failed" } : s)),
      );
      console.error(errorMessage(err, "生成失败"));
    } finally {
      setGenerating(false);
    }
  }

  // ── 阶段完成度(动态进度 + 导航副标题 + 温和提示共用) ─────────────────────
  const scriptReady = !!scriptMarkdown.trim() || scenes.length > 0;
  const imgDoneCount = shots.filter((s) => !!s.imageUrl).length;
  const clipDoneCount = shots.filter((s) => !!s.clipUrl).length;
  const stageRatios: Record<Tab, number> = {
    script: scriptReady ? 1 : 0,
    character: characters.length > 0 ? 1 : 0,
    storyboard: shots.length > 0 ? 1 : 0,
    shots: shots.length > 0 ? imgDoneCount / shots.length : 0,
    video: shots.length > 0 ? clipDoneCount / shots.length : 0,
    render: rendered ? 1 : shots.length > 0 ? 0.5 : 0,
  };
  const progressPct = Math.round(
    (Object.values(stageRatios).reduce((acc, r) => acc + r, 0) /
      STAGE_DEFS.length) *
      100,
  );

  function stageSub(id: Tab): string {
    if (id === tab) return "进行中";
    const ratio = stageRatios[id];
    if (ratio >= 1) return "已完成";
    switch (id) {
      case "character":
        return characters.length > 0 ? `已建 ${characters.length} 个` : "待开始";
      case "storyboard":
        return shots.length > 0 ? `${shots.length} 镜` : "待开始";
      case "shots":
        return shots.length > 0 ? `图 ${imgDoneCount}/${shots.length}` : "待开始";
      case "video":
        return shots.length > 0 ? `片段 ${clipDoneCount}/${shots.length}` : "待开始";
      case "render":
        return shots.length > 0 ? "可合成" : "待开始";
      default:
        return scriptReady ? "已就绪" : "待开始";
    }
  }

  /** 前置未满足时的温和提示(纯建议,不阻断)。 */
  function stagePrereq(id: Tab): { text: string; go: Tab } | null {
    switch (id) {
      case "character":
        return scriptReady
          ? null
          : {
              text: "建议先完成「剧本」— 角色卡会自动复用剧本文本提取角色。",
              go: "script",
            };
      case "storyboard":
        return scriptReady
          ? null
          : {
              text: "建议先完成「剧本」— 分镜提取依赖剧本文本,角色可自动并入镜头。",
              go: "script",
            };
      case "shots":
        return shots.length > 0
          ? null
          : {
              text: "建议先完成「场景分镜」— 镜头提示词与角色参考会自动带入本阶段。",
              go: "storyboard",
            };
      case "video":
        return shots.length > 0
          ? null
          : {
              text: "建议先完成「场景分镜」— 镜头时长与运动设定会自动带入本阶段。",
              go: "storyboard",
            };
      case "render":
        return shots.length > 0
          ? null
          : {
              text: "建议先完成「场景分镜」与生成 — 成片时间线直接消费镜头数据。",
              go: "storyboard",
            };
      default:
        return null;
    }
  }

  const stageTitles: Record<Tab, { title: string; desc: string }> = {
    script: {
      title: "剧本 · 故事大纲",
      desc: "从一句话梗概出发，自动派生角色、场景与分镜脚本，并贯穿到生图 / 视频全流程。",
    },
    character: {
      title: "角色卡 · 角色设计",
      desc: "为项目创建并管理角色形象、特征与参考，统一后续分镜与生图风格。",
    },
    storyboard: {
      title: "场景分镜 · 分镜脚本",
      desc: "将剧本拆解为可执行的镜头序列，规划画面、动作与镜头语言。",
    },
    shots: {
      title: "镜头生图 · 画面生成",
      desc: "为每个镜头生成画面 — 本地 ComfyUI 工作流 / API 直连双通道，提示词自动带入，可随时改写重跑。",
    },
    video: {
      title: "视频生成 · 图生视频",
      desc: "把镜头画面驱动为视频片段 — 首帧与时长自动带入，支持本地 img2video 工作流 / API 直连。",
    },
    render: {
      title: "成片合成 · 时间线",
      desc: "将全部镜头按顺序合成成片 — 串播预览、时长/转场编辑与合成清单导出。",
    },
  };
  const { title: stageTitle, desc: stageDesc } = stageTitles[tab];
  const stageIndex = STAGE_DEFS.findIndex((s) => s.id === tab) + 1;
  const prereq = stagePrereq(tab);

  const missing = [
    {
      label: "角色卡未建立",
      need: Math.max(2 - characters.length, 0),
      color: "#FF5C76",
    },
    {
      label: "场景未规划",
      need: Math.max(3 - scenes.length, 0),
      color: "#FFB553",
    },
    {
      label: "分镜脚本",
      need: Math.max(16 - shots.length, 0),
      color: "#5CA8FF",
    },
  ];
  const pendingCategories = Object.values(stageRatios).filter((r) => r < 1).length;

  const statusByRow = ["done", "pending", "running", "draft"] as const;
  const statusMeta: Record<(typeof statusByRow)[number], { dot: string }> = {
    done: { dot: "#7C5CFC" },
    pending: { dot: "#5CA8FF" },
    running: { dot: "#FFB553" },
    draft: { dot: "#9A9AAD" },
  };
  const gridShots: {
    idx: number;
    heading: string;
    status: (typeof statusByRow)[number];
    color: string;
  }[] = [];
  for (let i = 0; i < 16; i++) {
    const sc = scenes[i];
    const state = statusByRow[Math.floor(i / 4)]!;
    const heading =
      sc?.heading?.replace(/^场景\d+\s*·\s*/, "") ??
      SCENE_PLACEHOLDERS[i] ??
      "";
    gridShots.push({
      idx: i,
      heading,
      status: state,
      color: statusMeta[state].dot,
    });
  }

  return (
    <LLMProvider>
      <div className="dark bg-bg text-ink min-h-screen w-full">
        {/* ── Top bar ── */}
        <header className="border-border flex h-16 items-center gap-3 border-b px-6">
          <div className="flex flex-1 items-center gap-3">
            <div className="bg-primary grid h-9 w-9 place-items-center rounded-xl text-base font-bold text-white">
              工
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-ink text-[17px] font-semibold">
                工坊 · 全链路项目管线
              </span>
              <span className="text-muted text-[11px]">
                Comfy-APP / 项目管线
              </span>
            </div>
            <span className="text-muted ml-4 rounded-lg bg-white/4 px-3 py-1.5 text-[13px]">
              {meta.title}
            </span>
          </div>

          {/* 项目总进度：放到最顶部（设计稿红框区域） */}
          <div className="hidden w-full max-w-[260px] lg:block">
            <div className="text-muted flex items-center justify-between text-[11px]">
              <span>项目总进度</span>
              <span className="text-primary font-medium">{progressPct}%</span>
            </div>
            <div className="bg-elevated mt-1.5 h-2 w-full rounded-full">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-1 items-center justify-end gap-3">
            <span className="rounded-full bg-(--color-amber)/15 px-3 py-1.5 text-xs font-medium text-(--color-amber)">
              距离成片还差 {pendingCategories} 个阶段
            </span>
            <button
              type="button"
              onClick={() => setApiSettingsOpen(true)}
              className="text-muted hover:text-ink flex items-center gap-1 rounded-full bg-white/4 px-3 py-1.5 text-xs hover:bg-white/8"
              title="配置生图 / 视频 API 直连通道"
            >
              <Icon name="settings" size={13} />
              API 通道
              {apiChannels?.image.configured || apiChannels?.video.configured
                ? " · 已配置"
                : ""}
            </button>
            <button
              className="bg-primary/50 grid h-8 w-8 place-items-center rounded-full text-white"
              aria-label="账户"
              type="button"
            >
              <Icon name="user" size={16} />
            </button>
          </div>
        </header>

        {/* ── Horizontal stage nav（全部解锁 — 顺序仅为推荐流） ── */}
        <nav className="border-border flex items-stretch gap-3 border-b px-6 py-4">
          {STAGE_DEFS.map((st, index) => {
            const active = tab === st.id;
            const ratio = stageRatios[st.id];
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setTab(st.id)}
                className={`flex flex-1 items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                  active ? "bg-primary/12 ring-primary/25 ring-1" : "bg-surface"
                }`}
              >
                <span
                  className={`grid h-9 w-9 place-items-center rounded-[11px] text-[15px] font-bold ${
                    ratio >= 1
                      ? "bg-emerald-500/80 text-white"
                      : active
                        ? "bg-primary text-white"
                        : "bg-elevated text-muted"
                  }`}
                >
                  {ratio >= 1 ? <Icon name="check" size={14} /> : index + 1}
                </span>
                <div className="leading-tight">
                  <div
                    className={`text-[13.5px] font-semibold ${active ? "text-primary" : "text-ink"}`}
                  >
                    {st.label}
                  </div>
                  <div
                    className={`text-[11px] ${ratio >= 1 ? "text-emerald-400" : "text-muted"}`}
                  >
                    {stageSub(st.id)}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* ── Body ── */}
        <div className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-[1fr_308px]">
          {/* Center column */}
          <div className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-ink text-[17px] font-semibold">
                  {stageTitle}
                </h2>
                <p className="text-muted mt-1 text-[12px]">{stageDesc}</p>
              </div>
              <span className="text-muted shrink-0 rounded-full bg-white/4 px-3 py-1 text-[11px]">
                阶段 {stageIndex} / {STAGE_DEFS.length}
              </span>
            </div>

            {/* ── Tab: Script ── */}
            {tab === "script" && (
              <>
                {/* Script outline card */}
                <section className="border-border bg-surface rounded-2xl border p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-ink text-[13px] font-semibold">
                      故事大纲
                    </span>
                    <div className="flex items-center gap-2">
                      {!editingOutline ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDraftOutline(outline);
                            setEditingOutline(true);
                          }}
                          className="text-ink rounded-lg bg-white/4 px-4 py-1.5 text-xs font-medium hover:bg-white/8"
                        >
                          编辑
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingOutline(false)}
                            className="text-ink rounded-lg bg-white/4 px-4 py-1.5 text-xs font-medium hover:bg-white/8"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOutline(draftOutline);
                              setEditingOutline(false);
                            }}
                            className="bg-primary/12 text-primary hover:bg-primary/18 rounded-lg px-4 py-1.5 text-[11px]"
                          >
                            保存
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsScriptEditorOpen(true)}
                        className="btn-gradient rounded-lg px-4 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-purple-900/20"
                      >
                        编辑剧本
                      </button>
                    </div>
                  </div>
                  {editingOutline ? (
                    <textarea
                      value={draftOutline}
                      onChange={(e) => setDraftOutline(e.target.value)}
                      rows={4}
                      className="border-border bg-bg text-ink ring-primary/30 focus:border-primary/50 w-full resize-none rounded-xl border p-3 text-[12.5px] leading-relaxed transition outline-none focus:ring-2"
                      placeholder="输入故事大纲……"
                    />
                  ) : (
                    <p className="text-muted text-[12.5px] leading-relaxed">
                      {outline}
                    </p>
                  )}
                </section>

                {/* Script tool panel */}
                <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink text-[14px] font-semibold">
                      剧本工具
                    </h3>
                    <LLMStatusChip />
                  </div>
                  <ScriptGenerator
                    meta={meta}
                    scenes={scenes}
                    onMetaChange={setMeta}
                    onScenesChange={setScenes}
                  />
                </section>
              </>
            )}

            {/* ── Tab: Character ── */}
            {tab === "character" && (
              <>
                {prereq && (
                  <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
                )}
                <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
                  <h3 className="text-ink mb-3 text-[14px] font-semibold">
                    角色工具
                  </h3>
                  <CharacterDesigner
                    characters={characters}
                    styles={styles}
                    onCharactersChange={setCharacters}
                    scriptMarkdown={scriptMarkdown}
                  />
                </section>
              </>
            )}

            {/* ── Tab: Storyboard ── */}
            {tab === "storyboard" && (
              <>
                {prereq && (
                  <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
                )}
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setTab("storyboard")}
                    className="bg-primary hover:bg-primary-hover rounded-xl px-6 py-3 text-[13px] font-semibold text-white"
                  >
                    从剧本生成 16 镜
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("script")}
                    className="text-ink rounded-xl bg-white/4 px-6 py-3 text-[13px] font-semibold hover:bg-white/8"
                  >
                    导入剧本
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("shots")}
                    className="text-ink ml-auto rounded-xl bg-white/4 px-6 py-3 text-[13px] font-semibold hover:bg-white/8"
                  >
                    下一阶段 →
                  </button>
                </div>

                {/* Storyboard card */}
                <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-ink text-[13px] font-semibold">
                      分镜脚本
                    </span>
                    <span className="bg-primary/12 text-primary rounded-lg px-4 py-1.5 text-[11px]">
                      {gridShots.length} 镜
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {gridShots.map((gs) => (
                      <div
                        key={gs.idx}
                        className="bg-elevated relative h-[86px] rounded-[11px] p-3"
                      >
                        <span
                          className="absolute top-3 right-3 h-2 w-2 rounded-full"
                          style={{ background: gs.color }}
                        />
                        <div className="text-muted truncate pr-6 text-[10.5px]">
                          {gs.heading}
                        </div>
                        <div className="text-ink mt-5 text-xs font-medium">
                          镜 {String(gs.idx + 1).padStart(2, "0")}
                        </div>
                        {/* faint placeholder image */}
                        <div className="absolute top-1/2 right-2 h-11 w-[54px] -translate-y-1/2 rounded-md bg-white/3" />
                        <div className="absolute top-1/2 right-[22px] h-4 w-4 -translate-y-1/2 rounded-full bg-white/6" />
                      </div>
                    ))}
                  </div>
                </section>

                {/* Storyboard tool panel */}
                <section className="border-border bg-surface mt-5 rounded-2xl border p-5">
                  <h3 className="text-ink mb-3 text-[14px] font-semibold">
                    分镜工具
                  </h3>
                  <StoryboardPlanner
                    scenes={scenes}
                    characters={characters}
                    styles={styles}
                    shots={shots}
                    onShotsChange={setShots}
                    onGenerate={generateShot}
                    generating={generating}
                    progressByShot={shotProgress}
                    scriptMarkdown={scriptMarkdown}
                    onCharactersChange={setCharacters}
                  />
                </section>
              </>
            )}

            {/* ── Tab: Shot images (镜头生图) ── */}
            {tab === "shots" && (
              <>
                {prereq && (
                  <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
                )}
                <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink text-[14px] font-semibold">
                      生图工具
                    </h3>
                    <span className="text-muted rounded-lg bg-white/4 px-3 py-1 text-[11px]">
                      图 {imgDoneCount}/{shots.length}
                    </span>
                  </div>
                  <ShotStudio
                    shots={shots}
                    scenes={scenes}
                    characters={characters}
                    styles={styles}
                    checkpoints={checkpoints}
                    checkpoint={checkpoint}
                    onCheckpointChange={setCheckpoint}
                    apiChannels={apiChannels}
                    onOpenApiSettings={() => setApiSettingsOpen(true)}
                    onShotsChange={setShots}
                    onNextStage={() => setTab("video")}
                  />
                </section>
              </>
            )}

            {/* ── Tab: Video generation (视频生成) ── */}
            {tab === "video" && (
              <>
                {prereq && (
                  <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
                )}
                <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-ink text-[14px] font-semibold">
                      视频工具
                    </h3>
                    <span className="text-muted rounded-lg bg-white/4 px-3 py-1 text-[11px]">
                      片段 {clipDoneCount}/{shots.length}
                    </span>
                  </div>
                  <VideoStudio
                    shots={shots}
                    checkpoints={checkpoints}
                    checkpoint={checkpoint}
                    onCheckpointChange={setCheckpoint}
                    apiChannels={apiChannels}
                    onOpenApiSettings={() => setApiSettingsOpen(true)}
                    onShotsChange={setShots}
                    onPrevStage={() => setTab("shots")}
                    onNextStage={() => setTab("render")}
                  />
                </section>
              </>
            )}

            {/* ── Tab: Final composition (成片合成) ── */}
            {tab === "render" && (
              <>
                {prereq && (
                  <StageHint text={prereq.text} onGo={() => setTab(prereq.go)} />
                )}
                <section className="border-border bg-surface mt-4 rounded-2xl border p-5">
                  <FinalComposer
                    shots={shots}
                    title={meta.title || "未命名项目"}
                    onShotsChange={setShots}
                    rendered={rendered}
                    onRendered={() => setRendered(true)}
                  />
                </section>
              </>
            )}

            {/* Full-screen markdown script editor */}
            {isScriptEditorOpen && (
              <ScriptMarkdownEditor
                title={meta.title || "编辑剧本"}
                value={scriptMarkdown}
                onChange={setScriptMarkdown}
                onSave={() => {
                  setMeta({ ...meta, scriptMarkdown });
                  setIsScriptEditorOpen(false);
                }}
                onCancel={() => setIsScriptEditorOpen(false)}
              />
            )}
          </div>

          {/* Right panel */}
          <aside className="space-y-4">
            {/* Missing materials */}
            <div className="border-border bg-surface rounded-2xl border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-lg bg-(--color-amber)/20 text-[13px] font-bold text-(--color-amber)">
                  !
                </span>
                <span className="text-ink text-[13px] font-semibold">
                  缺失素材 / 下一步
                </span>
              </div>
              <div className="space-y-2.5">
                {missing.map((missing) => (
                  <div key={missing.label} className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: missing.color }}
                    />
                    <span className="text-ink flex-1 text-[12.5px]">
                      {missing.label}
                    </span>
                    <span className="text-faint text-[11px]">
                      {missing.need > 0 ? `${missing.need} 项待补` : "✓ 已完成"}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setTab("script")}
                className="mt-3 w-full rounded-lg bg-(--color-amber)/10 py-2.5 text-xs font-semibold text-(--color-amber) hover:bg-(--color-amber)/15"
              >
                补齐缺失素材 →
              </button>
            </div>

            {/* Generation resources: local checkpoint for the ComfyUI chain */}
            <div className="border-border bg-surface rounded-2xl border p-4">
              <div className="text-ink mb-3 flex items-center justify-between text-[13px] font-semibold">
                生成资源
                <span className="text-faint text-[10.5px]">
                  {apiChannels?.image.configured || apiChannels?.video.configured
                    ? "API 通道已配置"
                    : "API 通道未配置"}
                </span>
              </div>
              <label className="block">
                <span className="text-muted mb-1 block text-[11px]">
                  本地 Checkpoint（生图工作流）
                </span>
                <select
                  value={checkpoint}
                  onChange={(e) => setCheckpoint(e.target.value)}
                  className="border-border bg-bg text-ink w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:border-primary"
                >
                  <option value="">选择模型…</option>
                  {checkpoints.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setApiSettingsOpen(true)}
                className="text-muted mt-3 w-full rounded-lg bg-white/4 py-2.5 text-xs hover:bg-white/8"
              >
                配置 API 直连通道
              </button>
            </div>

            {/* Resource library */}
            <div className="border-border bg-surface rounded-2xl border p-4">
              <div className="text-ink mb-3 text-[13px] font-semibold">
                资源库
              </div>
              <div className="space-y-3">
                {[
                  ["剧本大纲.md", "文档"],
                  ["分镜脚本.json", "数据"],
                  ["角色卡", `${characters.length} 项`],
                  ["场景图", `${imgDoneCount} 项`],
                  ["视频片段", `${clipDoneCount} 项`],
                  ["参考图 / 音效", "0 项"],
                ].map(([name, tag]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="bg-elevated grid h-8 w-8 place-items-center rounded-lg">
                      <Icon name="file" size={14} className="text-muted" />
                    </span>
                    <span className="text-ink flex-1 truncate text-[12.5px]">
                      {name}
                    </span>
                    <span className="text-faint rounded-md bg-white/4 px-2 py-1 text-[10.5px]">
                      {tag}
                    </span>
                  </div>
                ))}
              </div>
              <button className="text-muted mt-3 w-full rounded-lg bg-white/4 py-2.5 text-xs hover:bg-white/8">
                + 导入素材
              </button>
            </div>
          </aside>
        </div>

        {/* API 直连通道设置(生图 / 视频)— 与 LLM 设置同款交互模型 */}
        {apiSettingsOpen && (
          <ApiChannelSettings
            initial={apiChannels}
            onClose={() => setApiSettingsOpen(false)}
            onSaved={(channels) => {
              setApiChannels(channels);
              setApiSettingsOpen(false);
            }}
          />
        )}
      </div>
    </LLMProvider>
  );
}
