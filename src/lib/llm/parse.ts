/**
 * Extract a JSON value from an LLM response that may be wrapped in markdown
 * code fences or contain surrounding prose. Falls back to scanning for the
 * first [ or { and the matching last ] or }.
 */
export function extractJson(text: string): unknown {

  let trimmed = (text ?? "").trim();

  if (!trimmed) throw new Error("LLM 返回为空");



  // Strip ```json ... ``` fences

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);

  if (fence) trimmed = fence[1]!.trim();



  const start = trimmed.search(/[[{]/);

  const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));

  if (start >= 0 && end > start) {

    trimmed = trimmed.slice(start, end + 1);

  }



  return JSON.parse(trimmed);

}


/** Like extractJson but always returns an array (or throws). */
export function extractJsonArray(text: string): unknown[] {

  const value = extractJson(text);

  if (!Array.isArray(value)) throw new Error("LLM 未返回数组");

  return value;

}

