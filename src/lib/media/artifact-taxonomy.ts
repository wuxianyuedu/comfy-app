/**
 * `artifact-taxonomy.ts` — 产物目录三级分类的取值（纯函数，浏览器与 Node 共用）。
 *
 * 目录**形状**由 `./output-layout.ts` 定义（媒体类型 / 模型名 / 模式码 / taskId），
 * 这里只回答「每一级取什么值」，并把它收口成一次安全化：目录名里不能出现路径
 * 分隔符与 Windows 保留字符，模型名来自工作流标签（可能带空格或中文），必须
 * 先归一成合法段，否则写侧与读侧会落在不同文件上。
 *
 * 三个维度都从库里已有的事实派生，不新增用户输入：媒体类型取产物首项，
 * 模型名取工作流模型标签（没挂标签回落工作流名），模式码取任务类型。
 *
 * @module media/artifact-taxonomy
 */

export type ArtifactTaxonomy = {
  /** 产物首项的类型：image / video / audio / text / other。 */
  mediaType: string;
  /** 任务类型码（T2I / I2I / …）。 */
  modeCode: string;
  /** 工作流模型标签名；没挂标签时回落工作流名。 */
  modelName: string;
};

export const MEDIA_TYPE_FALLBACK = "image";
export const MODEL_NAME_FALLBACK = "unknown";
export const MODE_CODE_FALLBACK = "UNKNOWN";

/**
 * 把任意外来字符串收成合法的目录段：丢掉路径分隔符、Windows 保留字符、空白，
 * 连续的非法字符合成一个下划线。中文 / 字母 / 数字 / `.` `_` `-` 保留。
 * 空串或全被吃掉时用 `fallback`，避免落空段导致目录层级塌陷。
 */
export function safeDirSegment(value: string | null | undefined, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    return fallback;
  }
  const cleaned = raw
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "_")
    .replaceAll(/^\.+|\.+$/g, "")
    .replaceAll(/^_+|_+$/g, "");
  return cleaned === "" ? fallback : cleaned;
}

/** 从现成元数据派生三级分类。参数全部可空——写侧与迁移脚本拿到的行不一定齐全。 */
export function taxonomyFrom(input: {
  mediaType?: string | null;
  modeCode?: string | null;
  modelName?: string | null;
  taskType?: string | null;
  workflowName?: string | null;
}): ArtifactTaxonomy {
  return {
    mediaType: safeDirSegment(input.mediaType, MEDIA_TYPE_FALLBACK),
    modeCode: safeDirSegment(input.modeCode ?? input.taskType, MODE_CODE_FALLBACK),
    modelName: safeDirSegment(input.modelName ?? input.workflowName, MODEL_NAME_FALLBACK),
  };
}
