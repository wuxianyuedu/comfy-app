// ── 工坊 Agent 工具执行器（纯逻辑模块）────────────────────
// 把 Agent tool_call 映射成对工坊 controller 的实际操作。
// 本模块不直接持有 React state —— 所有数据读写经 handlers 回调完成。
import { asRecord, isRecord } from "~/lib/is-record";
import { extractJson, extractJsonArray } from "~/lib/llm/parse";
import type { WorkshopDraftDto } from "~/lib/workshop/draft-sync-shared";
import { normalizeShotType, type ShotType } from "~/lib/workshop/types";
import { SUMMARY_MAX, clampText } from "~/lib/text-clamp";

/** Agent 执行工具时需要调用的 controller 操作。 */
export interface AgentToolHandlers {
  getDraft: () => WorkshopDraftDto;
  getMeta: () => WorkshopDraftDto["meta"];
  setMeta: (patch: Partial<WorkshopDraftDto["meta"]>) => void;
  setScriptMarkdown: (markdown: string) => void;
  getScriptMarkdown: () => string;
  getCharacters: () => WorkshopDraftDto["characters"];
  setCharacters: (characters: WorkshopDraftDto["characters"]) => void;
  getShots: () => WorkshopDraftDto["shots"];
  setShots: (shots: WorkshopDraftDto["shots"]) => void;
  /** 用当前项目镜头一键成片（服务端逐镜视频 + 合成 + 回写进度）。缺省表示该上下文不支持。 */
  renderFilm?: () => Promise<{ ok: boolean; summary: string; detail?: string }>;
}

/** 一个待执行的工具（已解析出参数摘要）。 */
export interface ResolvedAgentTool {
  toolName: string;
  summary: string;
  argSummary: string;
  execute: () => Promise<{ ok: boolean; summary: string; detail?: string }>;
}

/** 安全解析 JSON 参数串为对象。 */
function safeParseJson(json: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(json)) ?? {};
  } catch {
    return {};
  }
}

/** 把未知参数串转成人类可读摘要。 */
function summarizeArgs(argsJson: string, maxLen = 200): string {
  try {
    const obj = JSON.parse(argsJson) as Record<string, unknown>;
    const keys = Object.entries(obj)
      .filter(
        ([, v]) =>
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean",
      )
      .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
      .join(", ");
    return keys.slice(0, maxLen) || "(空参数)";
  } catch {
    return argsJson.slice(0, maxLen) || "(空参数)";
  }
}

/** 从 LLM 输出文本中解析角色 JSON 数组（扫描走全库唯一的 `extractJsonArray`）。 */
function parseCharactersFromJson(text: string): Array<{
  name: string;
  appearance?: string;
  costume?: string;
  personality?: string;
}> {
  try {
    const arr = extractJsonArray(text);
    return arr
      .filter((item) => typeof item === "object" && item !== null)
      .map((item) => {
        const rec = item as Record<string, unknown>;
        return {
          name: typeof rec.name === "string" ? rec.name : "",
          appearance: typeof rec.appearance === "string" ? rec.appearance : "",
          costume: typeof rec.costume === "string" ? rec.costume : "",
          personality:
            typeof rec.personality === "string" ? rec.personality : "",
        };
      })
      .filter((c) => c.name.trim() !== "");
  } catch {
    return [];
  }
}

/** 从 LLM 输出文本中解析单个角色 JSON（扫描走全库唯一的 `extractJson`）。 */
function parseCharacterFull(
  text: string,
): { appearance: string; costume: string; personality: string } | null {
  try {
    const parsed: unknown = extractJson(text);
    if (!isRecord(parsed)) return null;
    const rec = parsed;
    return {
      appearance: typeof rec.appearance === "string" ? rec.appearance : "",
      costume: typeof rec.costume === "string" ? rec.costume : "",
      personality: typeof rec.personality === "string" ? rec.personality : "",
    };
  } catch {
    return null;
  }
}

