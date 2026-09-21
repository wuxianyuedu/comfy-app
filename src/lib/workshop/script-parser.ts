import type { Scene, ProjectMeta, ProjectType } from "./types";
import { nextId } from "~/lib/unique-id";

/* 场景 / 分镜 id 走全库唯一出口（规范 16 §16.2.4.36）—— 收口前这里是
 * 「时间戳 + 模块级计数器」，与另几处（日志 / 消息中心 / 画布节点）各写一份。 */
function uid(prefix = "id"): string {
  return nextId(`${prefix}_`);
}

/* 把自由发挥的想法 / 粘贴进来的文本转成结构化的场景列表。
 * 策略：
 *  - 输入看起来像一句话（没有空行、且少于 80 字）→ 结合项目基调，
 *    把它扩写成 3 个节拍的小结构场景。
 *  - 否则按空行 /「场景」标记切成多个场景。
 */
export function parseIdeaToScenes(
  raw: string,
  meta: Pick<ProjectMeta, "title" | "type" | "tone" | "logline">,
): Scene[] {
  const text = raw.trim();
  if (!text) return [];

  // 单句短想法 → 用简单的三幕模板扩写
  const hasStructure =
    /\n\s*\n/.test(text) || /场景\d|场\s*\d|SCENE/i.test(text);
  if (!hasStructure && text.length < 120) {
    return expandIdea(text, meta);
  }

  // 先按空行切；没有空行时回落到显式的场景标记
  let blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 1) {
    blocks = text
      .split(/(?=场景\s*\d+|场\s*\d+|SCENE\s*\d+)/i)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  return blocks.map((block, i) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const first = lines[0] ?? "";
    const isHeading = /^(场景|场|SCENE)\s*\d+/i.test(first);
    const heading = isHeading ? first : `场景${i + 1} · ${first.slice(0, 12)}`;
    const body = isHeading
      ? lines.slice(1).join("\n")
      : lines.slice(1).join("\n");
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

/* 依据项目基调，把一句 logline 扩写成 3 个节拍的场景。 */
function expandIdea(
  idea: string,
  meta: Pick<ProjectMeta, "title" | "type" | "tone" | "logline">,
): Scene[] {
  const tone = meta.tone || "温暖治愈";
  const type = meta.type || "short_video";
  const base = idea.replace(/[。.！!？?\s]+$/, "");

  const template: readonly Omit<Scene, "id">[] = [
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
  // 逐字段展开而不是 `{ id, ...t }` 一把梭：Scene 未来加字段时，这里少给一个
  // tsc 会立刻报缺属性——把「新字段是否需要在预制模板里给个默认」这道问题
  // 留在编译器手里，而不是等运行时用到才发现是 undefined。
  return template.map((t) => ({
    id: uid("scene"),
    heading: t.heading,
    location: t.location,
    time: t.time,
    action: t.action,
    dialogue: t.dialogue,
    shotCount: t.shotCount,
  }));
}

function extractMeta(text: string): { location: string; time: string } {
  const locMatch =
    /(咖啡馆|办公室|街道|房间|实验室|森林|海边|城市|学校|医院|城堡|太空|车内|室外|室内|山顶|车站)/.exec(
      text,
    );
  const timeMatch =
    /(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|黎明|白天|月夜)/.exec(text);
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

export function emptyProject(type: ProjectType = "short_video"): ProjectMeta {
  return { title: "未命名项目", type, tone: "", logline: "" };
}

export { uid as workshopUid };
