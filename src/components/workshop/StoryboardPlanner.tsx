"use client";

import React from "react";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { Icon } from "@/components/ui/Icon";
import type { Shot, Scene, Character, StyleRef, ShotType } from "@/lib/workshop/types";
import { SHOT_TYPE_LABELS } from "@/lib/workshop/types";
import { buildShotPrompt, buildShotNegative, mergeParams } from "@/lib/workshop/prompt-builder";
import { workshopUid } from "@/lib/workshop/script-parser";
import { useLLM } from "@/components/workshop/llm-context";
import { streamChat } from "@/lib/llm/browser";
import { buildStoryboardMessages, parseStoryboard } from "@/lib/llm/prompts";

interface Props {
  scenes: Scene[];
  characters: Character[];
  styles: StyleRef[];
  shots: Shot[];
  onShotsChange: (s: Shot[]) => void;
  onGenerate: (shot: Shot) => Promise<void>;
  generating: boolean;
}

const SHOT_TYPES: ShotType[] = [
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "close",
  "extreme_close",
  "poi",
  "pod",
];

export function StoryboardPlanner({
  scenes,
  characters,
  styles,
  shots,
  onShotsChange,
  onGenerate,
  generating,
}: Props) {
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiProgress, setAiProgress] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  const { config, openSettings } = useLLM();

  // Import shots from script: each scene → shotCount shots
  function importFromScript() {
    const built: Shot[] = [];
    let n = shots.length;
    scenes.forEach((scene) => {
      const count = Math.max(1, scene.shotCount);
      for (let i = 0; i < count; i++) {
        n += 1;
        const shot: Shot = {
          id: workshopUid("shot"),
          index: n,
          sceneId: scene.id,
          sceneHeading: scene.heading,
          shotType: i === 0 ? "wide" : "medium",
          description: i === 0 ? scene.action : "",
          characterIds: [],
          prompt: "",
          negativePrompt: "",
          params: {},
          status: "idle",
        };
        // Auto-build prompt
        recompute(shot, scene, [], undefined);
        built.push(shot);
      }
    });
    onShotsChange([...shots, ...built]);
  }

  function recompute(
    shot: Shot,
    scene: Scene | undefined,
    chars: Character[],
    style?: StyleRef
  ): Shot {
    const prompt = buildShotPrompt(shot, scene, chars, style);
    const neg = buildShotNegative(chars, style);
    const params = mergeParams(style, undefined);
    return { ...shot, prompt, negativePrompt: neg, params: { ...shot.params, ...params } };
  }

  function updateShot(id: string, patch: Partial<Shot>) {
    onShotsChange(
      shots.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        const scene = scenes.find((sc) => sc.id === next.sceneId);
        const chars = characters.filter((c) => next.characterIds.includes(c.id));
        const style = styles.find((st) => st.slug === next.skillSlug);
        return recompute(next, scene, chars, style);
      })
    );
  }

  function removeShot(id: string) {
    onShotsChange(shots.filter((s) => s.id !== id));
  }

  function clearShots() {
    if (confirm("确定清空当前所有分镜？")) onShotsChange([]);
  }

  async function handleAISplit() {
    if (scenes.length === 0) return;
    if (!config) {
      openSettings();
      return;
    }
    setAiBusy(true);
    setAiProgress("");
    setAiError("");
    try {
      const built: Shot[] = [];
      let n = shots.length;
      const charNames = characters.map((c) => c.name).filter(Boolean);
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        setAiProgress(`正在拆镜 ${i + 1}/${scenes.length} · ${scene!.heading}`);
        const full = await streamChat({
          messages: buildStoryboardMessages(scene!, charNames),
          onToken: () => {},
        });
        const raws = parseStoryboard(full);
        raws.forEach((r) => {
          n += 1;
          const charIds = characters
            .filter((c) => c.name && r.characterNames.includes(c.name))
            .map((c) => c.id);
          const shot: Shot = {
            id: workshopUid("shot"),
            index: n,
            sceneId: scene!.id,
            sceneHeading: scene!.heading,
            shotType: r.shotType,
            description: r.description,
            characterIds: charIds,
            prompt: "",
            negativePrompt: "",
            params: {},
            status: "idle",
          };
          const linkedChars = characters.filter((c) => charIds.includes(c.id));
          built.push(recompute(shot, scene, linkedChars, undefined));
        });
      }
      onShotsChange([...shots, ...built]);
      setAiProgress(`已用 AI 生成 ${built.length} 个镜头`);
    } catch (e: any) {
      setAiError(e?.message || "AI 拆镜失败");
    } finally {
      setAiBusy(false);
    }
  }

  async function generateAll() {
    const pending = shots.filter((s) => s.status === "idle" || s.status === "failed");
    for (const shot of pending) {
      await onGenerate(shot);
    }
  }

  const idleCount = shots.filter((s) => s.status === "idle" || s.status === "failed").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="u-title">
          分镜规划 <span className="text-muted">({shots.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={importFromScript}
            disabled={scenes.length === 0 || aiBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-subtle disabled:opacity-40"
          >
            ↓ 从剧本导入
          </button>
          <button
            type="button"
            onClick={handleAISplit}
            disabled={scenes.length === 0 || aiBusy}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {aiBusy ? "AI 拆镜中…" : (<><Icon name="sparkles" size={13} className="mr-1 inline align-[-2px]" />AI 智能拆镜</>)}
          </button>
          {shots.length > 0 && (
            <button
              type="button"
              onClick={clearShots}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-subtle"
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={generateAll}
            disabled={idleCount === 0 || generating}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
          >
            {generating ? "生成中…" : `批量生成 (${idleCount})`}
          </button>
        </div>
      </div>

      {scenes.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted">
          先在「剧本」中创建场景，再点「从剧本导入」或「AI 智能拆镜」自动生成分镜。
        </div>
      )}

      {(aiProgress || aiError) && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            aiError ? "bg-red-100 text-red-700" : "bg-primary-soft/40 text-primary"
          }`}
        >
          {aiError || aiProgress}
        </div>
      )}

      {!config && scenes.length > 0 && (
        <div className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
          未配置 LLM。「AI 智能拆镜」将不可用，可改用「从剧本导入」（按镜头数模板拆分），或在右上角「LLM 设置」接入本地/远端模型。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">
          暂无分镜。导入剧本后，每个场景会按建议镜头数拆分为多个镜头。
        </div>
      ) : (
        <div className="space-y-3">
          {shots.map((shot) => {
            const scene = scenes.find((s) => s.id === shot.sceneId);
            const linkedChars = characters.filter((c) => shot.characterIds.includes(c.id));
            return (
              <div key={shot.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {shot.index}
                  </span>
                  <span className="text-xs text-muted">{shot.sceneHeading}</span>
                  <StatusBadge status={shot.status} />
                  <button
                    type="button"
                    onClick={() => removeShot(shot.id)}
                    className="ml-auto text-muted hover:text-red-500"
                    aria-label="删除镜头"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {/* Shot type */}
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">景别</span>
                    <DarkSelect
                      className="!bg-white/[0.03] !border-white/[0.08] text-xs"
                      value={shot.shotType}
                      onChange={(v) => updateShot(shot.id, { shotType: v as ShotType })}
                      options={SHOT_TYPES}
                      labels={SHOT_TYPE_LABELS as Record<string, string>}
                      placeholder="选择景别"
                    />
                  </label>

                  {/* Style */}
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">风格 Skill</span>
                    <DarkSelect
                      className="!bg-white/[0.03] !border-white/[0.08] text-xs"
                      value={shot.skillSlug ?? ""}
                      onChange={(v) => updateShot(shot.id, { skillSlug: v || undefined })}
                      options={styles.map((s) => s.slug)}
                      labels={Object.fromEntries(styles.map((s) => [s.slug, `${s.icon} ${s.name}`]))}
                      placeholder="跟随角色/默认"
                    />
                  </label>
                </div>

                {/* Description */}
                <textarea
                  value={shot.description}
                  onChange={(e) => updateShot(shot.id, { description: e.target.value })}
                  rows={2}
                  className="mt-2 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
                  placeholder="画面描述（留空则使用场景动作描述）"
                />

                {/* Character multi-select */}
                {characters.length > 0 && (
                  <div className="mt-2">
                    <span className="mb-1 block text-xs text-muted">出场角色</span>
                    <div className="flex flex-wrap gap-1.5">
                      {characters.map((c) => {
                        const on = shot.characterIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              updateShot(shot.id, {
                                characterIds: on
                                  ? shot.characterIds.filter((id) => id !== c.id)
                                  : [...shot.characterIds, c.id],
                              })
                            }
                            className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                              on
                                ? "bg-primary text-white"
                                : "border border-border text-muted hover:text-ink"
                            }`}
                          >
                            {c.name || "未命名"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Prompt preview */}
                <div className="mt-3 rounded-lg bg-subtle p-3">
                  <p className="mb-1 text-xs font-medium text-muted">生图提示词</p>
                  <p className="text-xs leading-relaxed text-ink/80 break-words">
                    {shot.prompt || "填写描述后自动生成…"}
                  </p>
                  {linkedChars.length > 0 && (
                    <p className="mt-1 text-xs text-primary/70">
                      关联角色：{linkedChars.map((c) => c.name || "未命名").join("、")}
                    </p>
                  )}
                </div>

                {/* Generate button */}
                <button
                  type="button"
                  onClick={() => onGenerate(shot)}
                  disabled={shot.status === "running" || generating || !shot.prompt}
                  className="mt-2 w-full rounded-lg bg-primary/90 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                >
                  {shot.status === "running"
                    ? "生成中…"
                    : shot.status === "done"
                    ? "重新生成"
                    : "生成此镜头"}
                </button>

                {shot.imageUrl && (
                  <img
                    src={shot.imageUrl}
                    alt={shot.sceneHeading}
                    className="mt-2 w-full rounded-lg border border-border"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Shot["status"] }) {
  const map: Record<Shot["status"], { label: string; cls: string }> = {
    idle: { label: "待生成", cls: "bg-subtle text-muted" },
    queued: { label: "排队中", cls: "bg-amber-100 text-amber-700" },
    running: { label: "生成中", cls: "bg-blue-100 text-blue-700" },
    done: { label: "已完成", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
  );
}
