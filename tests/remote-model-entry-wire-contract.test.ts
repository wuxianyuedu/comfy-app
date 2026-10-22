/**
 * 远端模型条目的线上契约（台账 E4 的第五格）：弹窗草稿 → 条目 → `configSave` 入参
 * → 落库 → 脱敏回读，必须是**同一枚模型**走完全程。
 *
 * 这一格修之前的形状是「三个各自自洽的名字」：
 *   · 弹窗草稿的字段叫 `model`（`remoteModelFieldSchema`），
 *   · 条目与库里那一列叫 `name`（`RemoteModelEntry`），
 *   · 而服务端 `configSave` 的入参里，`kind` 是一条**行内字面量枚举**
 *     `z.enum(["chat","image","video"])`，与 lib 里从 `REMOTE_MODEL_KINDS` 派生的那一份
 *     是两个独立真相。
 * 连接它们的是 `submitDialog()` 里手写两遍的 `name: addForm.model`。于是两种失效形态
 * 都不响：往用途词表里加一种（如 `audio`）时，弹窗选得到、条目类型也认（它由同一份词表
 * 派生），而落库那一步被服务端入参的 zod 拒掉 —— 表现是设置页保存时一句英文 zod 原文；
 * 把条目键写成草稿那一侧的 `model` 时更安静 —— 认不出 `name` 就**整条丢弃**，
 * 用户看到的是「刚加的模型没进列表」，而 tsc / eslint / 各份单测全绿
 * （草稿的 interface、controller 的参数形状、路由的入参各写一遍，谁都不引用谁）。
 *
 * 所以这里判四件事：
 *   ① 真草稿经真桥（`remoteModelEntryFromDraft`）产出的条目，被**真 router** 收下，
 *      并原样回读得到 —— 不造「我以为条目长这样」的夹具；
 *   ② `REMOTE_MODEL_KINDS` 里的**每一个**用途都存得进去 —— 这条就是「两份枚举」的
 *      语义判据：服务端那份若是抄的且少一个值，这里红（比 grep 那个字面量强 ——
 *      抄的那一份换任何写法都能骗过 grep，骗不过一次真调用）；
 *   ③ 键名漂移那一形（写 `model`、不写 `name`）被**拒**，且库里确实一行不落 ——
 *      静默丢条目与报错退出是两种完全不同的故障；
 *   ④ `hasApiKey` 是只读视图字段：客户端回写时带着它，**不许**凭空宣布「这条存过密钥」。
 *
 * mock 边界与同族那几份一致：只替内存库、会话与日志；router、仓储、入参 schema、
 * 脱敏回读（`getConfigForClient`）全部真实跑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  remoteModelEntryFromDraft,
  remoteModelEntrySchema,
  type RemoteModelFieldValues,
} from "~/lib/llm/remote-model-schema";
import {
  REMOTE_MODEL_KINDS,
  normalizeExtraModels,
  splitExtraModels,
} from "~/lib/llm/types";
import { createCallerFactory } from "~/server/api/trpc";
import { llmRouter } from "~/server/api/routers/llm";
import { getTestDb } from "./helpers/test-db";
import { makeCtx } from "./helpers/trpc";
import { throughJsonWire } from "./helpers/wire-contract";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createCaller = createCallerFactory(llmRouter);
const tdb = getTestDb();

/** 弹窗里那份**未判过**的表单状态（生产调用点交给桥的就是这一份 —— 字段级判据
 *  只用于「哪一项标红」，不产出值）→ 真桥。缺的键由 `ModelDialogForm` 的初始值补齐。 */
function entryFromDialog(form: Partial<RemoteModelFieldValues> = {}) {
  return remoteModelEntryFromDraft({
    model: "gpt-x",
    baseUrl: "",
    apiKey: "",
    kind: "chat",
    ...form,
  });
}

/** 取回读那一份里的远端条目（本地候选是字符串、远端是对象，两支混在一个数组里）。 */
function remoteEntriesOf(config: unknown): Record<string, unknown>[] {
  const { extraModels } = throughJsonWire<{
    extraModels: Record<string, unknown>[];
  }>(config);
  return extraModels.filter((item) => typeof item === "object");
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
});