/** 从 LLM 输出文本中解析分镜镜头 JSON 数组（扫描走全库唯一的 `extractJsonArray`）。
 *
 *  景别在这里就收进 `ShotType`（`normalizeShotType`）—— **解析边界**是唯一该做这件事
 *  的地方。它一度是 `shotType: string` 然后在下游写 `s.shotType as never`，
 *  于是「模型返回什么景别都直接进库」这件事在类型层完全看不见（台账 F13）。 */
function parseShotsFromJson(text: string): Array<{
  sceneHeading: string;
  description: string;
  shotType: ShotType;
  characterNames: string[];
}> {
  try {
    const arr = extractJsonArray(text);
    return arr
      .filter((item) => typeof item === "object" && item !== null)
      .map((item) => {
        const rec = item as Record<string, unknown>;
        return {
          sceneHeading:
            typeof rec.sceneHeading === "string"
              ? rec.sceneHeading
              : typeof rec.heading === "string"
                ? rec.heading
                : "",
          description:
            typeof rec.description === "string" ? rec.description : "",
          shotType: normalizeShotType(rec.shotType),
          characterNames: Array.isArray(rec.characterNames)
            ? (rec.characterNames as unknown[]).map(String)
            : [],
        };
      })
      .filter(
        (s) => s.sceneHeading.trim() !== "" || s.description.trim() !== "",
      );
  } catch {
    return [];
  }
}

