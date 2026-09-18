// 共享的、客户端安全的校验错误类型与助手。
//
// ComfyUI 的 /prompt 接口在工作流服务端校验失败时，返回的载荷大致长这样
//（下面是原始英文回执的示例，字段名与文案就是服务端给的原样）：
//
//   {
//     // 汇总：共有 6 处校验错误
//     "error": "Workflow has 6 validation error(s) against server",  // 汇总计数
//     "node_errors": {
//       "10": {
//         "class_type": "KSampler",  // 出错节点的类型
//         "input_errors": {
//           "cfg": { "message": "cfg must be a number" },  // 该字段的报错
//           "steps": { "details": "..." }
//         }
//       },
//       "12": { "class_type": "CheckpointLoader", "message": "..." }  // 另一个节点
//     }
//   }
//
// 我们把 `node_errors` 摊平成 `ValidationError[]`，让界面能渲染出
//「精确到字段、本地化」的列表（形如「节点 10 (KSampler) · 字段 cfg：…」），
// 而不是把服务端那句英文摘要直接倒给用户。本模块**只有**类型与一个纯解析器
// —— 不 import prisma / fs / server-only —— 因此执行器（服务端）与 React
// 组件（客户端）都能安全导入。

import { z } from "zod";

/* validationErrors 经 Prisma Json 列往返（服务端写入 → 客户端读取），
 * 所以读取侧**必须**重新校验：Json 列在类型上是 `unknown`，直接
 * `as ValidationError[]` 是假保险——列里存了别的东西（旧版本格式、被手改、
 * 写入 bug）时下游会以「看起来是数组、元素却缺字段」的形态炸在渲染里。
 * 这里给出契约 schema，供读取侧收口（写作侧已由 ValidationError 类型约束）。 */
const validationErrorSchema = z.object({
  nodeId: z.string(),
  classType: z.string(),
  field: z.string(),
  message: z.string(),
});

