/**
 * LLM 配置不可用的分类与可行动文案（ISSUE #5145）：
 * 密钥失效 / 本地服务未启动 / 没配生效模型三类，调用失败处共用同一出口。
 */
import { describe, expect, it } from "vitest";

import {
  ERR_AUTH_INVALID,
  ERR_NO_EFFECTIVE_MODEL,
  llmConfigProblem,
  llmFailureMessage,
} from "./config-health";

const remote = {
  baseUrl: "https://api.example.com/v1",
  model: "agnes-2.5-pro",
  provider: "remote" as const,
};
const local = { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", provider: "local" as const };

describe("llmConfigProblem（ISSUE #5145）", () => {
  it("模型名为空 / 全空白：调用前就判掉，不发请求", () => {
    expect(llmConfigProblem({ ...remote, model: "" })?.message).toBe(ERR_NO_EFFECTIVE_MODEL);
    expect(llmConfigProblem({ ...remote, model: "   " })?.kind).toBe("no-model");
    expect(llmConfigProblem(remote)).toBeNull();
  });
});

describe("llmFailureMessage", () => {
  it("401 / 403 → 密钥失效，指到设置页且保留既有锚词", () => {
    const msg = llmFailureMessage({ cfg: remote, status: 401 });
    expect(msg).toContain("API Key 无效或未授权");
    expect(msg).toContain("设置 → 远程模型");
    expect(msg).toContain(ERR_AUTH_INVALID);
  });

  it("本地回环 + 连接被拒 → 本地服务未启动，不误报密钥失效", () => {
    const msg = llmFailureMessage({
      cfg: local,
      error: new TypeError("fetch failed", { cause: new Error("ECONNREFUSED 127.0.0.1:11434") }),
    });
    expect(msg).toContain("本地模型服务未启动");
    expect(msg).toContain("Ollama");
  });

  it("非回环远端连接失败不误报本地未启动", () => {
    const msg = llmFailureMessage({
      cfg: remote,
      error: new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }),
    });
    expect(msg).not.toContain("本地模型服务未启动");
    expect(msg).toContain("LLM 请求失败");
  });
});
