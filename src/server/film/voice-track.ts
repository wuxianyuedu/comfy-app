/**
 * 逐镜配音的声音绑定与音轨混音（ISSUE #5213）：纯构造，不碰 IO / DB。
 * 借鉴 LocalMiniDrama 的剧集→角色→分镜三级方言覆写、NovelVids 的资产声音绑定、
 * MiniMax H3 Director 的跨镜音频轨。
 */
import { asRecord } from "~/lib/is-record";

/** 声音绑定：音色 / 方言 / 语速；顺序按字典排（perfectionist）。 */
export type VoiceBinding = {
  dialect?: string;
  language?: string;
  speed?: number;
  timbre?: string;
};

/** 一条逐镜对白音轨：文件地址与在成片中的起始秒数。 */
export type DialogueTrack = {
  file: string;
  start: number;
};

/** 只认非空字符串；脏值当没给。 */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 外部 JSON → 受控声音绑定；形状不对的字段当没给，不猜。 */
function normalizeVoice(raw: Record<string, unknown>): VoiceBinding {
  const dialect = text(raw.dialect);
  const timbre = text(raw.timbre);
  const speed =
    typeof raw.speed === "number" && Number.isFinite(raw.speed) && raw.speed > 0
      ? raw.speed
      : undefined;
  return {
    ...(dialect === undefined ? {} : { dialect }),
    ...(speed === undefined ? {} : { speed }),
    ...(timbre === undefined ? {} : { timbre }),
  };
}

/**
 * 声音归属的唯一口径：镜头覆写 > 出场角色绑定 > 空绑定（用工作流图内默认音色）。
 * 多个出场角色按顺序取第一个有绑定的。
 */
export function resolveVoice(
  characters: ReadonlyArray<{ id: string; voice?: unknown }>,
  characterIds: ReadonlyArray<string>,
  shotVoice: unknown,
): VoiceBinding {
  const override = asRecord(shotVoice);
  if (override !== null) {
    return normalizeVoice(override);
  }
  for (const id of characterIds) {
    const match = characters.find((candidate) => candidate.id === id);
    const binding = asRecord(match?.voice);
    if (binding !== null) {
      return normalizeVoice(binding);
    }
  }
  return {};
}

/** TTS 工作流输入参数：对白文本 + 声音绑定，只下发有值的字段。 */
export function ttsParamsOf(opts: {
  dialogue: string;
  voice: VoiceBinding;
  workflowId?: string;
}): Record<string, unknown> {
  const { dialogue, voice, workflowId } = opts;
  const params: Record<string, unknown> = { text: dialogue.trim() };
  const { dialect, language, speed, timbre } = voice;
  if (dialect !== undefined) {
    params.dialect = dialect;
  }
  if (language !== undefined && language !== "") {
    params.language = language;
  }
  if (speed !== undefined) {
    params.speed = speed;
  }
  if (timbre !== undefined) {
    params.timbre = timbre;
  }
  if (workflowId !== undefined && workflowId !== "") {
    params.workflowId = workflowId;
  }
  return params;
}

/** 可重试的瞬时故障词表；业务失败（缺工作流 / 形状非法）不在这里重试。 */
const TRANSIENT_PATTERNS = [
  "429",
  "503",
  "connection reset",
  "econnreset",
  "service unavailable",
  "timeout",
  "timed out",
];

/** 最多 3 次尝试（attempt 0/1 可重试）；只有瞬时故障才重试。 */
export function shouldRetryTts(attempt: number, error: string): boolean {
  if (attempt >= 2) {
    return false;
  }
  const lowered = error.toLowerCase();
  return TRANSIENT_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * 逐镜对白轨 + BGM 混音的 ffmpeg 参数（纯函数）。
 * 每镜音轨按 start 用 adelay 对齐，没有产物的静音镜直接缺席；BGM 可缺省。
 * 只混音，画面 `-c:v copy` 原样透传。没有任何音轨时只复制画面。
 */
export function buildDialogueMixArgs(opts: {
  bgm?: string;
  dialogueTracks: ReadonlyArray<DialogueTrack>;
  output: string;
  video: string;
}): Array<string> {
  const { bgm, dialogueTracks, output, video } = opts;
  const args: Array<string> = ["-y", "-i", video];
  for (const track of dialogueTracks) {
    args.push("-i", track.file);
  }
  const hasBgm = bgm !== undefined && bgm !== "";
  if (hasBgm && bgm !== undefined) {
    args.push("-i", bgm);
  }
  if (dialogueTracks.length === 0 && !hasBgm) {
    return [...args, "-map", "0:v", "-c", "copy", output];
  }

  const filters: Array<string> = [];
  dialogueTracks.forEach((track, i) => {
    const delay = Math.max(0, Math.round(track.start * 1000));
    filters.push(`[${i + 1}:a]adelay=${delay}|${delay}[d${i}]`);
  });
  const labels = dialogueTracks.map((_, i) => `[d${i}]`);
  if (hasBgm && bgm !== undefined) {
    labels.push(`[${dialogueTracks.length + 1}:a]`);
  }
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:dropout_transition=0[a]`);
  return [
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    output,
  ];
}

/** `filmShot.params`（JSON 列）里的配音产物地址；只认非空字符串。 */
export function audioPathOfParams(params: unknown): string | null {
  return text(asRecord(params)?.audioPath) ?? null;
}
