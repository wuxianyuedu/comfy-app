/**
 * llm.router 的闸门用例（体检清单 ⑨ 第二刀）：router 层 zod 闸此前没有执行者。地址闸只许 http/https，非法
 * `baseUrl` 必须在 `upsertSingleton` 前挡下（SSRF 入口）；枚举闸静默回退比报错更坏；`extraModels` 缺省须 `undefined`
 * 透传，折成空数组 = 清空远端模型（ISSUE #2592）。mock：内存库/真 LLM/本机覆盖文件，spy 保真实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmServer, contracts } = vi.hoisted(() => ({
  llmServer: {
    getConfigForClient: vi.fn(() => ({
      provider: "remote",
      hasApiKey: true,
    })),
  },
  contracts: {
    loadModeContractLayers: vi.fn(() => ({
      configured: [{ mode: "TXT2IMG" }],
      override: [],
      contracts: [{ mode: "TXT2IMG" }],
    })),
    saveModeContracts: vi.fn((c: unknown) => c),
    isDevCheckout: vi.fn(() => false),
    saveModeContractsAsProjectDefaults: vi.fn(() => ({
      contracts: [{ mode: "TXT2IMG" }],
      file: "src/lib/workshop/mode-contract-defaults.json",
    })),
    resetModeContractOverride: vi.fn(() => ({
      contracts: [],
      effective: { mode: "TXT2IMG", inputs: ["prompt"], output: "image" },
    })),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/llm/server", () => ({
  getConfigForClient: llmServer.getConfigForClient,
}));
vi.mock("~/lib/workshop/mode-contract.server", () => ({
  loadModeContractLayers: contracts.loadModeContractLayers,
  saveModeContracts: contracts.saveModeContracts,
  isDevCheckout: contracts.isDevCheckout,
  saveModeContractsAsProjectDefaults: contracts.saveModeContractsAsProjectDefaults,
  resetModeContractOverride: contracts.resetModeContractOverride,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { llmConfigRepository, remoteModelRepository } from "~/lib/core/repository";
import type { LlmConfig } from "~/server/db/schema";
import { llmRouter } from "~/server/api/routers/llm";
import { getTestDb, seedRemoteModel, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(llmRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

/** upsertSingleton 的最小回执行：测试只消费 provider / apiKey 派生的脱敏视图与调用账。 */
const upsertedConfig = {
  id: "singleton",
  provider: "remote",
  baseUrl: "https://api.example/v1",
  model: "m1",
  extraModels: null,
  apiKey: "enc:v1:test",
  temperature: 0.7,
  temperatureByTask: null,
  maxTokens: 2048,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} satisfies LlmConfig;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (error: { code?: string }) => error?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
});

describe("configSave —— 写库之前的地址与枚举闸", () => {
  it("baseUrl 走非 http(s) 协议 → BAD_REQUEST，且一个字都不写库", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "http://", "not-a-url"]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      expect(await codeOf(caller().configSave({ baseUrl: bad }))).toBe("BAD_REQUEST");
    }
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRestore();
  });

  it("大写协议与正常回环地址放行（别把合法值误拒成「配置保存不了」）", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue(upsertedConfig);
    expect(await codeOf(caller().configSave({ baseUrl: "HTTPS://x.example" }))).toBe("OK");
    expect(await codeOf(caller().configSave({ baseUrl: "http://127.0.0.1:11434/v1" }))).toBe("OK");
    expect(upsert).toHaveBeenCalledTimes(2);
    upsert.mockRestore();
  });

  it("provider 不在枚举里 → BAD_REQUEST（旧写法会静默按 local 误路由）", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    expect(
      await codeOf(
        caller().configSave({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 故意喂不在枚举里的值：zod 闸必须拦下（线上 JSON 载荷绕得过编译期类型，绕不过这道闸）
          provider: "azure" as never,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRestore();
  });

  it("候选清单按类型拆开：字符串进本地候选、对象进远端表", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue(upsertedConfig);
    await caller().configSave({
      extraModels: ["llama3", { name: "gpt-x", baseUrl: "https://api.example/v1", apiKey: "k" }],
    });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      extraModels: ["llama3"],
    });
    /* 远端那一半断言落在**表里有什么**，不是「`replaceAll` 被调了几次」——
     * 拆分与两张表的写入范围已经从路由收进仓库层的那个入口（ISSUE #2592），
     * 盯调用点等于盯一个不再存在的位置。 */
    const rows = await remoteModelRepository.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "gpt-x",
      baseUrl: "https://api.example/v1",
    });
    /* `list()` 读侧已解密（#3509），落盘形态只能读原始表行。 */
    expect(String(tdb.$tables.remoteModels[0]!.apiKey).startsWith("enc:v1:")).toBe(true);
    upsert.mockRestore();
  });

  it("没给 extraModels 时透传 undefined —— 不是空数组（折成空数组=替用户清空远端模型，A11 同族）", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue(upsertedConfig);
    seedRemoteModel(tdb, { name: "既有远端" });
    await caller().configSave({ model: "m1" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ extraModels: undefined });
    /* 反向那一半才是这条的落点：库里那行远端模型必须还在。只盯「传了 undefined」
     * 的话，某一层把它折成 `[]` 也照样绿（spy 记账看不到库）。 */
    expect((await remoteModelRepository.list()).map((r) => r.name)).toEqual(["既有远端"]);
    upsert.mockRestore();
  });

  it("回传的是脱敏后的配置，路由不自己拼一份", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue(upsertedConfig);
    const res = await caller().configSave({ model: "m1" });
    expect(res.config).toEqual({ provider: "remote", hasApiKey: true });
    upsert.mockRestore();
  });

  it("temperatureByTask 的任务类型不在枚举里 → BAD_REQUEST，且落库前就挡下", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    expect(
      await codeOf(
        caller().configSave({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 故意喂不在枚举里的键：zod 闸必须拦下（线上载荷可绕过编译期类型）
          temperatureByTask: {
            translate: 0.9,
          } as never,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(
        caller().configSave({
          temperatureByTask: {
            txt2img: 0.7,
            img2video: 0.5,
            chat: 0.3,
            code: 0.2,
            creative: 0.8,
            review: 0.1,
          },
        }),
      ),
    ).toBe("OK");
    expect(upsert).toHaveBeenCalledTimes(1);
    upsert.mockRestore();
  });
});

