// ── Workshop MCP 编排器（服务端流水线）────────────────────────
// 把工坊「脚本 → 角色 → 分镜 → 生图 → 生视频」5 阶段落为可复用服务端函数，
// 供 MCP 工具与（未来的）界面共享调用。仅依赖本目录下的本地模块 +
// 纯函数模块（script-parser / script-parse / prompt-builder），不触碰
// `server-only` / `~/env`，故 stdio 与 Next HTTP 双 transport 共用。
import type { Character, ProjectMeta, Scene, Shot } from "~/lib/workshop/types";
import { advancePipelineStage } from "~/lib/workshop/types";
import { parseIdeaToScenes } from "~/lib/workshop/script-parser";
import {
  buildExtractCharactersMessages,
  buildExtractShotsMessages,
  buildShotsFromEntries,
  mergeCharacterDrafts,
  parseExtractedCharacters,
  parseExtractedShots,
} from "~/lib/workshop/script-parse";
import {
  buildCharacterNegative,
  buildCharacterPrompt,
  buildShotNegative,
  buildShotPrompt,
} from "~/lib/workshop/prompt-builder";
import { sizeSpecToWxH, type SizeSpec } from "~/lib/media/size-presets";
import { loadSizePresetTable } from "~/lib/media/size-preset-fs.server";
import { KeyedAsyncMutex } from "~/lib/async-mutex";
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
export function rebuildCharacterPrompts(characters: Array<Character>): Array<Character> {
  return characters.map((c) => ({
    ...c,
    positivePrompt: buildCharacterPrompt(c),
    negativePrompt: buildCharacterNegative(c),
  }));
}

/** 依据场景 / 角色重算每个镜头的 prompt / negativePrompt。 */
export function rebuildShotPrompts(
  shots: Array<Shot>,
  scenes: Array<Scene>,
  characters: Array<Character>,
): Array<Shot> {
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
  if (clipUrl === undefined) {
    return null;
  }
  return clipUrl.startsWith("task:") ? clipUrl.slice("task:".length) : null;
}

// ── 会话读写辅助 ───────────────────────────────────────────────

async function load(
  id: string,
): Promise<{ baseline: WorkshopSessionState; state: WorkshopSessionState }> {
  const state = await repo.getSession(id);
  if (!state) {
    throw new Error(`工坊会话不存在：${id}`);
  }
  /* 变更基线（ISSUE #4730）：改动前的内容快照。updateState 按列与它比对，
   * 只把会话真正改过的列写进 production —— 慢 IO 期间界面改的其它列
   * （剧本 / 角色卡 / 镜头提示词…）不再被旧快照整列覆盖。 */
  const baseline = structuredClone(state);
  return { state, baseline };
}

/* 会话级写互斥（ISSUE #3891 / #3895）：下面每个变更函数的形状都是
 * 「load 快照 →（数秒到数分钟的）外部调用 → updateState 整包写回」，
 * 快照在读与写之间会过期 —— 并发调用（MCP 超时重试与首叫在飞交叠、
 * 同时给两个镜头生图）会以各自的旧快照互相覆盖（后写者抹掉先写者
 * 已落库的产物），或双双通过幂等闸重复提交外部计费任务。updateState
 * 的 immediate 事务只串行化了「写段」；这里把整个读-改-写跨度按会话
 * id 串行化（进程内，MCP 服务端单进程），锁内的 load 拿到的永远是
 * 上一个变更落库后的最新状态，幂等闸因此真实生效。读路径（getSession /
 * listSessions）不进锁：界面读的是 production 权威内容，保持实时。
 * 锁内不得再调其它带锁编排函数（会排队等自己 → 死锁）。 */
const sessionMutationMutex = new KeyedAsyncMutex();

// ── 阶段 0：会话与元信息 ───────────────────────────────────────

/** 会话创建的去重窗口与指纹账（ISSUE #3852，见 createSession 内注释）。 */
const CREATE_DEDUP_TTL_MS = 5 * 60_000;
type CreateFingerprintEntry = { at: number; session: Promise<string> };

function createFingerprintStore(): Map<string, CreateFingerprintEntry> {
  const g = globalThis as typeof globalThis & {
    __workshopCreateDedup_v1?: Map<string, CreateFingerprintEntry>;
  };
  g.__workshopCreateDedup_v1 ??= new Map();
  return g.__workshopCreateDedup_v1;
}

