export type OutlineItem = {
  level: number;
  line: number;
  text: string;
};

/* ── Markdown 归一化(编辑器接收内容的入口)────────────────────────────
 * 针对导入剧本后的空行/换行异常: ① CRLF / 孤立 CR 统一为 LF; ② 去行尾空白,
 * 只含空白的行视为空行; ③ 连续 3+ 空行折叠为 1 个(1~2 个保持); ④ 标题/列表/
 * 引用/分隔线不改写; ⑤ 围栏代码块内部不做任何处理。 */
export function normalizeMarkdown(source: string): string {
  const lines = source.replaceAll(/\r\n?/g, "\n").split("\n");
  const result: Array<string> = [];
  let inFence = false;
  let fenceMarker = "";
  let index = 0;
  while (index < lines.length) {
    /* `at()` 越界即 `undefined`：取元素与循环判据合成一处，
     * 不必再靠 `!` 把索引签名加上的 `undefined` 抹掉。 */
    const raw = lines.at(index);
    if (raw === undefined) {
      break;
    }
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fenceMatch) {
      const markerStr = fenceMatch.at(1) ?? "";
      const marker = [...markerStr.trim()][0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker && raw.slice(markerStr.length).trim() === "") {
        inFence = false;
      }
      result.push(raw);
      index += 1;
      continue;
    }
    if (inFence) {
      result.push(raw);
      index += 1;
      continue;
    }
    const line = raw.replace(/[ \t]+$/u, "");
    if (line !== "") {
      result.push(line);
      index += 1;
      continue;
    }
    let blankRun = 0;
    while (index < lines.length) {
      const probe = lines.at(index);
      if (probe === undefined) {
        break;
      }
      if (probe.replace(/[ \t]+$/u, "") !== "") {
        break;
      }
      blankRun += 1;
      index += 1;
    }
    const kept = blankRun >= 3 ? 1 : blankRun;
    for (let i = 0; i < kept; i += 1) {
      result.push("");
    }
  }
  return result.join("\n");
}

export function buildOutline(value: string): Array<OutlineItem> {
  const items: Array<OutlineItem> = [];
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      items.push({
        level: (match.at(1) ?? "").length,
        text: (match.at(2) ?? "").trim(),
        line: index,
      });
    }
  });
  return items;
}

export function getLineStart(value: string, position: number): number {
  return value.lastIndexOf("\n", position - 1) + 1;
}

export function getLineEnd(value: string, position: number): number {
  const nextBreak = value.indexOf("\n", position);
  return nextBreak === -1 ? value.length : nextBreak;
}
