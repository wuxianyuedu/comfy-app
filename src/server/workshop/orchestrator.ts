// ── Workshop MCP 编排器（服务端流水线）────────────────────────
// 把工坊「脚本 → 角色 → 分镜 → 生图 → 生视频」5 阶段落为可复用服务端函数，
// 供 MCP 工具与（未来的）界面共享调用。仅依赖本目录下的本地模块 +
// 纯函数模块（script-parser / script-parse / prompt-builder），不触碰
// `server-only` / `~/env`，故 stdio 与 Next HTTP 双 transport 共用。
import type { Character, ProjectMeta, Scene, Shot } from "@/lib/workshop/types";
import { parseIdeaToScenes } from "@/lib/workshop/script-parser";
import {
  buildExtractCharactersMessages,
  buildExtractShotsMessages,
  buildShotsFromEntries,
  mergeCharacterDrafts,
  parseExtractedCharacters,
  parseExtractedShots,
} from "@/lib/workshop/script-parse";
import {
  buildCharacterNegative,
  buildCharacterPrompt,
  buildShotNegative,
  buildShotPrompt,
} from "@/lib/workshop/prompt-builder";
import { sizeSpecToWxH, type SizeSpec } from "@/lib/size-presets";
import {
  generateImageViaApi,
  pollVideoViaApi,
  resolveMediaDataUrl,
  submitVideoViaApi,
} from "./api-channel";
import { generateImageViaComfyUI, submitVideoViaComfyUI } from "./comfyui";
import {
  buildCompositionPlan,
  renderComposition,
  writeCompositionPlan,
  type CompositionPlan,
} from "./final-compose";
import { completeWorkshopLLM, getWorkshopLLMConfig } from "./llm";
import * as repo from "./repository";
import type { WorkshopSessionState } from "./types";

const SCRIPT_SYSTEM = `你是漫剧编剧。把用户给出的灵感 / 梗概扩展成一份结构清晰、可直接用于分镜的剧本（Markdown）。
要求：分场景书写，每场用「场景N · 标题」起头，含地点 / 时间；动作行以「Δ」开头，
台词行以「V1 角色：台词」形式书写。中文，画面感强，节奏适合短视频。`;

