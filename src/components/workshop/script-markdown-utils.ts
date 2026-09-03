export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

/* ── Markdown 归一化(编辑器接收内容的入口)────────────────────────────
 * 针对导入 markdown 剧本后常见的空行/换行异常:
 * 1. CRLF / 孤立 CR 统一为 LF;
 * 2. 去除每行行尾空白(空格/制表符),只含空白的行视为空行;
 * 3. 连续 3 个及以上空行折叠为 1 个空行(1~2 个空行保持原样);
 * 4. 标题 / 列表 / 引用 / 分隔线等行的内容不做改写,其余内容原样保留;
 * 5. 围栏代码块(``` 或 ~~~)内部不做任何处理,避免破坏代码内容。 */
export function normalizeMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const result: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index]!;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1]!.charAt(0);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (
        marker === fenceMarker &&
        raw.slice(fenceMatch[1]!.length).trim() === ""
      ) {
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
    while (
      index < lines.length &&
      lines[index]!.replace(/[ \t]+$/u, "") === ""
    ) {
      blankRun += 1;
      index += 1;
    }
    const kept = blankRun >= 3 ? 1 : blankRun;
    for (let i = 0; i < kept; i += 1) result.push("");
  }
  return result.join("\n");
}

export function buildOutline(value: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = value.split("\n");
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      items.push({
        level: match[1]!.length,
        text: match[2]!.trim(),
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