export async function createSession(input: repo.CreateSessionInput = {}): Promise<string> {
  /* 重试去重（ISSUE #3852）：MCP 工具超时重试 / 模型对同一指令二次调用时，
   * 参数逐字相同——按参数指纹在短窗口内返回既有会话，不再重复建
   * 「会话 + 项目 + production」三件套。显式绑 projectId 的调用同样参与：
   * 重试重复绑定无害，返回同一会话。进程内 Map 即可（MCP 服务端单进程），
   * 挂 globalThis 与仓内其它单例同口径。 */
  const dedupKey = JSON.stringify([
    input.userId ?? null,
    input.projectId ?? null,
    input.title ?? "",
    input.type ?? "",
    input.tone ?? "",
    input.logline ?? "",
    input.idea ?? "",
  ]);
  const store = createFingerprintStore();
  /* 机会性清理过期且未再命中的指纹（ISSUE #3953 / #3850）：避免多样化/自动化
   * 创建流量下历史 key 永久驻留；只删已过 TTL 的条目，不影响窗口内复用语义。 */
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.at >= CREATE_DEDUP_TTL_MS) {
      store.delete(key);
    }
  }
  const hit = store.get(dedupKey);
  if (hit !== undefined && now - hit.at < CREATE_DEDUP_TTL_MS) {
    /* 命中还要复核会话仍在：测试夹具会整库重置，生产侧也可能删会话；
     * 已消失的命中按未命中处理（重新创建）—— 去重不跨「会话已消失」。 */
    const id = await hit.session;
    const existing = await repo.getSession(id);
    if (existing) {
      return id;
    }
    store.delete(dedupKey);
  }
  /* 先占位后创建（ISSUE #3908）：指纹在创建完成**之前**就写进账本，
   * 并发同参调用共享同一次创建（各拿到同一个 promise），不再各自建一套。
   * 创建失败要把占位撤掉，否则 TTL 窗口内的后续重试会拿到同一个 rejection。 */
  const session = Promise.resolve(repo.createSession(input));
  session.catch(() => {
    const current = store.get(dedupKey);
    if (current?.session === session) {
      store.delete(dedupKey);
    }
  });
  store.set(dedupKey, { at: Date.now(), session });
  return session;
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

async function setMetaImpl(
  id: string,
  patch: Partial<Pick<ProjectMeta, "title" | "type" | "tone" | "logline">>,
) {
  const { state, baseline } = await load(id);
  state.meta = { ...state.meta, ...patch };
  await repo.updateState(id, state, baseline);
  return state.meta;
}

export function setMeta(
  id: string,
  patch: Partial<Pick<ProjectMeta, "title" | "type" | "tone" | "logline">>,
) {
  return sessionMutationMutex.run(id, () => setMetaImpl(id, patch));
}

async function setIdeaImpl(id: string, idea: string) {
  const { state, baseline } = await load(id);
  state.idea = idea;
  await repo.updateState(id, state, baseline);
  return { idea: state.idea };
}

export function setIdea(id: string, idea: string) {
  return sessionMutationMutex.run(id, () => setIdeaImpl(id, idea));
}

// ── 阶段 1：脚本 ───────────────────────────────────────────────

async function generateScriptImpl(id: string, force = false) {
  const { state, baseline } = await load(id);
  if (!state.idea.trim()) {
    throw new Error("请先设置 idea（灵感 / 梗概）再生成脚本");
  }
  /* 幂等闸（ISSUE #3852）：已有剧本时，重试 / 二次指令不再重跑 LLM（重复
   * token 消耗 + 整幅覆盖）；显式 force 才重新生成。 */
  if (
    !force &&
    state.meta.scriptMarkdown !== undefined &&
    state.meta.scriptMarkdown.trim() !== ""
  ) {
    return {
      script: state.meta.scriptMarkdown,
      sceneCount: state.scenes.length,
      scenes: state.scenes,
      skipped: true,
    };
  }
  const cfg = await getWorkshopLLMConfig();
  const script = await completeWorkshopLLM(cfg, buildScriptMessages(state.idea, state.meta));
  const scenes = parseIdeaToScenes(script, {
    title: state.meta.title,
    type: state.meta.type,
    tone: state.meta.tone,
    logline: state.meta.logline,
  });
  state.meta = { ...state.meta, scriptMarkdown: script };
  state.scenes = scenes;
  state.stage = advancePipelineStage(state.stage, "script");
  await repo.updateState(id, state, baseline);
  return { script, sceneCount: scenes.length, scenes };
}

