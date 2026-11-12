/**
 * `ProviderModelRow` 的判据（#3618）：
 * ① 行上**没有**「测试连接」——同一供应商下每个模型的探测都是同一条
 *    `GET {base}/models`、同一份供应商密钥，逐模型按钮没有增量信息，
 *    连通性由供应商级「测试连接」一并完成；
 * ② 其余动作（测试生成 / 编辑 / 移除）与启停开关照常在、照常接线。
 *
 * 桩按本仓惯例走「unknown + 类型谓词收窄」（见 `ComfyuiSection.test.tsx`）：
 * 只在运行期校验本行真正读的字段，字段改名时这里会红。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

import { ProviderModelRow } from "./ProviderModelRow";
import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type {
  ProviderModelView,
  ProviderView,
  SettingsProviders,
} from "../hooks/use-settings-providers";
import type { UsageTestDialogs } from "../hooks/use-usage-test-dialogs";

afterEach(cleanup);

function isModelView(v: unknown): v is ProviderModelView {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.enabled === "boolean" &&
    typeof v.apiFormat === "string" &&
    typeof v.contextWindow === "number" &&
    typeof v.maxOutputTokens === "number"
  );
}

/** 一条停用中的模型（本行读的字段都在：启停 / 摘要行 / 用途徽标）。 */
function modelFixture(kind: "chat" | "image" | "video" = "chat"): ProviderModelView {
  const stub: unknown = {
    id: "m1",
    providerId: "p1",
    name: "agnes-3.0-flash",
    kind,
    enabled: false,
    baseUrl: null,
    apiFormat: "chat-completions",
    hasApiKey: false,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputTypes: "",
    outputTypes: "",
    capabilities: "",
    reasoningLevels: "",
    reasoningParamMapping: null,
    smartConfig: false,
  };
  if (!isModelView(stub)) {
    throw new Error("模型行夹具缺少 ProviderModelRow 要读的字段");
  }
  return stub;
}

function isRowProviders(v: unknown): v is SettingsProviders {
  return (
    isRecord(v) &&
    typeof v.busy === "boolean" &&
    typeof v.toggleModel === "function" &&
    typeof v.deleteModel === "function"
  );
}

function isRowDialogs(v: unknown): v is ProviderModelDialogs {
  return isRecord(v) && typeof v.openEditModel === "function";
}

function isRowProvider(v: unknown): v is ProviderView {
  return isRecord(v) && typeof v.baseUrl === "string";
}

function isRowUsage(v: unknown): v is UsageTestDialogs {
  return isRecord(v) && typeof v.openUsageTest === "function";
}

function renderRow(kind: "chat" | "image" | "video" = "chat") {
  const toggleModel = vi.fn().mockResolvedValue({ ok: true });
  const deleteModel = vi.fn().mockResolvedValue({ ok: true });
  const p: unknown = { busy: false, toggleModel, deleteModel };
  const d: unknown = { openEditModel: vi.fn() };
  const provider: unknown = { id: "p1", baseUrl: "https://apihub.example/v1" };
  const usage: unknown = { openUsageTest: vi.fn() };
  const onAction = vi.fn().mockResolvedValue(undefined);
  if (!isRowProviders(p) || !isRowDialogs(d) || !isRowProvider(provider) || !isRowUsage(usage)) {
    throw new Error("模型行的桩缺少 ProviderModelRow 要读的字段");
  }
  render(
    <ProviderModelRow
      d={d}
      model={modelFixture(kind)}
      onAction={onAction}
      p={p}
      provider={provider}
      usage={usage}
    />,
  );
  return { toggleModel };
}

describe("ProviderModelRow（#3618）", () => {
  it("行上没有「测试连接」：探测统一走供应商级", () => {
    renderRow();
    expect(screen.queryByText("测试连接")).toBeNull();
    expect(screen.queryByText("连接测试中…")).toBeNull();
    expect(screen.queryByText(/接口格式探测/)).toBeNull();
  });

  it("其余动作照常在：测试生成 / 编辑 / 移除", () => {
    renderRow();
    expect(screen.getByRole("button", { name: "测试生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除模型 agnes-3.0-flash" })).toBeInTheDocument();
  });

  it("启停开关照常接线：点停用行上的开关 = 启用该模型", async () => {
    const user = userEvent.setup();
    const { toggleModel } = renderRow();
    await user.click(screen.getByRole("switch", { name: "启用模型 agnes-3.0-flash" }));
    expect(toggleModel).toHaveBeenCalledWith("m1", true);
  });

  it("图像行摘要（#3618 补充）：念图像端点路径，不念上下文 / 输出 / 文本格式", () => {
    renderRow("image");
    expect(screen.getByText(/图像端点 \/images\/generations/)).toBeInTheDocument();
    expect(screen.queryByText(/上下文/)).toBeNull();
    expect(screen.queryByText(/输出/)).toBeNull();
    expect(screen.queryByText(/Chat Completions/)).toBeNull();
  });

  it("视频行摘要（#3618 补充）：念视频端点路径", () => {
    renderRow("video");
    expect(screen.getByText(/视频端点 \/videos\/generations/)).toBeInTheDocument();
    expect(screen.queryByText(/Chat Completions/)).toBeNull();
  });
});