describe("远端模型条目 ⇄ configSave 的入参判据", () => {
  it("真草稿经真桥产出的条目，被真 router 收下并原样回读", async () => {
    const entry = entryFromDialog({
      model: " gpt-x ",
      baseUrl: "https://api.example/v1",
      apiKey: "sk-1",
      kind: "image",
    });
    /* `model` → `name` 这一跳现在只有一处，所以这一条断的就是那一处；名字两侧的空也是
     * 桥的责任 —— 调用点交给它的是**没判过**的表单状态（字段级判据只用来标红、不产出值），
     * 而库里那一列按名字唯一：「 gpt-x 」与「gpt-x」会落成两条，工坊又按名字引用模型。 */
    expect(entry.name).toBe("gpt-x");

    const saved = await createCaller(makeCtx()).configSave({
      extraModels: [entry],
    });
    expect(remoteEntriesOf(saved.config)).toEqual([
      {
        name: "gpt-x",
        baseUrl: "https://api.example/v1",
        kind: "image",
        /* 回读只带「存过密钥」这个布尔：明文密钥一律不落客户端（台账 A4）。 */
        hasApiKey: true,
      },
    ]);
  });

  it("用途词表里的每一个值都存得进去（服务端那份不是抄的）", async () => {
    const entries = REMOTE_MODEL_KINDS.map((kind) => ({
      name: `model-${kind}`,
      baseUrl: "https://api.example/v1",
      kind,
    }));
    const saved = await createCaller(makeCtx()).configSave({
      extraModels: entries,
    });
    expect(remoteEntriesOf(saved.config).map((e) => e.kind)).toEqual([
      ...REMOTE_MODEL_KINDS,
    ]);
    /* 同一条 zod 也逐值认（判据与真调用用的是同一份 schema，不是第二份收窄）。 */
    for (const entry of entries) {
      expect(remoteModelEntrySchema.safeParse(entry).success).toBe(true);
    }
  });

  it("键名漂移那一形被拒，且库里一行都不落（静默丢条目不是退化方案）", async () => {
    /* 把条目写成草稿那一侧的键名 —— 「两边各写一份、中间手写桥接」最典型的事故形状：
     * 它不会编译红，只会让用户刚加的模型没进列表。 */
    const drifted = { model: "gpt-x", baseUrl: "https://api.example/v1" };
    await expect(
      createCaller(makeCtx()).configSave({ extraModels: [drifted as never] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(tdb.$tables.remoteModels).toHaveLength(0);
  });

  it("`hasApiKey` 是只读视图字段：客户端带着它回写，不凭空长出密钥", async () => {
    const base = entryFromDialog({ baseUrl: "https://api.example/v1" });
    /* 第一遍：真的没给密钥。 */
    await createCaller(makeCtx()).configSave({ extraModels: [base] });
    /* 第二遍：把服务端下发的脱敏条目原样回灌，并把 `hasApiKey` 改成 true ——
     * 那一位是**视图字段**，入参判据不收它，于是回读必须还是 false。
     * 允许客户端替服务端宣布「这条存过密钥」，等于把脱敏那半边交回给客户端。
     * 用 `Object.assign` 而不是字面量：这一条**就是要**发一个判据没声明的键，
     * 而 TS 的多余属性检查只打在新鲜字面量上（打在那儿就成了测编译器）。 */
    const echoed = Object.assign({ ...base }, { hasApiKey: true });
    const saved = await createCaller(makeCtx()).configSave({
      extraModels: [echoed],
    });
    expect(remoteEntriesOf(saved.config)[0]).toMatchObject({
      name: "gpt-x",
      hasApiKey: false,
    });
    expect(remoteEntriesOf(saved.config)[0]).not.toHaveProperty("apiKey");
  });

  it("留空的两个字段各自落回既有口径：接口跟随全局、密钥不提供意见", () => {
    const entry = entryFromDialog({ baseUrl: "   ", apiKey: "" });
    /* `apiKey` 空白 = 不给这一项**意见**（不是「清空」）：写入侧据此保留库里既有值，
     * 而设置页每次保存都是整份覆盖（台账 A11 的成因就是把三态压成两态）。 */
    expect(entry.apiKey).toBeUndefined();
    /* 空白接口折成 `null` —— 新增与编辑在这一条上本来就同形（写入侧都落「跟随全局」）。 */
    expect(entry.baseUrl).toBeNull();
  });

  it("读边界与入参判据对同一枚合法条目给同样的字段", () => {
    /* 这一条买的是「加一列时两边一起红」：`normalizeExtraModelItem`（库里那一列的读边界，
     * `normalizeExtraModels` 与 `splitExtraModels` 现在共用它）与 `remoteModelEntrySchema`
     *（请求能不能收下）读的是同一枚条目的同一批键。读边界哪天漏归一一个新字段，
     * 这里就是「判据收了、读出来没有」那种不对称 —— 而那种不对称今天的表现是
     * 「保存成功了但列表里看不到」。 */
    const valid = [
      entryFromDialog({
        baseUrl: "https://api.example/v1",
        apiKey: "sk-1",
        kind: "video",
      }),
      entryFromDialog({ model: "ollama-名-带-空格" }),
    ];
    for (const item of valid) {
      const parsed = remoteModelEntrySchema.parse(item);
      expect(normalizeExtraModels([parsed])).toEqual([parsed]);
      /* 拆分管线（设置页保存那条）也必须给同一份 —— 它过去是同一逻辑的第二份实现。 */
      const split = splitExtraModels([parsed]);
      expect(split.remoteEntries).toEqual([parsed]);
      expect(split.localNames).toEqual([]);
    }
  });

  it("认不出的用途：入参拒收、读边界落 null 并留住整条（这是两个角色的分界）", () => {
    /* 上面那条判的是「合法条目两边同读数」，这一条判的是**刻意不同**的那一半：
     * 请求里带一个词表外的用途应当当场拒（那是客户端拼错了）；而库里已经存着一行
     * 词表外的用途时，读边界必须把整条留着、把这一列折成 `null` —— 历史上写坏一列
     * 不该让一个模型从列表里消失。两处如果哪天并成一份，红会出现在这里。 */
    const drifted = {
      name: "gpt-x",
      baseUrl: "https://api.example/v1",
      kind: "audio",
    };
    expect(remoteModelEntrySchema.safeParse(drifted).success).toBe(false);
    expect(normalizeExtraModels([drifted])).toEqual([
      {
        name: "gpt-x",
        baseUrl: "https://api.example/v1",
        kind: null,
      },
    ]);
  });
});
