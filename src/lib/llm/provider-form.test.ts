/**
 * `provider-form.ts` 的字段级规则（#3501）。
 *
 * 这一份判的是「表单 ↔ 服务端入参」的形状：三态密钥、数字字段的空串语义、
 * 智能配置的覆盖范围。全是纯函数，不碰 React / 网络。
 */
import { describe, expect, it } from "vitest";

import {
  applySmartDefaults,
  cleanReasoningValues,
  emptyModelForm,
  emptyProviderForm,
  modelFormFromView,
  modelSaveDraft,
  providerFormFromView,
  providerSaveDraft,
  splitReasoningLevels,
  validateModelForm,
  validateProviderForm,
  type ModelFormValues,
} from "./provider-form";

describe("providerFormFromView / emptyProviderForm", () => {
  it("新建表单：密钥与清除标记都为空（接口格式已下移到模型级）", () => {
    expect(emptyProviderForm()).toEqual({
      name: "",
      baseUrl: "",
      apiKey: "",
      clearApiKey: false,
    });
  });

  it("库里的视图回填：apiKey 不回填明文", () => {
    expect(
      providerFormFromView({
        name: "Agnes",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        hasApiKey: true,
      }),
    ).toEqual({
      name: "Agnes",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKey: "",
      clearApiKey: false,
    });
  });
});

describe("validateProviderForm", () => {
  const form = (patch: Partial<ReturnType<typeof emptyProviderForm>>) => ({
    ...emptyProviderForm(),
    ...patch,
  });

  it("名称与 Base URL 都必须填；空白不算填", () => {
    expect(validateProviderForm(emptyProviderForm())).toEqual({
      name: "请填写供应商名称",
      baseUrl: "请填写 Base URL",
    });
    expect(validateProviderForm(form({ name: "   ", baseUrl: "   " }))).toEqual({
      name: "请填写供应商名称",
      baseUrl: "请填写 Base URL",
    });
  });

  it("Base URL 必须是 http/https（ftp / 畸形串都拒）", () => {
    expect(validateProviderForm(form({ name: "A", baseUrl: "ftp://x" })).baseUrl).toBe(
      "Base URL 必须是 http/https 地址",
    );
    expect(validateProviderForm(form({ name: "A", baseUrl: "not a url" })).baseUrl).toBe(
      "Base URL 必须是 http/https 地址",
    );
  });

  it("https 与大小写协议都放行", () => {
    expect(validateProviderForm(form({ name: "A", baseUrl: "https://agnes/v1" }))).toEqual({});
    expect(validateProviderForm(form({ name: "A", baseUrl: "HTTPS://agnes/v1" }))).toEqual({});
  });
});

describe("providerSaveDraft", () => {
  const form = (patch: Partial<ReturnType<typeof emptyProviderForm>>) => ({
    ...emptyProviderForm(),
    ...patch,
  });

  it("裁空白、去尾斜杠；新建不带 id", () => {
    expect(
      providerSaveDraft(
        form({
          name: " Agnes ",
          baseUrl: " https://apihub.agnes-ai.com/v1/ ",
        }),
      ),
    ).toEqual({
      name: "Agnes",
      baseUrl: "https://apihub.agnes-ai.com/v1",
    });
  });

  it("编辑态带上 id；输入了新密钥就写它（此时 clearApiKey 不生效）", () => {
    expect(
      providerSaveDraft(
        form({
          name: "Agnes",
          baseUrl: "https://agnes/v1",
          apiKey: " sk-new ",
          clearApiKey: true,
        }),
        "p1",
      ),
    ).toEqual({
      id: "p1",
      name: "Agnes",
      baseUrl: "https://agnes/v1",
      apiKey: "sk-new",
    });
  });

  it("密钥三态：留空 + 不勾清除 ⇒ 省略键（服务端保持既有）；勾清除 ⇒ null", () => {
    const untouched = providerSaveDraft(form({ name: "Agnes", baseUrl: "https://agnes/v1" }), "p1");
    expect("apiKey" in untouched).toBe(false);

    const cleared = providerSaveDraft(
      form({ name: "Agnes", baseUrl: "https://agnes/v1", clearApiKey: true }),
      "p1",
    );
    expect(cleared.apiKey).toBeNull();
  });
});

