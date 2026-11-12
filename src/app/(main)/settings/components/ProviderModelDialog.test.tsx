/**
 * `ProviderModelDialog` 的按用途分叉判据（#3618 补充）：
 * ① 文本模型：智能配置 / 上下文窗口 / 最大输出 Token / 「API 格式」下拉 / 高级配置
 *    全部照常出现；
 * ② 图像 / 视频模型：上述文本协议的配置项**全部不出现**，取而代之的是一条只读的
 *    「接口端点」（`POST {base}{路径}`，路径唯一出处 `defaultUsageTestPath`）——
 *    图像 `/images/generations`、视频 `/videos/generations`。
 *
 * 桩按本仓惯例走「unknown + 类型谓词收窄」（见 `ComfyuiSection.test.tsx`）：
 * 只在运行期校验本组件真正读的字段，字段改名时这里会红。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";
import { emptyModelForm } from "~/lib/llm/provider-form";

import { ProviderModelDialog } from "./ProviderModelDialog";
import type { ModelDialog, ProviderModelDialogs } from "../hooks/use-provider-model-dialogs";
import type { SettingsProviders } from "../hooks/use-settings-providers";

afterEach(cleanup);

function isDialogD(v: unknown): v is ProviderModelDialogs {
  return (
    isRecord(v) &&
    isRecord(v.modelForm) &&
    typeof v.modelForm.kind === "string" &&
    typeof v.modelForm.apiFormat === "string" &&
    typeof v.modelForm.smartConfig === "boolean" &&
    isRecord(v.modelErrors) &&
    (v.modelError === null || typeof v.modelError === "string") &&
    typeof v.closeModelDialog === "function" &&
    typeof v.patchModelForm === "function" &&
    typeof v.resetModelForm === "function" &&
    typeof v.toggleCapability === "function" &&
    typeof v.toggleInputType === "function" &&
    typeof v.toggleOutputType === "function"
  );
}

function isDialogP(v: unknown): v is SettingsProviders {
  return (
    isRecord(v) &&
    typeof v.busy === "boolean" &&
    Array.isArray(v.providers) &&
    v.providers.every(
      (provider: unknown) => isRecord(provider) && typeof provider.baseUrl === "string",
    )
  );
}

function renderDialog(kind: "chat" | "image" | "video", baseUrl: string): void {
  const d: unknown = {
    closeModelDialog: vi.fn(),
    modelDialog: null,
    modelError: null,
    modelErrors: {},
    modelForm: emptyModelForm(kind),
    patchModelForm: vi.fn(),
    providerDialog: null,
    providerError: null,
    providerErrors: {},
    providerForm: null,
    resetModelForm: vi.fn(),
    submitModel: vi.fn().mockResolvedValue(undefined),
    toggleCapability: vi.fn(),
    toggleInputType: vi.fn(),
    toggleOutputType: vi.fn(),
  };
  const p: unknown = {
    busy: false,
    providers: [{ id: "p1", name: "Example", baseUrl }],
  };
  if (!isDialogD(d) || !isDialogP(p)) {
    throw new Error("弹窗桩缺少 ProviderModelDialog 要读的字段");
  }
  const dialog: ModelDialog = { mode: "add", providerId: "p1" };
  render(<ProviderModelDialog d={d} dialog={dialog} p={p} />);
}

describe("ProviderModelDialog 按用途分叉（#3618 补充）", () => {
  it("文本模型：智能配置 / 窗口 / 输出上限 / API 格式 / 高级配置照常在", () => {
    renderDialog("chat", "https://apihub.example/v1");
    expect(screen.getByText("智能配置")).toBeInTheDocument();
    expect(screen.getByText("上下文窗口")).toBeInTheDocument();
    expect(screen.getByText("最大输出 Token")).toBeInTheDocument();
    expect(screen.getByText("API 格式")).toBeInTheDocument();
    expect(screen.getByText("高级配置")).toBeInTheDocument();
    expect(screen.queryByText("接口端点")).toBeNull();
  });

  it("图像模型：文本协议配置全部消失，只显示只读接口端点（/images/generations）", () => {
    renderDialog("image", "https://apihub.example/v1");
    expect(screen.queryByText("智能配置")).toBeNull();
    expect(screen.queryByText("上下文窗口")).toBeNull();
    expect(screen.queryByText("最大输出 Token")).toBeNull();
    expect(screen.queryByText("API 格式")).toBeNull();
    expect(screen.queryByText("高级配置")).toBeNull();
    expect(screen.getByText("接口端点")).toBeInTheDocument();
    expect(
      screen.getByText("POST https://apihub.example/v1/images/generations"),
    ).toBeInTheDocument();
  });

  it("视频模型：端点按用途给 /videos/generations", () => {
    renderDialog("video", "https://apihub.example/v1");
    expect(
      screen.getByText("POST https://apihub.example/v1/videos/generations"),
    ).toBeInTheDocument();
  });

  it("供应商还没有 Base URL 时：端点仍显示路径段，并提示先去填 Base URL", () => {
    renderDialog("image", "");
    expect(screen.getByText("POST /images/generations")).toBeInTheDocument();
    expect(
      screen.getByText("所属供应商还没有 Base URL：先在供应商详情里填好，这里会显示最终请求地址"),
    ).toBeInTheDocument();
  });
});
