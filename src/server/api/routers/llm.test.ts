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
    loadModeContracts: vi.fn(() => [{ mode: "TXT2IMG" }]),
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
  loadModeContracts: contracts.loadModeContracts,
  saveModeContracts: contracts.saveModeContracts,
  isDevCheckout: contracts.isDevCheckout,
  saveModeContractsAsProjectDefaults: contracts.saveModeContractsAsProjectDefaults,
  resetModeContractOverride: contracts.resetModeContractOverride,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { llmConfigRepository, remoteModelRepository } from "~/lib/core/repository";
import { llmRouter } from "~/server/api/routers/llm";
import { getTestDb, seedRemoteModel, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(llmRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- rejection 值是外部抛出的任意值，回调参数按 { code? } 标窄，`?.` 是运行期防线
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
      .mockResolvedValue(undefined as never);
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
          /* SAFETY: 类型断言已复核 */
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
      .mockResolvedValue(undefined as never);
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
    expect(String(rows[0]!.apiKey).startsWith("enc:v1:")).toBe(true);
    upsert.mockRestore();
  });

  it("没给 extraModels 时透传 undefined —— 不是空数组（折成空数组=替用户清空远端模型，A11 同族）", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue(undefined as never);
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
      .mockResolvedValue(undefined as never);
    const res = await caller().configSave({ model: "m1" });
    expect(res.config).toEqual({ provider: "remote", hasApiKey: true });
    upsert.mockRestore();
  });

  it("temperatureByTask 的任务类型不在枚举里 → BAD_REQUEST，且落库前就挡下", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    expect(
      await codeOf(
        caller().configSave({
          /* SAFETY: 类型断言已复核 */
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
      .mockResolvedValue([] as never);
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
    /* SAFETY: 类型断言已复核 */
    const passed = save.mock.calls[0]?.[1] as Array<{
      mode: string;
    }>;
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
      .mockResolvedValue([] as never);
    await caller().workshopAdaptersGet({ name: "gpt-x" });
    expect(get).toHaveBeenCalledWith("gpt-x");
    get.mockRestore();
  });
});

describe("configGet —— 脱敏出口", () => {
  it("走 getConfigForClient 取脱敏配置，不顺手加载模式契约", async () => {
    await caller().configGet();
    expect(llmServer.getConfigForClient).toHaveBeenCalledTimes(1);
    expect(contracts.loadModeContracts).not.toHaveBeenCalled();
  });
});
