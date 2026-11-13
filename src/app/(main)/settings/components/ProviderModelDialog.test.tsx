/**
 * `ProviderModelDialog` 的按用途分叉判据（#3618 补充；#3656 改判）：
 * ① 文本模型：智能配置 / 上下文窗口 / 最大输出 Token / 「API 格式」下拉 / 高级配置
 *    全部照常出现；
 * ② 图像 / 视频模型：上述文本协议的配置项**全部不出现**，取而代之的是「接口端点」
 *    **下拉**（词表 `REMOTE_MEDIA_ENDPOINT_OPTIONS`，生效值 = 用途默认第一项；
 *    选项标签是按 Base URL 拼出的最终请求地址）。
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

  it("图像模型：文本协议配置全部消失，「接口端点」是下拉且默认第一项（#3656）", () => {
    renderDialog("image", "https://apihub.example/v1");
    expect(screen.queryByText("智能配置")).toBeNull();
    expect(screen.queryByText("上下文窗口")).toBeNull();
    expect(screen.queryByText("最大输出 Token")).toBeNull();
    expect(screen.queryByText("API 格式")).toBeNull();
    expect(screen.queryByText("高级配置")).toBeNull();
    expect(screen.getByText("接口端点")).toBeInTheDocument();
    /* 下拉 Trigger（base-ui combobox）显示选中项的标签：默认 = 用途词表第一项，
     * 标签就是词表路径段本身（/v1 起那段）—— 完整请求地址由下方
     * 「实际请求地址」提示承担，不在这里重复念（#3671）。 */
    expect(screen.getByRole("combobox", { name: "接口端点" })).toHaveTextContent(
      "/v1/images/generations",
    );
    /* 标签 ⇄ 控件接上线（§16.2.4.26）：下拉是可交互控件，由 FormField 关联。 */
    expect(screen.getByLabelText("接口端点")).toBeInTheDocument();
  });

  it("视频模型：端点按用途给 /v1/videos（#3656 新词表）", () => {
    renderDialog("video", "https://apihub.example/v1");
    expect(screen.getByRole("combobox", { name: "接口端点" })).toHaveTextContent("/v1/videos");
  });

  it("供应商还没有 Base URL 时：选项仍显示路径段本身，并提示先去填 Base URL（#3671）", () => {
    renderDialog("image", "");
    expect(screen.getByRole("combobox", { name: "接口端点" })).toHaveTextContent(
      "/v1/images/generations",
    );
    expect(
      screen.getByText("所属供应商还没有 Base URL：先在供应商详情里填好，这里会显示最终请求地址"),
    ).toBeInTheDocument();
  });
});