/** 把 agent tool_call 解析成可执行的工具闭包。 */
export function resolveAgentTool(
  name: string,
  argsJson: string,
  handlers: AgentToolHandlers,
): ResolvedAgentTool {
  const argSummary = summarizeArgs(argsJson);
  const hd = handlers;

  switch (name) {
    case "get_project_state": {
      const draft = hd.getDraft();
      return {
        toolName: name,
        summary: "查看项目当前状态",
        argSummary,
        execute: async () => ({
          ok: true,
          summary: `项目「${draft.meta.title}」：剧本${draft.scriptMarkdown ? "已就绪" : "待生成"}，角色卡 ${draft.characters.length} 个，镜头 ${draft.shots.length} 个（图 ${draft.shots.filter((s) => !!s.imageUrl).length} / 视频 ${draft.shots.filter((s) => !!s.clipUrl).length}）。`,
          detail: JSON.stringify({
            meta: draft.meta,
            hasScript: !!draft.scriptMarkdown,
            characterCount: draft.characters.length,
            shotCount: draft.shots.length,
            imageDone: draft.shots.filter((s) => !!s.imageUrl).length,
            clipDone: draft.shots.filter((s) => !!s.clipUrl).length,
          }),
        }),
      };
    }

    case "set_project_meta": {
      const args = safeParseJson(argsJson);
      const patch: Partial<WorkshopDraftDto["meta"]> = {};
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.tone === "string") patch.tone = args.tone;
      if (typeof args.logline === "string") patch.logline = args.logline;
      if (typeof args.type === "string") {
        const valid = [
          "short_video",
          "micro_film",
          "animation",
          "ad",
          "comic",
          "other",
        ];
        if (valid.includes(args.type)) {
          patch.type = args.type as WorkshopDraftDto["meta"]["type"];
        }
      }
      const keys = Object.keys(patch).join("、") || "(无字段)";
      return {
        toolName: name,
        summary: `更新项目元信息：${argSummary}`,
        argSummary,
        execute: async () => {
          hd.setMeta(patch);
          return { ok: true, summary: `已更新项目信息（${keys}）` };
        },
      };
    }

    case "generate_script": {
      const args = safeParseJson(argsJson);
      // 非字符串参数只接受标量，对象走 toString 只会得到 "[object Object]"
      const rawIdea: unknown = args.idea;
      const idea =
        typeof rawIdea === "string" ||
        typeof rawIdea === "number" ||
        typeof rawIdea === "boolean"
          ? String(rawIdea)
          : "";
      return {
        toolName: name,
        summary: `生成剧本（创意：${clampText(idea, { maxLength: SUMMARY_MAX })}）`,
        argSummary,
        execute: async () => {
          const meta = hd.getMeta();
          const { buildScriptMarkdownMessages } =
            await import("~/lib/llm/prompts");
          const { streamChat } = await import("~/lib/llm/browser");
          let full = "";
          await streamChat({
            messages: buildScriptMarkdownMessages(meta, idea),
            onToken: (token: string) => {
              full += token;
            },
          });
          const markdown = full.trim();
          if (!markdown) {
            return { ok: false, summary: "模型未返回剧本内容" };
          }
          hd.setScriptMarkdown(markdown);
          return {
            ok: true,
            summary: `已生成剧本（${markdown.length} 字符）`,
          };
        },
      };
    }

    case "edit_script": {
      const args = safeParseJson(argsJson);
      const instruction =
        typeof args.instruction === "string" ? args.instruction : "";
      const currentScript = hd.getScriptMarkdown();
      return {
        toolName: name,
        summary: `修改剧本：${clampText(instruction, { maxLength: SUMMARY_MAX })}`,
        argSummary,
        execute: async () => {
          if (!currentScript.trim()) {
            return { ok: false, summary: "当前剧本为空，请先生成剧本" };
          }
          const { streamChat } = await import("~/lib/llm/browser");
          const full = await streamChat({
            messages: [
              {
                role: "system",
                content: `你是专业影视编剧。用户有已写好的剧本，需要你根据要求修改并输出完整修改后的剧本 Markdown。
要求：直接输出修改后的完整剧本全文（含所有场景），不要解释或前言。
现有剧本：
${currentScript.slice(0, 8000)}`,
              },
              { role: "user", content: instruction },
            ],
          });
          const markdown = full.trim();
          if (!markdown) {
            return { ok: false, summary: "模型未返回修改后剧本" };
          }
          hd.setScriptMarkdown(markdown);
          return {
            ok: true,
            summary: `已更新剧本（${markdown.length} 字符）`,
          };
        },
      };
    }

    case "extract_characters": {
      return {
        toolName: name,
        summary: "从剧本提取角色",
        argSummary,
        execute: async () => {
          const script = hd.getScriptMarkdown();
          if (!script.trim()) {
            return { ok: false, summary: "当前无剧本内容，请先生成剧本" };
          }
          const { streamChat } = await import("~/lib/llm/browser");
          const full = await streamChat({
            messages: [
              {
                role: "system",
                content: `从下面的剧本中提取所有主要角色，输出严格 JSON 数组，不要多余文字。
每个元素格式：
{"name": "角色名", "appearance": "外貌特征", "costume": "服装", "personality": "性格关键词"}

剧本：
${script.slice(0, 8000)}`,
              },
              { role: "user", content: "提取角色" },
            ],
          });
          const chars = parseCharactersFromJson(full);
          if (chars.length === 0) {
            return { ok: false, summary: "未能从剧本中解析出角色" };
          }
          const existing = hd.getCharacters();
          const names = new Set(existing.map((c) => c.name));
          const newOnes = chars.filter((c) => !names.has(c.name));
          // 模型只给名字/外貌等文本字段，补齐 Character 的其余必填字段
          // （与 add_character 一致），否则写进 draft 的是残缺角色卡。
          const { workshopUid } = await import("~/lib/workshop/script-parser");
          const created = newOnes.map((c) => ({
            id: workshopUid("char"),
            name: c.name,
            ageGender: "",
            appearance: c.appearance ?? "",
            costume: c.costume ?? "",
            personality: c.personality ?? "",
            temperament: "",
            styleTags: [],
            positivePrompt: "",
            negativePrompt: "",
            params: {},
          }));
          hd.setCharacters([...existing, ...created]);
          return {
            ok: true,
            summary: `已提取 ${created.length} 个角色（当前共 ${existing.length + created.length} 个）`,
          };
        },
      };
    }

    case "add_character": {
      const args = safeParseJson(argsJson);
      const charName = typeof args.name === "string" ? args.name : "";
      const desc = typeof args.description === "string" ? args.description : "";
      return {
        toolName: name,
        summary: `添加角色「${charName}」`,
        argSummary,
        execute: async () => {
          if (!charName.trim()) return { ok: false, summary: "角色名为空" };
          const existing = hd.getCharacters();
          if (existing.some((c) => c.name === charName)) {
            return { ok: false, summary: `角色「${charName}」已存在` };
          }
          const { buildCharacterFromBriefMessages } =
            await import("~/lib/llm/prompts");
          const { streamChat } = await import("~/lib/llm/browser");
          const full = await streamChat({
            messages: buildCharacterFromBriefMessages(
              desc ? `${charName}：${desc}` : charName,
            ),
          });
          const parsed = parseCharacterFull(full);
          const { workshopUid } = await import("~/lib/workshop/script-parser");
          const character = {
            id: workshopUid("char"),
            name: charName,
            ageGender: "",
            appearance: parsed?.appearance ?? "",
            costume: parsed?.costume ?? "",
            personality: parsed?.personality ?? "",
            temperament: "",
            styleTags: [],
            positivePrompt: "",
            negativePrompt: "",
            params: {},
          };
          hd.setCharacters([...existing, character]);
          return { ok: true, summary: `已添加角色「${charName}」` };
        },
      };
    }

    case "plan_storyboard": {
      return {
        toolName: name,
        summary: "规划分镜",
        argSummary,
        execute: async () => {
          const script = hd.getScriptMarkdown();
          const chars = hd.getCharacters();
          if (!script.trim()) {
            return { ok: false, summary: "当前无剧本内容，请先生成剧本" };
          }
          const { streamChat } = await import("~/lib/llm/browser");
          const full = await streamChat({
            messages: [
              {
                role: "system",
                content: `你是分镜师。根据剧本生成分镜镜头序列，输出严格 JSON 数组，不要多余文字。
每个元素：
{"sceneHeading": "场景标题", "description": "画面描述", "shotType": "wide/medium/close 等", "characterNames": ["角色名"]}

剧本：
${script.slice(0, 6000)}

可用角色：
${chars.map((c) => c.name).join("、") || "(无)"}`,
              },
              { role: "user", content: "生成分镜" },
            ],
          });
          const shots = parseShotsFromJson(full);
          if (shots.length === 0) {
            return { ok: false, summary: "未能解析出分镜镜头" };
          }
          const existing = hd.getShots();
          const { workshopUid } = await import("~/lib/workshop/script-parser");
          const mapped = shots.map((s) => ({
            id: workshopUid("shot"),
            index: 0,
            sceneId: "",
            sceneHeading: s.sceneHeading,
            shotType: s.shotType,
            description: s.description,
            characterIds: [],
            prompt: s.description,
            negativePrompt: "",
            params: {},
            status: "idle" as const,
          }));
          hd.setShots([...existing, ...mapped]);
          return { ok: true, summary: `已生成 ${mapped.length} 个分镜镜头` };
        },
      };
    }

    case "generate_shot_images": {
      return {
        toolName: name,
        summary: "生成镜头图片",
        argSummary,
        execute: async () => ({
          ok: false,
          summary: "生图需在「镜头生图」页手动触发",
          detail: "Agent MVP 暂不直接触发 ComfyUI 生图，请使用页面上的生图按钮",
        }),
      };
    }

    case "render_film": {
      return {
        toolName: name,
        summary: "用项目镜头一键成片（逐镜视频 + 合成）",
        argSummary,
        execute: async () => {
          if (!hd.renderFilm) {
            return {
              ok: false,
              summary: "当前上下文不支持一键成片，请在「成片工作室」手动导出",
            };
          }
          const r = await hd.renderFilm();
          return { ok: r.ok, summary: r.summary, detail: r.detail };
        },
      };
    }

    default:
      return {
        toolName: name,
        summary: `未知工具：${name}`,
        argSummary,
        execute: async () => ({
          ok: false,
          summary: `未知工具「${name}」`,
        }),
      };
  }
}