describe("providers —— 供应商 / 模型的入参闸与全量回读（#3501）", () => {
  const saveProvider = (patch: Record<string, unknown> = {}) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 用例故意用宽松 patch 造各种入参
    caller().providerSave({
      name: "Agnes",
      baseUrl: "https://platform.agnes-ai.com",
      apiFormat: "anthropic-messages",
      ...patch,
    } as never);

  it("providersGet 空库：两份清单都是空数组（历史遗留迁移跑过也不造假数据）", async () => {
    expect(await caller().providersGet()).toEqual({ providers: [], models: [] });
  });

  it("providerSave 新建 / 更新：回全量视图，密钥只报 hasApiKey，落库密文", async () => {
    const created = await saveProvider({ apiKey: "sk-provider" });
    expect(created.providers).toHaveLength(1);
    expect(created.providers[0]).toMatchObject({
      name: "Agnes",
      baseUrl: "https://platform.agnes-ai.com",
      apiFormat: "anthropic-messages",
      hasApiKey: true,
    });
    expect(created.providers[0]).not.toHaveProperty("apiKey");
    const providerId = created.providers[0]!.id;
    expect(String(tdb.$tables.llmProviders[0]!.apiKey).startsWith("enc:v1:")).toBe(true);

    // 更新不带 apiKey ⇒ 保持既有；显式 null ⇒ 清空（hasApiKey 跟着变 false）
    const updated = await caller().providerSave({
      id: providerId,
      name: "Agnes 2",
      baseUrl: "https://agnes.example.com",
      apiFormat: "responses",
    });
    expect(updated.providers[0]).toMatchObject({
      id: providerId,
      name: "Agnes 2",
      apiFormat: "responses",
      hasApiKey: true,
    });

    const cleared = await caller().providerSave({
      id: providerId,
      name: "Agnes 2",
      baseUrl: "https://agnes.example.com",
      apiFormat: "responses",
      apiKey: null,
    });
    expect(cleared.providers[0]?.hasApiKey).toBe(false);
    expect(tdb.$tables.llmProviders[0]!.apiKey).toBeNull();
  });

  it("providerSave 的 zod 闸：Base URL 非 http(s) / 空名 / 未知格式都 BAD_REQUEST，且不落库", async () => {
    for (const patch of [
      { baseUrl: "ftp://x" },
      { baseUrl: "not a url" },
      { name: "   " },
      { apiFormat: "grpc" },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序
      expect(await codeOf(saveProvider(patch))).toBe("BAD_REQUEST");
    }
    expect(tdb.$tables.llmProviders).toEqual([]);
  });

  it("modelSave / modelToggle / modelDelete：全量回读、启停、删除", async () => {
    const providerId = (await saveProvider()).providers[0]!.id;
    const saved = await caller().modelSave({
      providerId,
      name: "claude-sonnet-4",
      kind: "chat",
      apiFormat: "responses",
      apiKey: "sk-model",
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      inputTypes: ["text", "image"],
      capabilities: ["structured-output"],
      reasoningLevels: ["low", "high"],
      reasoningParamMapping: { param: "reasoning_effort", values: { low: "low" } },
      smartConfig: false,
    });
    expect(saved.models).toHaveLength(1);
    expect(saved.models[0]).toMatchObject({
      providerId,
      name: "claude-sonnet-4",
      kind: "chat",
      apiFormat: "responses",
      enabled: true,
      hasApiKey: true,
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      inputTypes: ["text", "image"],
      capabilities: ["structured-output"],
      reasoningLevels: ["low", "high"],
      reasoningParamMapping: { param: "reasoning_effort", values: { low: "low" } },
      smartConfig: false,
    });
    expect(saved.models[0]).not.toHaveProperty("apiKey");
    const modelId = saved.models[0]!.id;

    const toggled = await caller().modelToggle({ id: modelId, enabled: false });
    expect(toggled.models[0]?.enabled).toBe(false);
    expect(tdb.$tables.remoteModels[0]!.enabled).toBe(0);

    const deleted = await caller().modelDelete({ id: modelId });
    expect(deleted.models).toEqual([]);
    expect((await caller().providersGet()).models).toEqual([]);
  });

  it("模型级接口格式：显式值优先，省略 = 跟随供应商默认（#3517）", async () => {
    const providerId = (await saveProvider({ apiFormat: "anthropic-messages" })).providers[0]!.id;

    const explicit = await caller().modelSave({
      providerId,
      name: "m-explicit",
      apiFormat: "responses",
    });
    expect(explicit.models[0]?.apiFormat).toBe("responses");

    const inherited = await caller().modelSave({ providerId, name: "m-inherit" });
    expect(inherited.models.find((m) => m.name === "m-inherit")?.apiFormat).toBe(
      "anthropic-messages",
    );
  });

  it("模型指向已删除的供应商：生效格式回落 OpenAI 兼容，不因孤儿行报错（#3517）", async () => {
    seedRemoteModel(tdb, { name: "orphan", providerId: "gone" });
    const state = await caller().providersGet();
    expect(state.models).toEqual([
      expect.objectContaining({
        name: "orphan",
        providerId: "gone",
        apiFormat: "chat-completions",
      }),
    ]);
  });

  it("modelSave 的 zod 闸：缺 providerId / 空名 / 0 窗口 / 未知用途 / 未知输入类型都 BAD_REQUEST", async () => {
    const providerId = (await saveProvider()).providers[0]!.id;
    const base = { providerId, name: "m" };
    for (const patch of [
      { providerId: undefined },
      { providerId: "" },
      { name: "   " },
      { contextWindow: 0 },
      { maxOutputTokens: -1 },
      { kind: "audio" },
      { apiFormat: "grpc" },
      { inputTypes: ["audio"] },
      { capabilities: ["telepathy"] },
      { reasoningParamMapping: { param: "x", values: { low: 1 } } },
    ]) {
      // oxlint-disable-next-line no-await-in-loop, typescript/no-unsafe-type-assertion -- 逐轮 await 保顺序；故意喂非法入参
      expect(await codeOf(caller().modelSave({ ...base, ...patch } as never))).toBe("BAD_REQUEST");
    }
    expect(tdb.$tables.remoteModels).toEqual([]);
  });

  it("providerDelete 连名下模型一起删，并把剩余状态整份回读", async () => {
    const first = await saveProvider({ name: "Agnes" });
    const second = await saveProvider({ name: "Backup", baseUrl: "https://backup.example.com" });
    const dropId = first.providers[0]!.id;
    await caller().modelSave({ providerId: dropId, name: "owned-by-drop" });
    await caller().modelSave({
      providerId: second.providers.find((p) => p.name === "Backup")!.id,
      name: "owned-by-keep",
    });

    const after = await caller().providerDelete({ id: dropId });
    expect(after.providers.map((p) => p.name)).toEqual(["Backup"]);
    expect(after.models.map((m) => m.name)).toEqual(["owned-by-keep"]);
  });

  it("providersGet 先把历史遗留模型迁进「默认供应商」再回读", async () => {
    seedRemoteModel(tdb, { name: "legacy" });
    const state = await caller().providersGet();
    expect(state.providers.map((p) => p.name)).toEqual(["默认供应商"]);
    expect(state.models).toHaveLength(1);
    expect(state.models[0]).toMatchObject({
      name: "legacy",
      providerId: state.providers[0]!.id,
      enabled: true,
      hasApiKey: false,
    });
  });
});

describe("modeContracts —— 契约口 id 的类型守卫", () => {
  const contract = (inputs: Array<string>) => ({
    contracts: [
      {
        mode: "TXT2IMG",
        inputs,
        /* SAFETY: 类型断言已复核 */
        output: "image" as const,
      },
    ],
  });

  it("契约口合法集合通过并原样交给存储层", async () => {
    await caller().modeContractsSave(contract(["prompt", "negative", "size", "reference-image-2"]));
    expect(contracts.saveModeContracts).toHaveBeenCalledTimes(1);
  });

  it("混进适配器侧的输入类型（aspect-ratio）→ BAD_REQUEST 且不落盘", async () => {
    expect(await codeOf(caller().modeContractsSave(contract(["prompt", "aspect-ratio"])))).toBe(
      "BAD_REQUEST",
    );
    expect(contracts.saveModeContracts).not.toHaveBeenCalled();
  });

  it("自定义口只认 text / image / number 三种 kind，且必须带序号", async () => {
    const send = (id: string) =>
      codeOf(
        caller().modeContractsSave({
          contracts: [
            {
              mode: "TXT2IMG",
              inputs: ["prompt"],
              /* SAFETY: 类型断言已复核 */
              output: "image" as const,
              customInputs: [
                {
                  id,
                  label: "参考",
                  /* SAFETY: 类型断言已复核 */
                  kind: "image" as const,
                },
              ],
            },
          ],
        }),
      );
    expect(await send("custom-image-2")).toBe("OK");
    // kind 不在白名单里 —— 下游按 kind 决定控件形态与接受哪一族端口，
    // 放过就是「存进去的口在界面上驱动不起来」。
    expect(await send("custom-audio-1")).toBe("BAD_REQUEST");
    // 缺序号：`custom-<kind>` 不是合法 id 形状（映射表按带序号的 id 存）。
    expect(await send("custom-image")).toBe("BAD_REQUEST");
  });

  it("读取走同一个出口（不在路由里再造一份默认契约）", async () => {
    const res = await caller().modeContractsGet();
    expect(res.contracts).toEqual([{ mode: "TXT2IMG" }]);
    /* 下发两层：成品配置基准（判「已改」）+ 生效注册表（显示 / 编辑）。 */
    expect(res.configured).toEqual([{ mode: "TXT2IMG" }]);
    /* 「保存为项目默认」入口的开关来自服务端判据（isDevCheckout），不是界面猜的
     *（ISSUE #3396）。 */
    expect(res.projectDefaultEditable).toBe(false);
    expect(contracts.isDevCheckout).toHaveBeenCalledTimes(1);
  });

  it("保存为项目默认：整份契约交给服务端差集写回（台账 E3 执行者）", async () => {
    const res = await caller().modeContractsSaveProjectDefaults(
      contract(["prompt", "negative", "size"]),
    );
    expect(contracts.saveModeContractsAsProjectDefaults).toHaveBeenCalledTimes(1);
    expect(res.file).toBe("src/lib/workshop/mode-contract-defaults.json");
  });

  it("还原默认：模式码交给服务端移除覆盖（台账 E3 执行者）", async () => {
    const res = await caller().modeContractReset({ mode: "txt2img" });
    expect(contracts.resetModeContractOverride).toHaveBeenCalledWith("txt2img");
    expect(res.effective).toEqual({ mode: "TXT2IMG", inputs: ["prompt"], output: "image" });
  });
});

describe("workshopAdapters —— 适配器形状与大写归一", () => {
  it("mode 归一成大写后再交给仓储（模式键的大小写只此一处决定）", async () => {
    const save = vi
      .spyOn(remoteModelRepository, "saveWorkshopAdapters")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue([]);
    await caller().workshopAdaptersSave({
      name: "gpt-x",
      adapters: [
        {
          mode: "txt2img",
          endpointPath: "/v1/images",
          inputs: [{ type: "prompt", field: "prompt" }],
        },
      ],
    });
    const passed = save.mock.calls[0]?.[1] ?? [];
    expect(passed[0]?.mode).toBe("TXT2IMG");
    save.mockRestore();
  });

  it("inputs 空数组 / 缺 endpointPath → BAD_REQUEST，不落库", async () => {
    const save = vi.spyOn(remoteModelRepository, "saveWorkshopAdapters");
    expect(
      await codeOf(
        caller().workshopAdaptersSave({
          name: "gpt-x",
          adapters: [{ mode: "img2img", endpointPath: "/x", inputs: [] }],
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });

  it("读取按名字取，不隐式带上全部模型", async () => {
    const get = vi
      .spyOn(remoteModelRepository, "getWorkshopAdapters")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue([]);
    await caller().workshopAdaptersGet({ name: "gpt-x" });
    expect(get).toHaveBeenCalledWith("gpt-x");
    get.mockRestore();
  });
});

describe("configGet —— 脱敏出口", () => {
  it("走 getConfigForClient 取脱敏配置，不顺手加载模式契约", async () => {
    await caller().configGet();
    expect(llmServer.getConfigForClient).toHaveBeenCalledTimes(1);
    expect(contracts.loadModeContractLayers).not.toHaveBeenCalled();
  });
});
