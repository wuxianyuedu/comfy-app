/**
 * Extract a JSON value from an LLM response that may be wrapped in markdown
 * code fences or contain surrounding prose. Falls back to scanning for the
 * first [ or { and the matching last ] or }.
 */
export function extractJson(text: string): unknown {
  let t = (text ?? "").trim();
  if (!t) throw new Error("LLM 返回为空");

  // Strip ```json ... ``` fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();

  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (start >= 0 && end > start) {
    t = t.slice(start, end + 1);
  }

  return JSON.parse(t);
}

/** Like extractJson but always returns an array (or throws). */
export function extractJsonArray(text: string): unknown[] {
  const v = extractJson(text);
  if (!Array.isArray(v)) throw new Error("LLM 未返回数组");
  return v;
}
