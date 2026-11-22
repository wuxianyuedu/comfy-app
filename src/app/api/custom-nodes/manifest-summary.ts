/**
 * /api/custom-nodes 的清单摘要读取（自 route.ts 拆出）：读整份 manifest、按
 * (size, mtime) 指纹短路缓存，并归一成前端消费的摘要形状。
 * 拆分原因：route.ts 超过文件长度硬闸（900 行）；这一层只做「读 + 归一」，
 * 与流式解析的编排无关（manifest 的**写入**仍在 route.ts 的解析链上）。
 */
import fs from "node:fs";

import {
  customNodesManifestPath,
  customNodesManifestStamp,
} from "~/lib/comfyui/custom-nodes-manifest.server";
import { isPlainRecord } from "~/lib/is-record";
import {
  isNumberValue,
  isParseErrorArray,
  isStringArray,
  isStringOrNull,
  isStringValue,
  isUnknownArray,
  type ParseErrorEntry,
} from "./parse-guards";

export const MANIFEST = customNodesManifestPath();

/** 等价原 `src?.[key] ?? fallback`:值通过类型谓词后才采用,否则走兜底。 */
function jsonField<T>(
  src: Record<string, unknown> | null | undefined,
  key: string,
  fallback: T,
  isT: (v: unknown) => v is T,
): T {
  const v: unknown = src?.[key];
  return isT(v) ? v : fallback;
}

/** manifest 里单个已解析包的摘要形状(与前端 SummaryPkg 消费契约一致)。 */
export type ManifestPackageSummary = {
  contentHash: string;
  errors: Array<unknown>;
  generatedAt: string | null;
  name: string;
  nodeCount: number;
  nodeTypes: Array<string>;
  parsedAt: string | null;
  parsedFileCount: number;
  path: string;
  status: string;
};

/* manifest 摘要的短路缓存：GET 每次都读 + 解析整份 manifest（自定义节点包一多
 * 就是几百 KB），而文件只在 parse / 流式解析收尾时被写 —— 按 (size, mtime) 指纹
 * 缓存，写入后指纹必变、缓存自然失效。 */
export type ManifestSummary = {
  generatedAt: string | null;
  missingPaths: Array<string>;
  packages: Array<ManifestPackageSummary>;
  parseErrors: Array<ParseErrorEntry>;
  sources: Array<string>;
  totalNodes: number;
};

let manifestSummaryCache: {
  stamp: string;
  summary: ManifestSummary | null;
} | null = null;

/** @returns {string | null} */
function manifestStamp() {
  return customNodesManifestStamp();
}

/* 汇总磁盘上的 manifest 供界面展示。同时对每个「配了、但还不是叶子包」的父路径
 * 输出探测到的子包，好让界面提示「这个目录下有 N 个子包，可以逐个解析」。
 */
export function readManifestSummary() {
  const stamp = manifestStamp();
  if (stamp !== null && stamp !== "" && manifestSummaryCache?.stamp === stamp) {
    return manifestSummaryCache.summary;
  }
  if (!fs.existsSync(MANIFEST)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    /* 清单体必须是「JSON 对象」，数组不算：`isRecord` 认数组，于是一份被写坏的清单
     * （`[]`）会被读成「解析过了，但一个节点都没有」—— 而界面把这两种当两件事：
     * 前者该提示「清单坏了」，后者是正常冷启动（台账 E9 记的就是这一族「不同因同形」）。
     * 标量 JSON 在原 `m.packages` 处会抛 TypeError → catch → null；守卫把该行为显式化。 */
    if (!isPlainRecord(parsed)) {
      return null;
    }
    const m = parsed;
    const pkgs: Array<ManifestPackageSummary> = [];
    const pmap: Record<string, unknown> = isPlainRecord(m.packages) ? m.packages : {};
    for (const [name, info] of Object.entries(pmap)) {
      const fields: Record<string, unknown> | undefined = isPlainRecord(info) ? info : undefined;
      pkgs.push({
        name,
        path: jsonField(fields, "path", "", isStringValue),
        nodeCount: jsonField(fields, "nodeCount", 0, isNumberValue),
        nodeTypes: jsonField<Array<string>>(fields, "nodeTypes", [], isStringArray),
        status: jsonField(fields, "status", "ok", isStringValue),
        errors: jsonField<Array<unknown>>(fields, "errors", [], isUnknownArray),
        contentHash: jsonField(fields, "contentHash", "", isStringValue),
        parsedAt: jsonField<string | null>(fields, "parsedAt", null, isStringOrNull),
        parsedFileCount: jsonField(fields, "parsedFileCount", 0, isNumberValue),
        generatedAt: jsonField<string | null>(m, "generatedAt", null, isStringOrNull),
      });
    }
    const sources: Array<string> = jsonField<Array<string>>(m, "sources", [], isStringArray);
    const nodes: unknown = m.nodes ?? null;
    const summary = {
      generatedAt: jsonField<string | null>(m, "generatedAt", null, isStringOrNull),
      totalNodes: isPlainRecord(nodes) ? Object.keys(nodes).length : 0,
      packages: pkgs,
      /* SAFETY: 类型断言已复核 */
      missingPaths: [] as Array<string>,
      parseErrors: jsonField<Array<ParseErrorEntry>>(m, "parseErrors", [], isParseErrorArray),
      sources,
    };
    // stat 失败（极罕见）时 stamp 为 null：返回结果但不缓存。
    if (stamp !== null) {
      manifestSummaryCache = { stamp, summary };
    }
    return summary;
  } catch {
    return null;
  }
}