function buildScriptMessages(
  idea: string,
  meta: ProjectMeta,
): Parameters<typeof completeWorkshopLLM>[1] {
  const brief = [
    meta.tone ? `基调：${meta.tone}` : "",
    meta.logline ? `一句话梗概：${meta.logline}` : "",
    `灵感：${idea}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: SCRIPT_SYSTEM },
    { role: "user", content: brief },
  ];
}

// ── 纯函数：提示词重算（便于单测，无副作用）───────────────────

/** 依据角色卡字段重算 positive / negative 提示词。 */
export function rebuildCharacterPrompts(characters: Character[]): Character[] {
  return characters.map((c) => ({
    ...c,
    positivePrompt: buildCharacterPrompt(c),
    negativePrompt: buildCharacterNegative(c),
  }));
}

/** 依据场景 / 角色重算每个镜头的 prompt / negativePrompt。 */
export function rebuildShotPrompts(
  shots: Shot[],
  scenes: Scene[],
  characters: Character[],
): Shot[] {
  return shots.map((shot) => {
    const scene = scenes.find((s) => s.id === shot.sceneId);
    const linked = characters.filter((c) => shot.characterIds.includes(c.id));
    return {
      ...shot,
      prompt: buildShotPrompt(shot, scene, linked),
      negativePrompt: buildShotNegative(linked),
    };
  });
}

function extractRemoteTaskId(clipUrl: string | undefined): string | null {
  if (!clipUrl) return null;
  return clipUrl.startsWith("task:") ? clipUrl.slice("task:".length) : null;
}

// ── 会话读写辅助 ───────────────────────────────────────────────

async function load(id: string): Promise<WorkshopSessionState> {
  const state = await repo.getSession(id);
  if (!state) throw new Error(`工坊会话不存在：${id}`);
  return state;
}

// ── 阶段 0：会话与元信息 ───────────────────────────────────────

export async function createSession(input: repo.CreateSessionInput = {}) {
  return repo.createSession(input);
}

export async function listSessions() {
  return repo.listSessions();
}

export function getSession(id: string) {
  return repo.getSession(id);
}

export async function deleteSession(id: string) {
  return repo.deleteSession(id);
}

export async function setMeta(
  id: string,
  patch: Partial<Pick<ProjectMeta, "title" | "type" | "tone" | "logline">>,
) {
  const state = await load(id);
  state.meta = { ...state.meta, ...patch };
  await repo.updateState(id, state);
  return state.meta;
}

export async function setIdea(id: string, idea: string) {
  const state = await load(id);
  state.idea = idea;
  await repo.updateState(id, state);
  return { idea: state.idea };
}

// ── 阶段 1：脚本 ───────────────────────────────────────────────

export async function generateScript(id: string) {
  const state = await load(id);
  if (!state.idea.trim())
    throw new Error("请先设置 idea（灵感 / 梗概）再生成脚本");
  const cfg = await getWorkshopLLMConfig();
  const script = await completeWorkshopLLM(
    cfg,
    buildScriptMessages(state.idea, state.meta),
  );
  const scenes = parseIdeaToScenes(script, {
    title: state.meta.title,
    type: state.meta.type,
    tone: state.meta.tone,
    logline: state.meta.logline,
  });
  state.meta = { ...state.meta, scriptMarkdown: script };
  state.scenes = scenes;
  state.stage = "script";
  await repo.updateState(id, state);
  return { script, sceneCount: scenes.length, scenes };
}

export async function setScript(id: string, markdown: string, parse = true) {
  const state = await load(id);
  state.meta = { ...state.meta, scriptMarkdown: markdown };
  if (parse) {
    state.scenes = parseIdeaToScenes(markdown, {
      title: state.meta.title,
      type: state.meta.type,
      tone: state.meta.tone,
      logline: state.meta.logline,
    });
  }
  state.stage = "script";
  await repo.updateState(id, state);
  return {
    scriptLength: markdown.length,
    sceneCount: state.scenes.length,
    scenes: state.scenes,
  };
}

// ── 阶段 2：角色卡 ─────────────────────────────────────────────

export async function extractCharacters(id: string) {
  const state = await load(id);
  if (!state.meta.scriptMarkdown?.trim())
    throw new Error("请先生成 / 设置脚本再提取角色");
  const cfg = await getWorkshopLLMConfig();
  const text = await completeWorkshopLLM(
    cfg,
    buildExtractCharactersMessages(state.meta.scriptMarkdown),
  );
  const drafts = parseExtractedCharacters(text);
  const { list, added, skipped } = mergeCharacterDrafts(
    state.characters,
    drafts,
    [],
  );
  state.characters = list;
  state.stage = "character";
  await repo.updateState(id, state);
  return { added, skipped, total: list.length, characters: list };
}

export async function setCharacters(id: string, characters: Character[]) {
  const state = await load(id);
  state.characters = rebuildCharacterPrompts(characters);
  state.stage = "character";
  await repo.updateState(id, state);
  return state.characters;
}

// ── 阶段 3：分镜 ───────────────────────────────────────────────

export async function buildStoryboard(id: string) {
  const state = await load(id);
  if (!state.meta.scriptMarkdown?.trim())
    throw new Error("请先生成 / 设置脚本再拆分分镜");
  const names = state.characters.map((c) => c.name);
  const cfg = await getWorkshopLLMConfig();
  const text = await completeWorkshopLLM(
    cfg,
    buildExtractShotsMessages(state.meta.scriptMarkdown, names),
  );
  const entries = parseExtractedShots(text);
  const shots = rebuildShotPrompts(
    buildShotsFromEntries(entries, 0, state.scenes, state.characters),
    state.scenes,
    state.characters,
  );
  state.shots = shots;
  state.stage = "storyboard";
  await repo.updateState(id, state);
  return { shotCount: shots.length, shots };
}

export async function setStoryboard(id: string, shots: Shot[]) {
  const state = await load(id);
  state.shots = rebuildShotPrompts(shots, state.scenes, state.characters);
  state.stage = "storyboard";
  await repo.updateState(id, state);
  return state.shots;
}

// ── 阶段 4：生图 ───────────────────────────────────────────────

export interface GenerateImageInput {
  shotId?: string;
  characterId?: string;
  channel?: "api" | "comfyui";
  /** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见 `lib/size-presets`）。
   *  缺省各通道按自己的默认档走。调用方（MCP）若仍按老口径给 "1024x1024"，
   *  由边界用 `toSizeSpec` 归一。 */
  size?: SizeSpec;
}

export async function generateImage(id: string, input: GenerateImageInput) {
  const state = await load(id);
  const channel = input.channel ?? "api";
  let prompt: string;
  let negative: string | undefined;
  const shot = input.shotId
    ? state.shots.find((s) => s.id === input.shotId)
    : undefined;
  const character = input.characterId
    ? state.characters.find((c) => c.id === input.characterId)
    : undefined;
  if (shot) {
    prompt = shot.prompt || shot.description;
    negative = shot.negativePrompt || undefined;
  } else if (character) {
    prompt = buildCharacterPrompt(character);
    negative = buildCharacterNegative(character) || undefined;
  } else {
    throw new Error("generateImage 需要有效的 shotId 或 characterId");
  }
  if (channel === "comfyui") {
    const url = await generateImageViaComfyUI({
      prompt,
      negative,
      size: input.size,
      sessionId: id,
    });
    if (shot) {
      shot.imageUrl = url;
      shot.status = "done";
    } else if (character) {
      character.positivePrompt = prompt;
    }
    await repo.updateState(id, state);
    return { url, channel: "comfyui" };
  }
  const url = await generateImageViaApi({
    prompt,
    negative,
    /* 上游 images/generations 只认 "WxH" —— 尺寸表达在**外部 wire** 边界折算。 */
    ...(input.size ? { size: sizeSpecToWxH(input.size, "image") } : {}),
  });
  if (shot) {
    shot.imageUrl = url;
    shot.status = "done";
  } else if (character) {
    character.positivePrompt = prompt;
  }
  await repo.updateState(id, state);
  return { url };
}

// ── 阶段 5：生视频 ─────────────────────────────────────────────

export interface SubmitVideoInput {
  shotId: string;
  channel?: "api" | "comfyui";
  prompt?: string;
  negative?: string;
  frames?: number;
  fps?: number;
  useFirstFrame?: boolean;
}

export async function submitVideo(id: string, input: SubmitVideoInput) {
  const state = await load(id);
  const shot = state.shots.find((s) => s.id === input.shotId);
  if (!shot) throw new Error(`镜头不存在：${input.shotId}`);
  if (input.channel === "comfyui") {
    let imageDataUrl: string | undefined;
    if (input.useFirstFrame && shot.imageUrl) {
      imageDataUrl = await resolveMediaDataUrl(shot.imageUrl);
    }
    const r = await submitVideoViaComfyUI({
      prompt: input.prompt ?? shot.description,
      negative: input.negative ?? shot.negativePrompt,
      imageDataUrl,
      sessionId: id,
    });
    if (r.url) {
      shot.clipUrl = r.url;
      shot.clipStatus = "done";
    }
    await repo.updateState(id, state);
    return { url: r.url, channel: "comfyui" };
  }
  let imageDataUrl: string | undefined;
  if (input.useFirstFrame && shot.imageUrl) {
    imageDataUrl = await resolveMediaDataUrl(shot.imageUrl);
  }
  const result = await submitVideoViaApi({
    prompt: input.prompt ?? shot.description,
    negative: input.negative ?? shot.negativePrompt,
    imageDataUrl,
    frames: input.frames,
    fps: input.fps,
  });
  if (result.url) {
    shot.clipUrl = result.url;
    shot.clipStatus = "done";
  } else if (result.remoteTaskId) {
    shot.clipUrl = `task:${result.remoteTaskId}`;
    shot.clipStatus = "running";
  }
  await repo.updateState(id, state);
  return result;
}

export async function pollVideo(id: string, shotId: string) {
  const state = await load(id);
  const shot = state.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const taskId = extractRemoteTaskId(shot.clipUrl);
  if (!taskId) {
    return {
      pending: false,
      url: shot.clipUrl,
      note: "该镜头没有待轮询的异步任务",
    };
  }
  const r = await pollVideoViaApi(taskId);
  if (!r.pending && r.url) {
    shot.clipUrl = r.url;
    shot.clipStatus = "done";
    await repo.updateState(id, state);
  }
  return { pending: r.pending, url: r.url };
}

// ── 阶段 6：成片合成 ─────────────────────────────────────────────

export interface ComposeFinalInput {
  render?: boolean;
  title?: string;
}

export interface ComposeFinalResult {
  plan: CompositionPlan;
  planPath: string;
  outputPath?: string;
  renderNote?: string;
}

/** 把分镜按序合成为成片：写出合成清单（JSON），可选 ffmpeg 渲染成 mp4。 */
export async function composeFinal(
  id: string,
  input: ComposeFinalInput = {},
): Promise<ComposeFinalResult> {
  const state = await load(id);
  const plan = buildCompositionPlan(
    input.title ?? state.meta.title,
    state.shots,
  );
  const planPath = await writeCompositionPlan(id, plan);
  let outputPath: string | undefined;
  let renderNote: string | undefined;
  if (input.render) {
    const r = await renderComposition(plan, `${id}-final`);
    if (r.ok && r.outputPath) outputPath = r.outputPath;
    renderNote = r.note;
  }
  state.stage = "final_edit";
  await repo.updateState(id, state);
  return { plan, planPath, outputPath, renderNote };
}

export type { WorkshopSessionState };