export function generateScript(id: string, force = false) {
  return sessionMutationMutex.run(id, () => generateScriptImpl(id, force));
}

async function setScriptImpl(id: string, markdown: string, parse = true) {
  const { state, baseline } = await load(id);
  state.meta = { ...state.meta, scriptMarkdown: markdown };
  if (parse) {
    state.scenes = parseIdeaToScenes(markdown, {
      title: state.meta.title,
      type: state.meta.type,
      tone: state.meta.tone,
      logline: state.meta.logline,
    });
  }
  state.stage = advancePipelineStage(state.stage, "script");
  await repo.updateState(id, state, baseline);
  return {
    scriptLength: markdown.length,
    sceneCount: state.scenes.length,
    scenes: state.scenes,
  };
}

export function setScript(id: string, markdown: string, parse = true) {
  return sessionMutationMutex.run(id, () => setScriptImpl(id, markdown, parse));
}

// ── 阶段 2：角色卡 ─────────────────────────────────────────────

async function extractCharactersImpl(id: string, force = false) {
  const { state, baseline } = await load(id);
  if (state.meta.scriptMarkdown === undefined || state.meta.scriptMarkdown.trim() === "") {
    throw new Error("请先生成 / 设置脚本再提取角色");
  }
  /* 幂等闸（ISSUE #3852）：已有角色卡时重复调用不再重跑 LLM 提取（合并本身
   * 按 name 幂等，但外部调用是重复消耗）；显式 force 才重跑。 */
  if (!force && state.characters.length > 0) {
    return {
      added: 0,
      skipped: state.characters.length,
      total: state.characters.length,
      characters: state.characters,
    };
  }
  const cfg = await getWorkshopLLMConfig();
  const text = await completeWorkshopLLM(
    cfg,
    buildExtractCharactersMessages(state.meta.scriptMarkdown),
  );
  const drafts = parseExtractedCharacters(text);
  const { list, added, skipped } = mergeCharacterDrafts(state.characters, drafts, []);
  state.characters = list;
  state.stage = advancePipelineStage(state.stage, "character");
  await repo.updateState(id, state, baseline);
  return { added, skipped, total: list.length, characters: list };
}

export function extractCharacters(id: string, force = false) {
  return sessionMutationMutex.run(id, () => extractCharactersImpl(id, force));
}

async function setCharactersImpl(id: string, characters: Array<Character>) {
  const { state, baseline } = await load(id);
  state.characters = rebuildCharacterPrompts(characters);
  state.stage = advancePipelineStage(state.stage, "character");
  await repo.updateState(id, state, baseline);
  return state.characters;
}

export function setCharacters(id: string, characters: Array<Character>) {
  return sessionMutationMutex.run(id, () => setCharactersImpl(id, characters));
}

// ── 阶段 3：分镜 ───────────────────────────────────────────────

async function buildStoryboardImpl(id: string, force = false) {
  const { state, baseline } = await load(id);
  if (state.meta.scriptMarkdown === undefined || state.meta.scriptMarkdown.trim() === "") {
    throw new Error("请先生成 / 设置脚本再拆分分镜");
  }
  /* 幂等闸（ISSUE #3852）：已有分镜时重复调用不再重跑 LLM；显式 force 才重拆。 */
  if (!force && state.shots.length > 0) {
    return { shotCount: state.shots.length, shots: state.shots, skipped: true };
  }
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
  state.stage = advancePipelineStage(state.stage, "storyboard");
  await repo.updateState(id, state, baseline);
  return { shotCount: shots.length, shots };
}

export function buildStoryboard(id: string, force = false) {
  return sessionMutationMutex.run(id, () => buildStoryboardImpl(id, force));
}

