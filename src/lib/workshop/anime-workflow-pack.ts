/**
 * 漫剧推荐工作流包的只读分析（ISSUE #5219）：扫描用户**自己导入**的 ComfyUI RAW JSON，
 * 按模式码标注用途与必需节点，给依赖/模型清单和缺失节点。刻意不内置模板，也不下载模型——
 * 工作流库仍是唯一来源，这里只做判定与提示；纯函数，不碰 IO/DB/时钟。
 * 借鉴 MiniMax H3 Director 的示例工作流 + Guide、Toonflow 的插件市场提示。
 */
import { asRecord } from "~/lib/is-record";

/** 漫剧镜头生成常见的三种模式（字典序，判据与展示同源）。 */
export const ANIME_PACK_MODES = ["FLF2V", "I2V", "T2V"] as const;

export type AnimePackAnalysis = {
  dependencies: Array<string>;
  missingNodes: Array<string>;
  mode: string | null;
  ok: boolean;
  purpose: string;
  requiredNodes: Array<string>;
};

/** 每种模式「能跑起来」的最小节点集合；缺任一个都在导入前报出来。 */
const REQUIRED_BY_MODE: Record<string, Array<string>> = {
  FLF2V: ["CLIPTextEncode", "KSampler", "LoadImage", "VAEDecode"],
  I2V: ["CLIPTextEncode", "KSampler", "LoadImage", "VAEDecode"],
  T2V: ["CLIPTextEncode", "EmptyLatentImage", "KSampler", "VAEDecode"],
};

const PURPOSE_BY_MODE: Record<string, string> = {
  FLF2V: "首尾帧续接：用上一镜尾帧与下一镜首帧生成过渡镜头",
  I2V: "图生视频：用定稿分镜图生成镜头片段",
  T2V: "文生视频：仅凭提示词生成镜头片段",
};

function detectMode(types: ReadonlySet<string>, root: Record<string, unknown>): string | null {
  const meta = asRecord(root.meta);
  const declared = typeof meta?.mode === "string" ? meta.mode.toUpperCase() : "";
  const explicit = ANIME_PACK_MODES.find((candidate) => candidate === declared);
  if (explicit !== undefined) {
    return explicit;
  }
  const joined = [...types].join(" ").toUpperCase();
  if (joined.includes("FLF2V") || joined.includes("FIRSTLASTFRAME")) {
    return "FLF2V";
  }
  if (joined.includes("I2V") || joined.includes("IMAGE2VIDEO")) {
    return "I2V";
  }
  if (joined.includes("T2V") || joined.includes("TEXT2VIDEO")) {
    return "T2V";
  }
  return null;
}

/**
 * 外来工作流 JSON → 导入前报告。节点表不是数组 / 根不是对象时按「无法判定」返回，
 * 不抛给调用方（扫描是只读的，坏文件不该让整批候选全挂）。
 */
export function analyzeAnimeWorkflowPack(raw: unknown): AnimePackAnalysis {
  const root = asRecord(raw) ?? {};
  const rawNodes = Array.isArray(root.nodes) ? root.nodes : [];
  const types = new Set<string>();
  const dependencies = new Set<string>();
  for (const item of rawNodes) {
    const node = asRecord(item);
    const type = node?.type;
    if (typeof type === "string" && type !== "") {
      types.add(type);
    }
    const inputs = asRecord(node?.inputs);
    if (inputs !== null) {
      for (const key of ["ckpt_name", "lora_name", "model_name", "unet_name"]) {
        const value = inputs[key];
        if (typeof value === "string" && value !== "") {
          dependencies.add(`${key}:${value}`);
        }
      }
    }
  }
  const mode = detectMode(types, root);
  const requiredNodes = mode === null ? [] : (REQUIRED_BY_MODE[mode] ?? []);
  const missingNodes = requiredNodes.filter((name) => !types.has(name));
  return {
    dependencies: [...dependencies].sort(),
    missingNodes,
    mode,
    ok: mode !== null && missingNodes.length === 0,
    purpose: mode === null ? "未识别出漫剧镜头模式" : (PURPOSE_BY_MODE[mode] ?? ""),
    requiredNodes,
  };
}
