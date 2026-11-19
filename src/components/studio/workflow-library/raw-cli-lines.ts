/**
 * raw-cli-lines — 「comfy-cli 完整输出」弹窗的逐行解析与比较（纯逻辑）。弹窗每 1.5s
 * 重拉整份输出，多数行未变；`parseRawCliLine` 带缓存（同一行同一对象，身份稳定是
 * 下游 memo 的前提），`sameRawCliLines` 逐字比较，未变时不发 setState。判据复用`~/lib/log/log-cli-json` 的唯一口径，与日志面板折叠同一份实现。
 */
import { parseCliJsonLine, splitCliLogLine } from "~/lib/log/log-cli-json";

/** 一行原文的解析结果：JSON 载荷（进 JsonViewer）或原文（进 `<pre>`）。 */
export type ParsedCliLine =
  | { kind: "json"; tag: string; value: unknown }
  | { kind: "text"; tag: string; text: string };

/* 解析缓存。上限与服务端缓冲的 `RAW_CLI_MAX_LINES`（5000 行）同量级：一轮完整
   输出都装得下。溢出时整体清空 —— 行是不可变的，清空只会让下一轮多解析一遍，
   而轮询很快会把它填回来，不做逐条淘汰。 */
const CACHE_MAX = 5000;
const CACHE = new Map<string, ParsedCliLine>();

/**
 * 把一行拆成「JSON 载荷」或「原文」。同一行重复调用返回**同一个对象**
 * （同一个引用），供下游按身份跳过渲染。
 */
export function parseRawCliLine(line: string): ParsedCliLine {
  const hit = CACHE.get(line);
  if (hit) {
    return hit;
  }
  const parsed = parseUncached(line);
  if (CACHE.size >= CACHE_MAX) {
    CACHE.clear();
  }
  CACHE.set(line, parsed);
  return parsed;
}

function parseUncached(line: string): ParsedCliLine {
  const json = parseCliJsonLine(line);
  if (json) {
    return { kind: "json", tag: json.tag, value: json.value };
  }
  const split = splitCliLogLine(line);
  if (!split) {
    return { kind: "text", tag: "", text: line };
  }
  return { kind: "text", tag: split.tag, text: split.payload };
}

/**
 * 两轮输出是否逐字相同。运行期轮询多数轮次没有新行，比对比「重新解析 + 重建
 * 整棵树」便宜几个数量级；返回 true 时调用处原样保留旧数组。
 */
export function sameRawCliLines(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
