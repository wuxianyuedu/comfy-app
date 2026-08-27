// Agentic creation helper — multi-turn natural-language guidance that turns a
// vague idea into a structured generation spec. Uses the local/remote LLM when
// configured, otherwise falls back to a scripted offline state machine so the
// multi-turn flow always works.

export interface AgentSpec {
  prompt: string;
  negative?: string;
  params?: AgentParams;
  skillHint?: string;
  kind?: "image" | "video";
}

export type AgentParams = {
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  size?: string;
};

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentTurnResult {
  /** Assistant's natural-language reply (a question or a confirmation). */
  reply: string;
  /** Present + true when the spec is final and ready to generate. */
  ready: boolean;
  /** Final structured spec (only when ready). */
  spec?: AgentSpec;
}

const MULTITURN_SYSTEM = `你是一个 AI 创作引导助手，帮助用户用 ComfyUI 生成图片或视频。
通过简短的多轮对话帮用户理清需求，每轮最多问 1-2 个最关键的澄清问题，不要一次问太多。
需要澄清的维度：类型（图片/视频）、主题与画面描述、风格、关键参数（图片→尺寸比例；视频→时长/帧数）。
当信息足够时，输出最终方案并结束对话。

只输出 JSON，不要任何解释或多余文字：
- 还需澄清时：
  {"ready": false, "reply": "你的澄清问题或建议，语气友好、简短"}
- 信息足够时：
  {"ready": true, "reply": "确认语，例如：好的，已为你整理好方案，点击下方按钮即可生成",
   "spec": {
     "prompt": "详细正向提示词（中文，富有画面感）",
     "negative": "反向提示词",
     "kind": "image",
     "params": {"steps": 25, "cfg": 7, "sampler": "euler", "scheduler": "normal", "size": "1024x1024"}
   }}`;

function offlineIdea(text: string, kind: "image" | "video" = "image"): AgentSpec {

  const trimmed = text.trim();

  return {

    prompt: `${trimmed}，电影级构图，细节丰富，光影自然，8k 高清`,

    negative: "低质量，模糊，变形，水印，多余文字",

    params: {

      steps: 25,

      cfg: kind === "video" ? 6 : 7,

      sampler: "euler",

      scheduler: "normal",

      size: kind === "video" ? "832x480" : "1024x1024",

    },

    skillHint: "",

    kind,

  };

}


function detectKind(msgs: string[]): "image" | "video" | null {
  for (const m of msgs) {
    if (/视频|video|短片|动图|mv|影片|动漫短/.test(m)) return "video";
  }
  for (const m of msgs) {
    if (/图片|图像|照片|插画|画作|海报|图$/.test(m)) return "image";
  }
  return null;
}

/** Scripted multi-turn fallback used when no LLM is configured. */
function offlineAgent(history: ChatMessage[]): AgentTurnResult {
  const userMsgs = history.filter((history) => history.role === "user").map((msg) => msg.content);
  if (userMsgs.length === 0) {
    return { reply: "你好！想生成【图片】还是【视频】？简单描述下主题就行～", ready: false };
  }
  const kind = detectKind(userMsgs);
  if (!kind) {
    return { reply: "明白～那你想生成的是【图片】还是【视频】呢？", ready: false };
  }
  if (userMsgs.length < 2) {
    return {
      reply:
        kind === "video"
          ? "好的，视频大概几秒？（如 3 秒 / 5 秒）想要什么风格？"
          : "好的，想要什么风格？（如 写实 / 动漫 / 电影感 / 水彩）以及大致尺寸？",
      ready: false,
    };
  }
  const text = userMsgs.join("，");
  const spec = offlineIdea(text, kind);
  return {
    reply: `好的，我已整理好${kind === "video" ? "视频" : "图片"}生成方案，点击下方按钮即可生成。`,
    ready: true,
    spec,
  };
}

type RawSpec = {
  prompt?: unknown;
  negative?: unknown;
  kind?: unknown;
  skillHint?: unknown;
  params?: Partial<Record<"steps" | "cfg" | "sampler" | "scheduler" | "size", unknown>>;
};

function normalizeSpec(s: RawSpec | null | undefined): AgentSpec {
  const params = s?.params ?? {};
  return {
    prompt: typeof s?.prompt === "string" ? s.prompt : "",
    negative: typeof s?.negative === "string" ? s.negative : undefined,
    kind: s?.kind === "video" ? "video" : "image",
    params: {
      steps: typeof params.steps === "number" ? params.steps : undefined,
      cfg: typeof params.cfg === "number" ? params.cfg : undefined,
      sampler: typeof params.sampler === "string" ? params.sampler : undefined,
      scheduler: typeof params.scheduler === "string" ? params.scheduler : undefined,
      size: typeof params.size === "string" ? params.size : undefined,
    },
    skillHint: typeof s?.skillHint === "string" ? s.skillHint : undefined,
  };
}

/**
 * One turn of the multi-turn agent conversation.
 * @param history full conversation so far (user/assistant messages only; the
 *                 system prompt is injected internally).
 */
export async function chatAgent(history: ChatMessage[]): Promise<AgentTurnResult> {
  const sysMsg: ChatMessage = { role: "system", content: MULTITURN_SYSTEM };
  try {
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [sysMsg, ...history],
        temperature: 0.7,
        maxTokens: 700,
      }),
    });
    if (!res.ok) throw new Error("llm failed");
    const data = (await res.json()) as {
      content?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.content ?? data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = /\{[\s\S]*\}/.exec(content);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        ready?: boolean;
        reply?: string;
        spec?: RawSpec;
      };
      if (parsed.ready === true && parsed.spec) {
        return {
          reply: parsed.reply ?? "已为你整理好方案。",
          ready: true,
          spec: normalizeSpec(parsed.spec),
        };
      }
      return { reply: parsed.reply ?? content, ready: false };
    }
    return { reply: content || "（无回复）", ready: false };
  } catch {
    return offlineAgent(history);
  }
}

/** Single-shot expansion (legacy helper, kept for compatibility). */
export async function expandIdea(text: string): Promise<AgentSpec> {
  const res = await chatAgent([{ role: "user", content: text }]);
  return res.spec ?? offlineIdea(text);
}