/** 校验并收窄 Prisma Json 列里的 validationErrors；不合法返回 undefined。 */
export function parseValidationErrorsJson(
  raw: unknown,
): ValidationError[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ValidationError[] = [];
  for (const item of raw) {
    const parsed = validationErrorSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.length ? out : undefined;
}

export interface ValidationError {
  /** ComfyUI 的节点 id，字符串形式（与图的键一致）。 */
  nodeId: string;
  /** 节点 class_type，例如 "KSampler"；未知时为空串。 */
  classType: string;
  /** 出错的输入字段名；节点级（非输入）错误时为空串。 */
  field: string;
  /** Human-readable reason. Never empty — falls back to "配置错误". */
  message: string;
}

/** 把 ComfyUI 的 `node_errors` 摊平成 `ValidationError[]`。
 *  没有可结构化报告的内容时返回 `[]`。
 *
 *  这里要接受**两种**承载形状，因为上游 `/prompt` 响应与 comfy-cli 的信封
 *  在 `node_errors` 的序列化方式上不一致：
 *
 *    • 字典形 —— ComfyUI 原生 `/prompt` 的错误体，以及 comfy-cli 原样转发
 *      该错误体时的 `error.node_errors`，形如：
 *        { "10": { "class_type": "KSampler", "input_errors": {...} } }  // 键是节点 id
 *    • 列表形 —— comfy-cli 的 `_node_errors_to_list()` 会在进入信封的
 *      `error.details.node_errors` **之前**，把字典摊平成一串自包含记录：
 *        [ { "node_id": "10", "class_type": "KSampler",  // 每条自带节点 id
 *            "input_errors": {...} } ]
 *
 *  `res` 既可能是承载者自身（一个列表），也可能是**含有** `node_errors`
 *  （字典或列表）的对象。此前的实现只处理了「对象里放字典」这一种，
 *  于是「信封里放列表」那种形状会返回 `[]`，那 6 条按字段的错误就永远渲染不出来。 */
export function extractValidationErrors(
  res: unknown,
  graph?: Record<string, unknown>,
): ValidationError[] {
  // 外部输入一律 unknown + 收窄：res 可能是 carrier 对象 / 列表 / 任意 JSON。
  const resObj =
    typeof res === "object" && res !== null
      ? (res as Record<string, unknown>)
      : undefined;
  let ne: unknown = resObj?.node_errors;
  // `res` 本身就是列表承载者（comfy-cli 信封这条路径）。
  const isListCarrier =
    Array.isArray(res) &&
    res.length > 0 &&
    res.some((r: unknown): boolean => {
      if (!r || typeof r !== "object") return false;
      const rec = r as Record<string, unknown>;
      // 这几个字段可能是空字符串，必须用 `||` 判空（`??` 只挡 null/undefined）；
      // eslint 的 prefer-nullish-coalescing 在这里给的是误报，故就地豁免。
      return (
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        !!(rec.node_id || rec.class_type || rec.input_errors || rec.message)
      );
    });
  if (
    (!ne ||
      (Array.isArray(ne) ? ne.length === 0 : Object.keys(ne).length === 0)) &&
    isListCarrier
  ) {
    ne = res;
  }
  if (!ne) return [];
  const out: ValidationError[] = [];
  const entries: [string, unknown][] = Array.isArray(ne)
    ? ne.map((item: unknown) => {
        const rec = item as Record<string, unknown> | null | undefined;
        // String(x) 的收窄等价（见本文件底部 toStringValue）：值来自外部 JSON。
        return [toStringValue(rec?.node_id ?? "?"), item] as [string, unknown];
      })
    : Object.entries(ne as Record<string, unknown>);
  for (const [nid, err] of entries) {
    const errRec = err as Record<string, unknown> | null | undefined;
    const graphNode = graph?.[nid];
    const graphClass =
      typeof graphNode === "object" && graphNode !== null
        ? (graphNode as Record<string, unknown>).class_type
        : undefined;
    const errClass = errRec?.class_type;
    const classType: string =
      (typeof errClass === "string" ? errClass : undefined) ??
      (typeof graphClass === "string" ? graphClass : undefined) ??
      "";
    const inputErrors = errRec?.input_errors;
    if (inputErrors && typeof inputErrors === "object") {
      for (const [field, v] of Object.entries(
        inputErrors as Record<string, unknown>,
      )) {
        const message =
          typeof v === "string"
            ? v
            : ((v as { message?: string })?.message ??
                (v as { details?: string })?.details ??
                JSON.stringify(v)) ||
              "配置错误";
        out.push({ nodeId: nid, classType, field, message });
      }
    } else if (typeof errRec?.message === "string") {
      out.push({ nodeId: nid, classType, field: "", message: errRec.message });
    } else if (typeof err === "string") {
      out.push({ nodeId: nid, classType, field: "", message: err });
    } else if (err && typeof err === "object") {
      // 未知的结构化形状 —— 尽力序列化出来，绝不把信息丢掉。
      out.push({
        nodeId: nid,
        classType,
        field: "",
        message: JSON.stringify(err),
      });
    }
  }
  return out;
}

/* 把数据库 `validationErrors` 列（`ValidationError[]` 的 JSON 字符串，或 null）
 * 解析回类型化数组。做防御：载荷损坏或不是数组时返回 `null`，
 * 调用方据此回落到 `error` 字符串。 */
export function parseValidationErrors(
  raw: string | null | undefined,
): ValidationError[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as ValidationError[];
  } catch {
    /* fall through */
  }
  return null;
}

/** `String(v)` 的类型收窄等价（本模块保持 client-safe，不引入 comfyui/raw 依赖；
 *  与 raw.ts 导出的同名 helper 行为一致）：值全部来自 JSON 反序列化产物（无
 *  symbol / 自定义 toString），运行时行为与 String(v) 完全一致 —— 对象走其
 *  toString（普通对象即 "[object Object]"）。显式收窄只为满足
 *  no-base-to-string（该规则把 String(unknown/{}) 一律视为误报）。 */
function toStringValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return (v as { toString(): string }).toString();
}
