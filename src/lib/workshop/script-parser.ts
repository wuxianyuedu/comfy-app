import type { Scene, ProjectMeta, ProjectType } from "./types";

let _id = 0;
function uid(prefix = "id"): string {
  _id += 1;
  return `${prefix}_${Date.now().toString(36)}_${_id}`;
}

/**
 * Convert a free-form idea / pasted text into a structured scene list.
 * Strategy:
 *  - If input looks like a single sentence (no blank lines, < 80 chars),
 *    expand it into a 3-beat mini structured scene using the project tone.
 *  - Otherwise split on blank lines / "场景" markers into separate scenes.
 */
export function parseIdeaToScenes(
  raw: string,
  meta: Pick<ProjectMeta, "title" | "type" | "tone" | "logline">
): Scene[] {
  const text = raw.trim();
  if (!text) return [];

  // Single short idea → expand with a simple 3-act template
  const hasStructure = /\n\s*\n/.test(text) || /场景\d|场\s*\d|SCENE/i.test(text);
  if (!hasStructure && text.length < 120) {
    return expandIdea(text, meta);
  }

  // Split by blank lines first, fall back to explicit scene markers
  let blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 1) {
    blocks = text
      .split(/(?=场景\s*\d+|场\s*\d+|SCENE\s*\d+)/i)
      .map((b) => b.trim())
      .filter(Boolean);
  }

  return blocks.map((block, i) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? "";
    const isHeading = /^(场景|场|SCENE)\s*\d+/i.test(first);
    const heading = isHeading ? first : `场景${i + 1} · ${first.slice(0, 12)}`;
    const body = isHeading ? lines.slice(1).join("\n") : lines.slice(1).join("\n");
    const { location, time } = extractMeta(first + " " + body);
    return {
      id: uid("scene"),
      heading,
      location,
      time,
      action: body || first,
      dialogue: "",
      shotCount: estimateShots(body || first),
    };
  });
}

/** Expand a single logline into a 3-beat scene using project tone */
function expandIdea(
  idea: string,
  meta: Pick<ProjectMeta, "title" | "type" | "tone" | "logline">
): Scene[] {
  const tone = meta.tone || "温暖治愈";
  const type = meta.type || "short_video";
  const base = idea.replace(/[。.！!？?\s]+$/, "");

  const template: Array<Partial<Scene> & { action: string; dialogue: string }> = [
    {
      heading: "场景1 · 开端",
      location: "室内",
      time: "白天",
      action: `镜头缓缓推进，${base}。环境氛围${tone}，用光影交代人物处境。`,
      dialogue: `（旁白）故事，从这一刻开始。`,
      shotCount: 2,
    },
    {
      heading: "场景2 · 发展",
      location: "室外",
      time: "黄昏",
      action: `冲突浮现，${base}的转折点在${tone}的基调中展开，人物做出关键选择。`,
      dialogue: `（对白）你确定要这么做吗？`,
      shotCount: 3,
    },
    {
      heading: "场景3 · 高潮/结尾",
      location: "室内",
      time: "夜晚",
      action: `情绪到达顶点，${base}迎来收束，留下余韵。`,
      dialogue: `（旁白）有些故事，注定被记住。`,
      shotCount: 2,
    },
  ];

  void type;
  return template.map((s) => ({
    id: uid("scene"),
    heading: s.heading!,
    location: s.location!,
    time: s.time!,
    action: s.action,
    dialogue: s.dialogue,
    shotCount: s.shotCount!,
  }));
}

function extractMeta(text: string): { location: string; time: string } {
  const locMatch = text.match(/(咖啡馆|办公室|街道|房间|实验室|森林|海边|城市|学校|医院|城堡|太空|车内|室外|室内|山顶|车站)/);
  const timeMatch = text.match(/(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|黎明|白天|月夜)/);
  return {
    location: locMatch ? locMatch[1]! : "未指定",
    time: timeMatch ? timeMatch[1]! : "未指定",
  };
}

function estimateShots(text: string): number {
  const len = text.length;
  if (len < 40) return 1;
  if (len < 100) return 2;
  if (len < 200) return 3;
  return 4;
}

export function newScene(index: number): Scene {
  return {
    id: uid("scene"),
    heading: `场景${index} · 新场景`,
    location: "",
    time: "",
    action: "",
    dialogue: "",
    shotCount: 2,
  };
}

export function emptyProject(type: ProjectType = "short_video"): ProjectMeta {
  return { title: "未命名项目", type, tone: "", logline: "" };
}

export { uid as workshopUid };
