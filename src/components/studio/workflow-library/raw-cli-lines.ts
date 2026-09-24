/**
 * raw-cli-lines — 「comfy-cli 完整输出」弹窗的逐行解析与比较（纯逻辑，无 React、无 DOM）。
 *
 * 弹窗在运行期每 1.5s 重新拉取整份输出，而相邻两轮之间绝大多数行**逐字未变**。
 * 若每轮都 `lines.map(解析)` 再 `setLines(新数组)`，代价是：整份输出重新
 * JSON.parse 一遍，且每个 JsonViewer 都因为「对象换了身份」把整棵树重建一遍 ——
 * 这是该界面卡顿的主因之一（另一个是首屏全量展开，见 `ui/json-viewer` 里
 * `collapsed` 那段注释）。
 *
 * 于是把「行 → 解析结果」与「两轮内容是否相同」收在这里：
 *   - {@link parseRawCliLine} 带缓存，**同一行返回同一个对象**。身份稳定是下游
 *     `memo` 生效的前提：身份一变，React 就认为这行换了、整棵树重建。
 *   - {@link sameRawCliLines} 逐字比较，内容没变时连 setState 都不发。
 *
 * 判据（前缀 / 首字符 / JSON.parse）复用 `~/lib/log/log-cli-json` 的唯一口径，
 * 与日志面板折叠同一条原文行用的是同一份实现，两处不会分叉。
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
  if (hit) return hit;
  const parsed = parseUncached(line);
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(line, parsed);
  return parsed;
}

function parseUncached(line: string): ParsedCliLine {
  const json = parseCliJsonLine(line);
  if (json) return { kind: "json", tag: json.tag, value: json.value };
  const split = splitCliLogLine(line);
  if (!split) return { kind: "text", tag: "", text: line };
  return { kind: "text", tag: split.tag, text: split.payload };
}

/**
 * 两轮输出是否逐字相同。运行期轮询多数轮次没有新行，比对比「重新解析 + 重建
 * 整棵树」便宜几个数量级；返回 true 时调用处原样保留旧数组。
 */
export function sameRawCliLines(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
