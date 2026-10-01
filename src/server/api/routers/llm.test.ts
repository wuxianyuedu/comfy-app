/**
 * llm.router 的闸门用例（体检清单 ⑨ 第二刀）。
 *
 * 这一层此前**没有执行者**：脱敏与密钥三态的判决在 `lib/llm/server` 与
 * `repository.test.ts` 里判着，而「请求方给的东西能不能走到写库那一步」的
 * router 层 zod 闸一条都没钉 —— 台账 A 系列几批复算的共同结论就是：
 * 「一个 router 没有执行者」的实际含义是「它的闸门坏了没人红」。这里按闸门组织：
 *
 *   · **地址闸**（A5 同族）：`baseUrl` 只许 http/https，非法值必须在 `upsertSingleton`
 *     之前挡下 —— 写进库的地址会被服务端拿去发请求，那是 SSRF 的入口；
 *   · **枚举闸**（`provider` / `taskType` / 契约口 id）：静默回退比报错更坏
 *     （旧代码把垃圾 provider 按 local 误路由）；
 *   · **候选清单的拆分**：字符串 = 本地 ollama 候选、对象 = 远端模型，两类不能混存。
 *     没给 `extraModels` 时必须是 `undefined` 一路透传（「这次不给意见」），
 *     一旦路由层把它折成空数组，就等于替用户清空全部远端模型 —— 与 A11 同族的数据丢失。
 *
 * mock 边界：`~/server/db`（内存库，`as never` 那类形状错误会当场现形）、
 * `~/lib/llm/server`（会真发 LLM 请求）、`~/lib/workshop/mode-contract.server`（会读写
 * `data/workshop-mode-contracts.json`）、仓储的两个写口用 spy 记账但保留真实现、
 * `~/server/better-auth`、`~/lib/core/logger`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmServer, contracts } = vi.hoisted(() => ({
  llmServer: {
    getLLMConfig: vi.fn(async (o: unknown) => ({ marker: "cfg", input: o })),
    completeLLM: vi.fn(
      async (_cfg: unknown, messages: unknown[]) => `echo:${messages.length}`,
    ),
    ensureRemoteStorageMigrated: vi.fn(async () => undefined),
    getConfigForClient: vi.fn(async () => ({
      provider: "remote",
      hasApiKey: true,
    })),
  },
  contracts: {
    loadModeContracts: vi.fn(async () => [{ mode: "TXT2IMG" }]),
    saveModeContracts: vi.fn(async (c: unknown) => c),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/llm/server", () => ({
  getLLMConfig: llmServer.getLLMConfig,
  completeLLM: llmServer.completeLLM,
  ensureRemoteStorageMigrated: llmServer.ensureRemoteStorageMigrated,
  getConfigForClient: llmServer.getConfigForClient,
}));
vi.mock("~/lib/workshop/mode-contract.server", () => ({
  loadModeContracts: contracts.loadModeContracts,
  saveModeContracts: contracts.saveModeContracts,
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
  llmConfigRepository,
  remoteModelRepository,
} from "~/lib/core/repository";
import { llmRouter } from "~/server/api/routers/llm";
import { getTestDb, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(llmRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (e: { code?: string }) => e?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
});

describe("configSave —— 写库之前的地址与枚举闸", () => {
  it("baseUrl 走非 http(s) 协议 → BAD_REQUEST，且一个字都不写库", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://",
      "not-a-url",
    ]) {
      expect(await codeOf(caller().configSave({ baseUrl: bad }))).toBe(
        "BAD_REQUEST",
      );
    }
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRestore();
  });

  it("大写协议与正常回环地址放行（别把合法值误拒成「配置保存不了」）", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      .mockResolvedValue(undefined as never);
    expect(
      await codeOf(caller().configSave({ baseUrl: "HTTPS://x.example" })),
    ).toBe("OK");
    expect(
      await codeOf(
        caller().configSave({ baseUrl: "http://127.0.0.1:11434/v1" }),
      ),
    ).toBe("OK");
    expect(upsert).toHaveBeenCalledTimes(2);
    upsert.mockRestore();
  });

  it("provider 不在枚举里 → BAD_REQUEST（旧写法会静默按 local 误路由）", async () => {
    const upsert = vi.spyOn(llmConfigRepository, "upsertSingleton");
    expect(
      await codeOf(caller().configSave({ provider: "azure" as never })),
    ).toBe("BAD_REQUEST");
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRestore();
  });

  it("候选清单按类型拆开：字符串进本地候选、对象进远端表", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      .mockResolvedValue(undefined as never);
    const replace = vi
      .spyOn(remoteModelRepository, "replaceAll")
      .mockResolvedValue(undefined as never);
    await caller().configSave({
      extraModels: [
        "llama3",
        { name: "gpt-x", baseUrl: "https://api.example/v1", apiKey: "k" },
      ],
    });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      extraModels: ["llama3"],
    });
    expect(replace.mock.calls[0]?.[0]).toMatchObject([
      { name: "gpt-x", baseUrl: "https://api.example/v1", apiKey: "k" },
    ]);
    upsert.mockRestore();
    replace.mockRestore();
  });

  it("没给 extraModels 时透传 undefined —— 不是空数组（折成空数组=替用户清空远端模型，A11 同族）", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      .mockResolvedValue(undefined as never);
    const replace = vi.spyOn(remoteModelRepository, "replaceAll");
    await caller().configSave({ model: "m1" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ extraModels: undefined });
    expect(replace).not.toHaveBeenCalled();
    upsert.mockRestore();
    replace.mockRestore();
  });

  it("回传的是脱敏后的配置，路由不自己拼一份", async () => {
    const upsert = vi
      .spyOn(llmConfigRepository, "upsertSingleton")
      .mockResolvedValue(undefined as never);
    const res = await caller().configSave({ model: "m1" });
    expect(res.config).toEqual({ provider: "remote", hasApiKey: true });
    upsert.mockRestore();
  });
});

describe("complete —— 参数闸与透传", () => {
  it("provider / taskType 非法 → BAD_REQUEST，且不发起补全", async () => {
    expect(
      await codeOf(
        caller().complete({
          messages: [{ role: "user", content: "hi" }],
          provider: "bedrock" as never,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(
        caller().complete({
          messages: [{ role: "user", content: "hi" }],
          taskType: "translate" as never,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(llmServer.completeLLM).not.toHaveBeenCalled();
  });

  it("role 只许 system / user / assistant", async () => {
    expect(
      await codeOf(
        caller().complete({
          messages: [{ role: "tool" as never, content: "x" }],
        }),
      ),
    ).toBe("BAD_REQUEST");
  });

  it("合法请求把温度 / 任务类型交给配置解析，再原样把消息交给补全", async () => {
    const res = await caller().complete({
      messages: [{ role: "user", content: "hi" }],
      provider: "remote",
      temperature: 0.4,
      taskType: "chat",
    });
    expect(llmServer.getLLMConfig).toHaveBeenCalledWith({
      provider: "remote",
      model: undefined,
      temperature: 0.4,
      maxTokens: undefined,
      taskType: "chat",
    });
    expect(res.content).toBe("echo:1");
  });
});

describe("modeContracts —— 契约口 id 的类型守卫", () => {
  const contract = (inputs: string[]) => ({
    contracts: [{ mode: "TXT2IMG", inputs, output: "image" as const }],
  });

  it("契约口合法集合通过并原样交给存储层", async () => {
    await caller().modeContractsSave(
      contract(["prompt", "negative", "size", "reference-image-2"]),
    );
    expect(contracts.saveModeContracts).toHaveBeenCalledTimes(1);
  });

  it("混进适配器侧的输入类型（aspect-ratio）→ BAD_REQUEST 且不落盘", async () => {
    expect(
      await codeOf(
        caller().modeContractsSave(contract(["prompt", "aspect-ratio"])),
      ),
    ).toBe("BAD_REQUEST");
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
              output: "image" as const,
              customInputs: [{ id, label: "参考", kind: "image" as const }],
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
  });
});

describe("workshopAdapters —— 适配器形状与大写归一", () => {
  it("mode 归一成大写后再交给仓储（模式键的大小写只此一处决定）", async () => {
    const save = vi
      .spyOn(remoteModelRepository, "saveWorkshopAdapters")
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
    const passed = save.mock.calls[0]?.[1] as { mode: string }[];
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
      .mockResolvedValue([] as never);
    await caller().workshopAdaptersGet({ name: "gpt-x" });
    expect(get).toHaveBeenCalledWith("gpt-x");
    get.mockRestore();
  });
});

describe("configGet —— 迁移与脱敏出口的先后", () => {
  it("先确保远端存储迁移过，再取脱敏配置（顺序反了老库会读到缺列）", async () => {
    await caller().configGet();
    expect(llmServer.ensureRemoteStorageMigrated).toHaveBeenCalledTimes(1);
    expect(llmServer.getConfigForClient).toHaveBeenCalledTimes(1);
    expect(contracts.loadModeContracts).not.toHaveBeenCalled();
  });
});
