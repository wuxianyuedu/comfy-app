/**
 * custom-nodes 路由的外部 JSON 窄化工具。
 *
 * manifest / report / python stdout 都是外部输入，统一 `unknown` 进、守卫窄化读；
 * 字段值通过对应类型谓词后才采用，否则回退到兜底值（不用类型断言）。
 * 单独成文件是为了让路由只留 handler 与编排逻辑、不超过单文件行数上限。
 */
import { isPlainRecord } from "~/lib/is-record";
import type { DiscoveredSubpkg, ParseReport } from "~/lib/comfyui/custom-nodes-stream";

export function isStringValue(v: unknown): v is string {
  return typeof v === "string";
}

export function isNumberValue(v: unknown): v is number {
  return typeof v === "number";
}

export function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

export function isStringArray(v: unknown): v is Array<string> {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

export function isUnknownArray(v: unknown): v is Array<unknown> {
  return Array.isArray(v);
}

export type ParseErrorEntry = { error: string; file: string };

export function isParseErrorEntry(v: unknown): v is ParseErrorEntry {
  return isPlainRecord(v) && typeof v.error === "string" && typeof v.file === "string";
}

export function isParseErrorArray(v: unknown): v is Array<ParseErrorEntry> {
  return Array.isArray(v) && v.every(isParseErrorEntry);
}

/* 解析器输出的单个子包：name 是界面必需的标识，其余字段来自不同版本解析器时可能缺省，
 * 只校验存在时的类型，不硬性要求齐全（视图侧对这些字段已有防御）。 */
export function isDiscoveredSubpkg(v: unknown): v is DiscoveredSubpkg {
  return (
    isPlainRecord(v) &&
    typeof v.name === "string" &&
    (v.path === undefined || typeof v.path === "string") &&
    (v.parent === undefined || typeof v.parent === "string") &&
    (v.exists === undefined || typeof v.exists === "boolean") &&
    (v.isLeaf === undefined || typeof v.isLeaf === "boolean") &&
    (v.fileCount === undefined || typeof v.fileCount === "number") &&
    (v.sizeBytes === undefined || typeof v.sizeBytes === "number") &&
    (v.contentHash === undefined || typeof v.contentHash === "string") &&
    (v.status === undefined || typeof v.status === "string") &&
    (v.packageFileCount === undefined || typeof v.packageFileCount === "number")
  );
}

/* 报告由 Python 侧写出，历史版本/子集模式字段并不齐全（甚至 packages 可以是字典），
 * 这里只确认它是对象、核心计数字段若存在则类型正确，其余保持原样透传。 */
export function isParseReport(v: unknown): v is ParseReport {
  return (
    isPlainRecord(v) &&
    (v.generatedAt === undefined || typeof v.generatedAt === "string") &&
    (v.errorCount === undefined || typeof v.errorCount === "number") &&
    (v.pathCount === undefined || typeof v.pathCount === "number") &&
    (v.totalNodes === undefined || typeof v.totalNodes === "number")
  );
}

export function readDiscoveredPackages(parsed: unknown): Array<DiscoveredSubpkg> {
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.packages)) {
    return [];
  }
  return parsed.packages.filter(isDiscoveredSubpkg);
}