async function setStoryboardImpl(id: string, shots: Array<Shot>) {
  const { state, baseline } = await load(id);
  state.shots = rebuildShotPrompts(shots, state.scenes, state.characters);
  state.stage = advancePipelineStage(state.stage, "storyboard");
  await repo.updateState(id, state, baseline);
  return state.shots;
}

export function setStoryboard(id: string, shots: Array<Shot>) {
  return sessionMutationMutex.run(id, () => setStoryboardImpl(id, shots));
}

// ── 阶段 4：生图 ───────────────────────────────────────────────

export type GenerateImageInput = {
  channel?: "api" | "comfyui";
  characterId?: string;
  /** 显式重跑（ISSUE #3852）：镜头已有产物时，缺省直接返回既有图片，
   *  不重复执行外部生图调用。 */
  force?: boolean;
  shotId?: string;
  /** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见 `lib/size-presets`）。
   *  缺省各通道按自己的默认档走。调用方（MCP）若仍按老口径给 "1024x1024"，
   *  由边界用 `toSizeSpec` 归一。 */
  size?: SizeSpec;
};

async function generateImageImpl(id: string, input: GenerateImageInput) {
  const { state, baseline } = await load(id);
  const channel = input.channel ?? "api";
  let prompt: string;
  let negative: string | undefined;
  const shot =
    input.shotId === undefined ? undefined : state.shots.find((s) => s.id === input.shotId);
  const character =
    input.characterId === undefined
      ? undefined
      : state.characters.find((c) => c.id === input.characterId);
  /* 幂等闸（ISSUE #3852）：镜头已有产物时，重试 / 二次指令不再重复执行外部
   * 生图调用（重复费用 / GPU），也不再用新结果覆盖旧产物引用。角色卡不落
   * 产物字段，无此闸。会话锁（sessionMutationMutex）保证闸与外部调用之间
   * 没有并发插队 —— 锁内重读到的必是最新状态。 */
  if (input.force !== true && shot && shot.imageUrl !== undefined && shot.imageUrl !== "") {
    return { url: shot.imageUrl, channel };
  }
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
    await repo.updateState(id, state, baseline);
    return { url, channel: "comfyui" };
  }
  /* 尺寸换算用**生效的那份**表（ISSUE #3972）：现读项目默认 + 本机覆盖，
   * 与设置页 / 界面控件同源 —— 设置里改过的表在出图链路真的生效。 */
  const sizeTable = await loadSizePresetTable();
  const url = await generateImageViaApi({
    prompt,
    negative,
    /* 上游 images/generations 只认 "WxH" —— 尺寸表达在**外部 wire** 边界折算。 */
    ...(input.size ? { size: sizeSpecToWxH(input.size, "image", sizeTable) } : {}),
  });
  if (shot) {
    shot.imageUrl = url;
    shot.status = "done";
  } else if (character) {
    character.positivePrompt = prompt;
  }
  await repo.updateState(id, state, baseline);
  return { url };
}

export function generateImage(id: string, input: GenerateImageInput) {
  return sessionMutationMutex.run(id, () => generateImageImpl(id, input));
}

// ── 阶段 5：生视频 ─────────────────────────────────────────────

export type SubmitVideoInput = {
  channel?: "api" | "comfyui";
  /** 显式重跑（ISSUE #3852）：镜头已有产物或在跑的异步任务时，缺省直接返回
   *  既有引用，不重复提交外部计费调用。 */
  force?: boolean;
  fps?: number;
  frames?: number;
  negative?: string;
  prompt?: string;
  shotId: string;
  useFirstFrame?: boolean;
};

