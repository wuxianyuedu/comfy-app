/**
 * `LlmRemoteSection` 供应商卡片的判据（#3618）：
 * ① 卡片只显示必要内容 —— Base URL 不再出现在窄列清单里（必然截断成「已…」）；
 * ② 启停读数可见：第二行念「已启用 N/M」；
 * ③ 没有模型的供应商念「暂无模型」，不再念一句谁也读不出的地址。
 *
 * 三个 hook 全部换成读数固定的桩（unknown + 类型谓词收窄，见 `ComfyuiSection.test.tsx`
 * 的同款样板）；`selected` 留空让详情列走「还没有供应商」的空态 —— 本文件只判清单卡片。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

import { LlmRemoteSection } from "./LlmRemoteSection";
import type { ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import type { SettingsProviders } from "../hooks/use-settings-providers";
import type { UsageTestDialogs } from "../hooks/use-usage-test-dialogs";

function isController(v: unknown): v is ReadySettingsPageController {
  return isRecord(v);
}

function isLlmRemoteState(v: unknown): v is SettingsProviders {
  return (
    isRecord(v) &&
    typeof v.loading === "boolean" &&
    (v.errorText === null || typeof v.errorText === "string") &&
    Array.isArray(v.providers) &&
    Array.isArray(v.models) &&
    typeof v.selectProvider === "function"
  );
}

function isLlmDialogs(v: unknown): v is ProviderModelDialogs {
  return (
    isRecord(v) &&
    v.modelDialog === null &&
    v.providerDialog === null &&
    typeof v.openAddProvider === "function"
  );
}

function isLlmUsage(v: unknown): v is UsageTestDialogs {
  return isRecord(v) && v.usageTest === null;
}

function requireState<T>(v: unknown, guard: (x: unknown) => x is T, label: string): T {
  if (!guard(v)) {
    throw new Error(`LlmRemoteSection 测试的${label}桩缺少组件要读的字段`);
  }
  return v;
}

const { holders } = vi.hoisted(() => {
  const holders: { dialogs: unknown; providers: unknown; usage: unknown } = {
    dialogs: null,
    providers: null,
    usage: null,
  };
  return { holders };
});

vi.mock("../hooks/use-settings-providers", () => ({
  useSettingsProviders: () => requireState(holders.providers, isLlmRemoteState, "供应商数据"),
}));

vi.mock("../hooks/use-provider-model-dialogs", () => ({
  useProviderModelDialogs: () => requireState(holders.dialogs, isLlmDialogs, "弹窗态"),
}));

vi.mock("../hooks/use-usage-test-dialogs", () => ({
  useUsageTestDialogs: () => requireState(holders.usage, isLlmUsage, "实际使用弹窗态"),
}));

/* 本仓不在 setup 里注册自动清理（`globals: false`），每份用例自己收尾。 */
afterEach(cleanup);

beforeEach(() => {
  holders.dialogs = {
    modelDialog: null,
    openAddProvider: vi.fn(),
    providerDialog: null,
  };
  holders.usage = { usageTest: null };
  holders.providers = {
    busy: false,
    deleteModel: vi.fn(),
    deleteProvider: vi.fn(),
    errorText: null,
    loading: false,
    models: [
      { id: "m1", providerId: "p1", enabled: true },
      { id: "m2", providerId: "p1", enabled: false },
      { id: "m3", providerId: "p2", enabled: true },
    ],
    probe: vi.fn(),
    providers: [
      {
        id: "p1",
        name: "agnes",
        baseUrl: "https://apihub.example/v1",
        apiFormat: "chat-completions",
        hasApiKey: true,
      },
      {
        id: "p2",
        name: "openrouter",
        baseUrl: "https://openrouter.example/v1",
        apiFormat: "chat-completions",
        hasApiKey: false,
      },
      {
        id: "p3",
        name: "空白供应商",
        baseUrl: "https://blank.example",
        apiFormat: "chat-completions",
        hasApiKey: false,
      },
    ],
    refetch: vi.fn(),
    saveModel: vi.fn(),
    saveProvider: vi.fn(),
    selected: null,
    selectProvider: vi.fn(),
    toggleModel: vi.fn(),
  };
});

/** 本视图只把它透传给（已 mock 的）`useUsageTestDialogs`，任何可记录值都行。 */
const emptyController = requireState({}, isController, "设置页 controller");

function renderSection() {
  render(<LlmRemoteSection c={emptyController} />);
}

describe("LlmRemoteSection 供应商卡片（#3618）", () => {
  it("卡片不显示 Base URL", () => {
    renderSection();
    expect(screen.queryByText(/apihub\.example/)).toBeNull();
    expect(screen.queryByText(/openrouter\.example/)).toBeNull();
  });

  it("第二行念启停读数「已启用 N/M」", () => {
    renderSection();
    expect(screen.getByText(/已启用 1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/已启用 1\/1/)).toBeInTheDocument();
  });

  it("没有模型的供应商念「暂无模型」；配了密钥的照常带「已配密钥」", () => {
    renderSection();
    expect(screen.getByText(/暂无模型/)).toBeInTheDocument();
    expect(screen.getByText(/已启用 1\/2 · 已配密钥/)).toBeInTheDocument();
  });
});
