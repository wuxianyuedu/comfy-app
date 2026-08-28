"use client";

import React from "react";
import { Icon } from "@/components/ui/Icon";
import type { Scene, Character, Shot, StyleRef, ProjectMeta } from "@/lib/workshop/types";
import { LLMProvider, LLMStatusChip } from "@/components/workshop/llm-context";
import { ScriptGenerator } from "@/components/workshop/ScriptGenerator";
import { CharacterDesigner } from "@/components/workshop/CharacterDesigner";
import { StoryboardPlanner } from "@/components/workshop/StoryboardPlanner";

const STAGES = [
  { id: "script", label: "剧本", sub: "进行中", state: "active" as const },
  { id: "character", label: "角色卡", sub: "待开始", state: "" as const },
  { id: "storyboard", label: "场景分镜", sub: "待开始", state: "" as const },
  { id: "txt2img", label: "镜头生图", sub: "已锁定", state: "locked" as const },
  { id: "video", label: "视频生成", sub: "已锁定", state: "locked" as const },
  { id: "render", label: "成片合成", sub: "已锁定", state: "locked" as const },
];

const SCENE_PLACEHOLDERS = [
  "天台初遇", "旧收音机", "未来声音", "旧城区夜",
  "神秘电波", "记忆闪回", "城市拆除", "时间裂缝",
  "十年之后", "拯救计划", "天台对峙", "真相揭露",
  "最后广播", "城市黎明", "新的开始", "尾声字幕",
];

type Tab = "script" | "character" | "storyboard";

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