async function submitVideoImpl(id: string, input: SubmitVideoInput) {
  const { state, baseline } = await load(id);
  const shot = state.shots.find((s) => s.id === input.shotId);
  if (!shot) {
    throw new Error(`镜头不存在：${input.shotId}`);
  }
  /* 幂等闸（ISSUE #3852）：镜头已有产物（done 的 url）或在跑的异步任务
   * （`task:` 前缀）时，重试 / 二次指令不再重新提交外部计费调用，也不再用
   * 新任务句柄覆盖旧的（旧的将无法轮询取回）。显式 force 才重跑。
   * 会话锁（sessionMutationMutex）保证闸与外部计费提交之间没有并发插队
   *（ISSUE #3895）—— 锁内重读到的必是最新状态。 */
  if (input.force !== true && shot.clipUrl !== undefined && shot.clipUrl !== "") {
    return { url: shot.clipUrl, channel: input.channel ?? "api", skipped: true };
  }
  if (input.channel === "comfyui") {
    let imageDataUrl: string | undefined;
    if (input.useFirstFrame === true && shot.imageUrl !== undefined && shot.imageUrl !== "") {
      imageDataUrl = await resolveMediaDataUrl(shot.imageUrl);
    }
    const r = await submitVideoViaComfyUI({
      prompt: input.prompt ?? shot.description,
      negative: input.negative ?? shot.negativePrompt,
      imageDataUrl,
      sessionId: id,
    });
    if (r.url !== undefined && r.url !== "") {
      shot.clipUrl = r.url;
      shot.clipStatus = "done";
    }
    await repo.updateState(id, state, baseline);
    return { url: r.url, channel: "comfyui" };
  }
  let imageDataUrl: string | undefined;
  if (input.useFirstFrame === true && shot.imageUrl !== undefined && shot.imageUrl !== "") {
    imageDataUrl = await resolveMediaDataUrl(shot.imageUrl);
  }
  const result = await submitVideoViaApi({
    prompt: input.prompt ?? shot.description,
    negative: input.negative ?? shot.negativePrompt,
    imageDataUrl,
    frames: input.frames,
    fps: input.fps,
  });
  if (result.url !== undefined && result.url !== "") {
    shot.clipUrl = result.url;
    shot.clipStatus = "done";
  } else if (result.remoteTaskId !== undefined && result.remoteTaskId !== "") {
    shot.clipUrl = `task:${result.remoteTaskId}`;
    shot.clipStatus = "running";
  }
  await repo.updateState(id, state, baseline);
  return result;
}

export function submitVideo(id: string, input: SubmitVideoInput) {
  return sessionMutationMutex.run(id, () => submitVideoImpl(id, input));
}

async function pollVideoImpl(id: string, shotId: string) {
  const { state, baseline } = await load(id);
  const shot = state.shots.find((s) => s.id === shotId);
  if (!shot) {
    throw new Error(`镜头不存在：${shotId}`);
  }
  const taskId = extractRemoteTaskId(shot.clipUrl);
  if (taskId === null || taskId === "") {
    return {
      pending: false,
      url: shot.clipUrl,
      note: "该镜头没有待轮询的异步任务",
    };
  }
  const r = await pollVideoViaApi(taskId);
  if (!r.pending && r.url !== undefined && r.url !== "") {
    shot.clipUrl = r.url;
    shot.clipStatus = "done";
    await repo.updateState(id, state, baseline);
  }
  return { pending: r.pending, url: r.url };
}

export function pollVideo(id: string, shotId: string) {
  return sessionMutationMutex.run(id, () => pollVideoImpl(id, shotId));
}

// ── 阶段 6：成片合成 ─────────────────────────────────────────────

export type ComposeFinalInput = {
  render?: boolean;
  title?: string;
};

export type ComposeFinalResult = {
  outputPath?: string;
  plan: CompositionPlan;
  planPath: string;
  renderNote?: string;
};

/** 把分镜按序合成为成片：写出合成清单（JSON），可选 ffmpeg 渲染成 mp4。 */
export function composeFinal(
  id: string,
  input: ComposeFinalInput = {},
): Promise<ComposeFinalResult> {
  return sessionMutationMutex.run(id, () => composeFinalImpl(id, input));
}

async function composeFinalImpl(
  id: string,
  input: ComposeFinalInput = {},
): Promise<ComposeFinalResult> {
  const { state, baseline } = await load(id);
  const plan = buildCompositionPlan(input.title ?? state.meta.title, state.shots);
  const planPath = await writeCompositionPlan(id, plan);
  let outputPath: string | undefined;
  let renderNote: string | undefined;
  if (input.render === true) {
    const r = await renderComposition(plan, `${id}-final`);
    if (r.ok && r.outputPath !== undefined && r.outputPath !== "") {
      outputPath = r.outputPath;
    }
    renderNote = r.note;
  }
  state.stage = advancePipelineStage(state.stage, "final_edit");
  await repo.updateState(id, state, baseline);
  return { plan, planPath, outputPath, renderNote };
}

export type { WorkshopSessionState };
