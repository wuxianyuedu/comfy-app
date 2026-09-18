/**
 * 从 LLM 的回复里抽出一个 JSON 值 —— 回复可能被 Markdown 代码围栏包着，
 * 也可能前后夹着散文。兜底做法是扫描第一个 `[` 或 `{`，
 * 以及与之配对的最后一个 `]` 或 `}`。
 */
export function extractJson(text: string): unknown {
  let trimmed = (text ?? "").trim();

  if (!trimmed) throw new Error("LLM 返回为空");

  // 去掉 ```json ... ``` 这类代码围栏

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);

  if (fence) trimmed = fence[1]!.trim();

  const start = trimmed.search(/[[{]/);

  const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));

  if (start >= 0 && end > start) {
    trimmed = trimmed.slice(start, end + 1);
  }

  return JSON.parse(trimmed);
}

/* 与 extractJson 相同，但一定返回数组（否则抛错）。 */
export function extractJsonArray(text: string): unknown[] {
  const value = extractJson(text);

  if (!Array.isArray(value)) throw new Error("LLM 未返回数组");

  return value;
}