describe("emptyModelForm / modelFormFromView", () => {
  it("新建模型：智能配置默认开、接口格式回落 chat-completions、输入类型文本", () => {
    expect(emptyModelForm("image")).toMatchObject({
      name: "",
      kind: "image",
      apiFormat: "chat-completions",
      smartConfig: true,
      contextWindow: "",
      maxOutputTokens: "",
      inputTypes: ["text"],
      capabilities: ["system-messages"],
      reasoningLevels: "",
      reasoningParam: "",
      reasoningValues: {},
      baseUrl: "",
      enabled: true,
    });
  });

  it("新建模型：可指定所属供应商的默认格式", () => {
    expect(emptyModelForm("chat", "anthropic-messages").apiFormat).toBe("anthropic-messages");
  });

  it("库行回填：数字转字符串、JSON 列容错解析、未知 kind 回落 chat、未知格式回落默认", () => {
    expect(
      modelFormFromView({
        name: "claude-sonnet-4",
        kind: "audio",
        apiFormat: "grpc",
        smartConfig: false,
        contextWindow: 200_000,
        maxOutputTokens: null,
        inputTypes: ["text", "image", "unknown"],
        capabilities: ["structured-output"],
        reasoningLevels: ["low", " low ", "high"],
        reasoningParamMapping: { param: "reasoning_effort", values: { low: "low" } },
        baseUrl: "https://model-override/v1",
        enabled: false,
      }),
    ).toEqual({
      name: "claude-sonnet-4",
      kind: "chat",
      apiFormat: "chat-completions",
      smartConfig: false,
      contextWindow: "200000",
      maxOutputTokens: "",
      inputTypes: ["text", "image"],
      capabilities: ["structured-output"],
      reasoningLevels: "low, high",
      reasoningParam: "reasoning_effort",
      reasoningValues: { low: "low" },
      baseUrl: "https://model-override/v1",
      enabled: false,
    });
  });

  it("库行回填：合法的模型级格式原样保留", () => {
    expect(
      modelFormFromView({
        name: "agnes-3.0-flash",
        kind: "chat",
        apiFormat: "anthropic-messages",
        smartConfig: true,
        contextWindow: null,
        maxOutputTokens: null,
        inputTypes: null,
        capabilities: null,
        reasoningLevels: null,
        reasoningParamMapping: null,
        baseUrl: null,
        enabled: true,
      }).apiFormat,
    ).toBe("anthropic-messages");
  });
});

describe("applySmartDefaults", () => {
  const base = (patch: Partial<ModelFormValues>): ModelFormValues => ({
    ...emptyModelForm(),
    ...patch,
  });

  it("开关关掉时原样返回（用户手填的值不被覆盖）", () => {
    const form = base({ smartConfig: false, name: "claude-sonnet-4", contextWindow: "123" });
    expect(applySmartDefaults(form)).toBe(form);
  });

  it("打开时按模型 id 预填窗口 / 输出上限 / 输入类型 / 能力", () => {
    const filled = applySmartDefaults(base({ name: "claude-sonnet-4", contextWindow: "1" }));
    expect(filled.contextWindow).toBe("200000");
    expect(filled.maxOutputTokens).toBe("8192");
    expect(filled.inputTypes).toEqual(["text", "image", "pdf"]);
    expect(filled.capabilities).toEqual(["structured-output", "system-messages"]);
  });

  it("认不出的模型给保守兜底（不是空窗口）", () => {
    const filled = applySmartDefaults(base({ name: "内部小模型" }));
    expect(filled.contextWindow).toBe("8192");
    expect(filled.maxOutputTokens).toBe("2048");
    expect(filled.inputTypes).toEqual(["text"]);
  });
});

