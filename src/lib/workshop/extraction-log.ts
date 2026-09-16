// ── 工坊「模型提取」执行过程的结构化记录 ─────────────────────────
// 解决「角色卡/分镜用模型提取时完全黑盒」问题：把一次提取的
// 发起信息、模型输入、流式输出与最终结果逐条记录下来，
// 前端 ExtractToolbar 把日志渲染为可折叠面板，跑完也不清空。
// 纯类型 + 纯函数，无 React 依赖（对齐 lib/ 层约束）。
import type { LLMMessage } from "~/lib/llm/types";

/** 一次模型提取执行的执行阶段。 */
export type ExtractLogKind =
  | "init" // 提取已开始（记录通道 / 模型 / 目标）
  | "request" // 发给模型的输入消息（prompt）
  | "output" // 模型流式返回的原始输出
  | "result" // 解析成功，产出 N 条
  | "skipped" // 有重名等被跳过
  | "error"; // 执行失败 / 解析失败

export interface ExtractLogEntry {
  ts: string; // ISO 时间戳
  kind: ExtractLogKind;
  /** 人类可读的单行摘要（如「调用模型 remote::gpt-4o」）。 */
  summary: string;
  /** 需要多行展示的正文（输入消息 / 输出原文），可省略。 */
  detail?: string;
}

/** 空日志。 */
export function emptyExtractLog(): ExtractLogEntry[] {
  return [];
}

/** 时间戳（本地 ISO）。 */
export function nowTs(): string {
  return new Date().toISOString();
}

/** 构造一条日志（纯函数，方便在组件外断言）。 */
export function makeExtractLog(
  kind: ExtractLogKind,
  summary: string,
  detail?: string,
): ExtractLogEntry {
  return { ts: nowTs(), kind, summary, detail };
}

/** 请求消息 → 适合放进日志正文的多行文本（截断超长剧本，避免面板过载）。 */
export function formatRequestMessages(messages: LLMMessage[]): string {
  const MAX_USER_CHARS = 4000;
  return messages
    .map((m) => {
      const body =
        m.content.length > MAX_USER_CHARS
          ? `${m.content.slice(0, MAX_USER_CHARS)}…(已截断 ${m.content.length} 字)`
          : m.content;
      return `── ${m.role} ──\n${body}`;
    })
    .join("\n\n");
}