/** /api/tasks/:id/stream 的 SSE 消息 payload。 */
type TaskStreamMessage = {
  type?: string;
  image?: string;
  images?: string[];
};

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
  const [checkpoint, setCheckpoint] = React.useState("");
  const [generating] = React.useState(false);

  const [outline, setOutline] = React.useState(
    "少女小满在旧城区的天台邂逅一台会说话的旧收音机，它声称能播放“未来的声音”。随着电波里浮现陌生又熟悉的话语，小满逐渐发现，那些声音来自十年后试图拯救这座即将被拆除的城市的自己……"
  );
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
        const names: string[] = (data.models ?? []).map((model) => model.fileName);
        const first = names[0];
        if (first) setCheckpoint(first);
      })
      .catch(() => undefined);
  }, []);

  /** 安全读取 Shot 参数：对象/数组等会被拒绝，返回 fallback。 */
  function paramString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
  }
  function paramNumber(value: unknown, fallback: number): number {
    const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  async function generateShot(shot: Shot) {
    if (!checkpoint) {
      alert("请先在右侧选择一个大模型（Checkpoint）");
      return;
    }
    setShots((prev) => prev.map((s) => (s.id === shot.id ? { ...s, status: "running" } : s)));
    const style = styles.find((st) => st.slug === shot.skillSlug);
    const payload: Record<string, unknown> = {
      workflow: "txt2img",
      prompt: shot.prompt,
      negative: shot.negativePrompt ?? undefined,
      checkpoint,
      steps: paramNumber(shot.params.steps, 28),
      cfg: paramNumber(shot.params.cfg, 7),
      sampler: paramString(shot.params.sampler, "euler_ancestral"),
      scheduler: paramString(shot.params.scheduler, "normal"),
      size: paramString(shot.params.size, "832x1216"),
      count: 1,
      skillSlug: style?.slug,
      skillName: style?.name,
    };
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (data.taskId) {
        setShots((prev) =>
          prev.map((s) => (s.id === shot.id ? { ...s, status: "done", taskId: data.taskId } : s))
        );
        pollTask(data.taskId, shot.id);
      } else {
        throw new Error(data.error ?? "生成失败");
      }
    } catch (err: unknown) {
      setShots((prev) => prev.map((s) => (s.id === shot.id ? { ...s, status: "failed" } : s)));
      console.error(err instanceof Error ? err.message : err);
    }
  }

  function pollTask(taskId: string, shotId: string) {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as TaskStreamMessage;
        if (msg.type === "done" || msg.type === "image") {
          const url = msg.image ?? msg.images?.[0];
          if (url) {
            setShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, imageUrl: url } : s)));
          }
          if (msg.type === "done") es.close();
        }
      } catch {
        /* SSE 消息解析失败时忽略本条 */
      }
    };
    es.onerror = () => es.close();
  }

  const totalStages = 6;
  const progressPct = 23; // 设计稿固定展示 23%，后续可改为动态计算

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
  };
  const { title: stageTitle, desc: stageDesc } = stageTitles[tab];
  const stageIndex = STAGES.findIndex((s) => s.id === tab) + 1;

  const missing = [
    { label: "角色卡未建立", detail: `${Math.max(2 - characters.length, 0)} 个待建`, color: "#FF5C76" },
    { label: "场景未规划", detail: `${Math.max(3 - scenes.length, 0)} 个待规划`, color: "#FFB553" },
    { label: "分镜脚本", detail: `${Math.max(16 - shots.length, 0)} 镜待生成`, color: "#5CA8FF" },
  ];

  const statusByRow = ["done", "pending", "running", "draft"] as const;
  const statusMeta: Record<typeof statusByRow[number], { dot: string }> = {
    done: { dot: "#7C5CFC" },
    pending: { dot: "#5CA8FF" },
    running: { dot: "#FFB553" },
    draft: { dot: "#9A9AAD" },
  };
  const gridShots: { idx: number; heading: string; status: typeof statusByRow[number]; color: string }[] = [];
  for (let i = 0; i < 16; i++) {
    const sc = scenes[i];
    const state = statusByRow[Math.floor(i / 4)]!;
    const heading = sc?.heading?.replace(/^场景\d+\s*·\s*/, "") ?? SCENE_PLACEHOLDERS[i] ?? "";
    gridShots.push({ idx: i, heading, status: state, color: statusMeta[state].dot });
  }

  return (
    <LLMProvider>
      <div className="dark min-h-screen w-full bg-bg text-ink">
        {/* ── Top bar ── */}
        <header className="flex h-16 items-center gap-3 border-b border-border px-6">
          <div className="flex flex-1 items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-base font-bold text-white">工</div>
            <div className="flex flex-col leading-tight">
              <span className="text-[17px] font-semibold text-ink">工坊 · 全链路项目管线</span>
              <span className="text-[11px] text-muted">Comfy-APP / 项目管线</span>
            </div>
            <span className="ml-4 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[13px] text-muted">{meta.title}</span>
          </div>

          {/* 项目总进度：放到最顶部（设计稿红框区域） */}
          <div className="hidden w-full max-w-[260px] lg:block">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>项目总进度</span>
              <span className="font-medium text-primary">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full rounded-full bg-elevated">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-1 items-center justify-end gap-3">
            <span className="rounded-full bg-[var(--color-amber)]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-amber)]">
              距离成片还差 3 类素材
            </span>
            <button className="grid h-8 w-8 place-items-center rounded-full bg-primary/50 text-white" aria-label="账户">
              <Icon name="user" size={16} />
            </button>
          </div>
        </header>

        {/* ── Horizontal stage nav ── */}
        <nav className="flex items-stretch gap-3 border-b border-border px-6 py-4">
          {STAGES.map((st, index) => {
            const active = tab === st.id;
            const locked = st.state === "locked";
            const sub = locked ? "已锁定" : active ? "进行中" : "待开始";
            return (
              <button
                key={st.id}
                disabled={locked}
                onClick={() => {
                  if (st.id === "script" || st.id === "character" || st.id === "storyboard") {
                    setTab(st.id);
                  }
                }}
                className={`flex flex-1 items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                  active ? "bg-primary/[0.12] ring-1 ring-primary/25" : "bg-surface"
                } ${locked ? "opacity-60" : ""}`}
              >
                <span
                  className={`grid h-9 w-9 place-items-center rounded-[11px] text-[15px] font-bold ${
                    active ? "bg-primary text-white" : "bg-elevated text-muted"
                  }`}
                >
                  {locked ? <Icon name="lock" size={14} /> : index + 1}
                </span>
                <div className="leading-tight">
                  <div className={`text-[13.5px] font-semibold ${active ? "text-primary" : "text-ink"}`}>{st.label}</div>
                  <div className={`text-[11px] ${locked ? "text-faint" : "text-muted"}`}>{sub}</div>
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
                <h2 className="text-[17px] font-semibold text-ink">{stageTitle}</h2>
                <p className="mt-1 text-[12px] text-muted">{stageDesc}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white/[0.04] px-3 py-1 text-[11px] text-muted">
                阶段 {stageIndex} / {totalStages}
              </span>
            </div>

            {/* Script outline card */}
            <section className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">故事大纲</span>
                <div className="flex items-center gap-2">
                  {!editingOutline ? (
                    <button
                      onClick={() => {
                        setDraftOutline(outline);
                        setEditingOutline(true);
                      }}
                      className="rounded-lg bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.08]"
                    >
                      编辑
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditingOutline(false)}
                        className="rounded-lg bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.08]"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => {
                          setOutline(draftOutline);
                          setEditingOutline(false);
                        }}
                        className="rounded-lg bg-primary/[0.12] px-4 py-1.5 text-[11px] text-primary hover:bg-primary/[0.18]"
                      >
                        保存
                      </button>
                    </>
                  )}
                  <span className="rounded-lg bg-primary/[0.12] px-4 py-1.5 text-[11px] text-primary">自动生成</span>
                </div>
              </div>
              {editingOutline ? (
                <textarea
                  value={draftOutline}
                  onChange={(e) => setDraftOutline(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-border bg-bg p-3 text-[12.5px] leading-relaxed text-ink outline-none ring-primary/30 transition focus:border-primary/50 focus:ring-2"
                  placeholder="输入故事大纲……"
                />
              ) : (
                <p className="text-[12.5px] leading-relaxed text-muted">{outline}</p>
              )}
            </section>

            {/* Storyboard card */}
            <section className="mt-5 rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">分镜脚本</span>
                <span className="rounded-lg bg-primary/[0.12] px-4 py-1.5 text-[11px] text-primary">{gridShots.length} 镜</span>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {gridShots.map((gs) => (
                  <div
                    key={gs.idx}
                    className="relative h-[86px] rounded-[11px] bg-elevated p-3"
                  >
                    <span
                      className="absolute right-3 top-3 h-2 w-2 rounded-full"
                      style={{ background: gs.color }}
                    />
                    <div className="text-[10.5px] text-muted truncate pr-6">{gs.heading}</div>
                    <div className="mt-5 text-xs font-medium text-ink">
                      镜 {String(gs.idx + 1).padStart(2, "0")}
                    </div>
                    {/* faint placeholder image */}
                    <div className="absolute right-2 top-1/2 h-11 w-[54px] -translate-y-1/2 rounded-md bg-white/[0.03]" />
                    <div className="absolute right-[22px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </section>

            {/* Tool panels (reused from old UI, hidden by default) */}
            {tab === "script" && (
              <section className="mt-5 rounded-2xl border border-border bg-surface p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-ink">剧本工具</h3>
                  <LLMStatusChip />
                </div>
                <ScriptGenerator meta={meta} scenes={scenes} onMetaChange={setMeta} onScenesChange={setScenes} />
              </section>
            )}
            {tab === "character" && (
              <section className="mt-5 rounded-2xl border border-border bg-surface p-5">
                <h3 className="mb-3 text-[14px] font-semibold text-ink">角色工具</h3>
                <CharacterDesigner characters={characters} styles={styles} onCharactersChange={setCharacters} />
              </section>
            )}
            {tab === "storyboard" && (
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setTab("storyboard")}
                  className="rounded-xl bg-primary px-6 py-3 text-[13px] font-semibold text-white hover:bg-primary-hover"
                >
                  从剧本生成 16 镜
                </button>
                <button
                  onClick={() => setTab("script")}
                  className="rounded-xl bg-white/[0.04] px-6 py-3 text-[13px] font-semibold text-ink hover:bg-white/[0.08]"
                >
                  导入剧本
                </button>
              </div>
            )}

            {tab === "storyboard" && (
              <section className="mt-5 rounded-2xl border border-border bg-surface p-5">
                <h3 className="mb-3 text-[14px] font-semibold text-ink">分镜工具</h3>
                <StoryboardPlanner
                  scenes={scenes}
                  characters={characters}
                  styles={styles}
                  shots={shots}
                  onShotsChange={setShots}
                  onGenerate={generateShot}
                  generating={generating}
                />
              </section>
            )}
          </div>

          {/* Right panel */}
          <aside className="space-y-4">
            {/* Missing materials */}
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-lg bg-[var(--color-amber)]/20 text-[13px] font-bold text-[var(--color-amber)]">!</span>
                <span className="text-[13px] font-semibold text-ink">缺失素材 / 下一步</span>
              </div>
              <div className="space-y-2.5">
                {missing.map((missing) =>
(
                  <div key={missing.label} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: missing.color }} />
                    <span className="flex-1 text-[12.5px] text-ink">{missing.label}</span>
                    <span className="text-[11px] text-faint">{missing.detail}</span>
                  </div>
                ))}
              </div>
              <button className="mt-3 w-full rounded-lg bg-[var(--color-amber)]/10 py-2.5 text-xs font-semibold text-[var(--color-amber)] hover:bg-[var(--color-amber)]/15">
                补齐缺失素材 →
              </button>
            </div>

            {/* Resource library */}
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 text-[13px] font-semibold text-ink">资源库</div>
              <div className="space-y-3">
                {[
                  ["剧本大纲.md", "文档"],
                  ["分镜脚本.json", "数据"],
                  ["角色卡", "0 项"],
                  ["场景图", "0 项"],
                  ["视频片段", "0 项"],
                  ["参考图 / 音效", "0 项"],
                ].map(([name, tag]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-elevated">
                      <Icon name="file" size={14} className="text-muted" />
                    </span>
                    <span className="flex-1 truncate text-[12.5px] text-ink">{name}</span>
                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[10.5px] text-faint">{tag}</span>
                  </div>
                ))}
              </div>
              <button className="mt-3 w-full rounded-lg bg-white/[0.04] py-2.5 text-xs text-muted hover:bg-white/[0.08]">
                + 导入素材
              </button>
            </div>
          </aside>
        </div>
      </div>
    </LLMProvider>
  );
}