describe("validateModelForm", () => {
  const form = (patch: Partial<ModelFormValues>) => ({ ...emptyModelForm(), ...patch });

  it("模型 ID 必填；数字字段可留空", () => {
    expect(validateModelForm(emptyModelForm())).toEqual({ name: "请填写模型 ID" });
    expect(
      validateModelForm(form({ name: "gpt-4o", contextWindow: " ", maxOutputTokens: "" })),
    ).toEqual({});
  });

  it("窗口 / 输出上限必须是大于 0 的整数", () => {
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      const errors = validateModelForm(
        form({ name: "m", contextWindow: bad, maxOutputTokens: bad }),
      );
      expect(errors.contextWindow, bad).toBe("请填写大于 0 的整数");
      expect(errors.maxOutputTokens, bad).toBe("请填写大于 0 的整数");
    }
    expect(
      validateModelForm(form({ name: "m", contextWindow: "8192", maxOutputTokens: "1024" })),
    ).toEqual({});
  });
});

describe("splitReasoningLevels / cleanReasoningValues", () => {
  it("逗号、中文逗号、空格、换行都算分隔符，空白项丢掉", () => {
    expect(splitReasoningLevels(" low, medium，high\nxhigh  ")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(splitReasoningLevels("   ")).toEqual([]);
  });

  it("取值表只留非空行，键值都裁空白", () => {
    expect(
      cleanReasoningValues({ " low ": " low ", medium: "   ", "": "x", high: "high" }),
    ).toEqual({
      low: "low",
      high: "high",
    });
  });
});

describe("modelSaveDraft", () => {
  const form = (patch: Partial<ModelFormValues>): ModelFormValues => ({
    ...emptyModelForm(),
    ...patch,
  });

  it("新建：不带 id、不带 apiKey；baseUrl 为 null（跟随供应商）", () => {
    const draft = modelSaveDraft(form({ name: " claude-sonnet-4 " }), { providerId: "p1" });
    expect(draft).toEqual({
      providerId: "p1",
      name: "claude-sonnet-4",
      kind: "chat",
      apiFormat: "chat-completions",
      enabled: true,
      baseUrl: null,
      contextWindow: null,
      maxOutputTokens: null,
      inputTypes: ["text"],
      capabilities: ["system-messages"],
      reasoningLevels: [],
      reasoningParamMapping: null,
      smartConfig: true,
    });
    expect("id" in draft).toBe(false);
    expect("apiKey" in draft).toBe(false);
  });

  it("编辑：保留模型级接口覆盖；数字字段空串 = null", () => {
    const draft = modelSaveDraft(
      form({
        name: "claude-sonnet-4",
        contextWindow: "",
        maxOutputTokens: "4096",
        inputTypes: ["text", "image"],
        capabilities: ["structured-output"],
        reasoningLevels: "low, high",
        reasoningParam: " reasoning_effort ",
        reasoningValues: { low: " low ", high: "" },
        enabled: false,
        smartConfig: false,
      }),
      { providerId: "p1", id: "m1", existingBaseUrl: "https://model-override/v1" },
    );
    expect(draft).toMatchObject({
      id: "m1",
      providerId: "p1",
      baseUrl: "https://model-override/v1",
      contextWindow: null,
      maxOutputTokens: 4096,
      inputTypes: ["text", "image"],
      capabilities: ["structured-output"],
      reasoningLevels: ["low", "high"],
      reasoningParamMapping: { param: "reasoning_effort", values: { low: "low" } },
      enabled: false,
      smartConfig: false,
    });
  });

  it("推理参数与取值都为空 ⇒ 映射为 null（不是空对象）", () => {
    const draft = modelSaveDraft(form({ name: "m", reasoningParam: "  ", reasoningValues: {} }), {
      providerId: "p1",
    });
    expect(draft.reasoningParamMapping).toBeNull();
  });

  it("非法数字按 null 落库（校验在 validateModelForm，保存不抛错）", () => {
    const draft = modelSaveDraft(form({ name: "m", contextWindow: "abc" }), { providerId: "p1" });
    expect(draft.contextWindow).toBeNull();
  });
});
