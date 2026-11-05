/**
 * skill.router 闸门用例（⑨ 第三刀第二半）：技能表是全局的（`slug` 唯一，无 userId），没有 IDOR，判另外三件事 ——
 * 重名必须 `CONFLICT` 而非 500（旧写法裸 `throw new Error(...)`，界面像崩了）；形状闸在落库前（`slug` 只许 `[a-z0-9-]`，被拒时不查库）；
 * 列表三个默认值：未激活默认不出现（`all` 放开）、搜索串先 `trim`、分类标签未登记回退成分类名（坏了就是 `undefined`）。mock：db（真 Drizzle，`slug` 唯一索引真在拦）、better-auth、logger。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { createCallerFactory } from "~/server/api/trpc";
import { skillRepository } from "~/lib/core/repository";
import { BUILTIN_SKILLS } from "~/lib/skills-seed";
import { skillRouter } from "~/server/api/routers/skill";
import { getTestDb, seedUser, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(skillRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

async function envelope(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => "OK",
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- rejection 值是外部抛出的任意值，回调参数按 { code? } 标窄，`?.` 是运行期防线
    (error: { code?: string }) => error?.code ?? "UNKNOWN",
  );
}

const newSkill = (over: Record<string, unknown> = {}) => ({
  name: "我的技能",
  slug: "my-skill",
  description: "一句说明",
  promptTemplate: "把 {{prompt}} 画成插画",
  ...over,
});

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
});

describe("skill.list —— 内置补齐与三个默认值", () => {
  it("首次读取就把内置技能补齐，并给出按分类的计数", async () => {
    const res = await caller().list();
    expect(res.skills.length).toBeGreaterThan(0);
    expect(res.categories.length).toBeGreaterThan(0);
    // 第二次不再重复插入（幂等）：行数不因多次读取而涨
    const again = await caller().list();
    expect(again.skills.length).toBe(res.skills.length);
  });

  it("没在标签表里登记过的分类，展示名回退成分类本身（不是 undefined）", async () => {
    await caller().create(newSkill({ slug: "odd-cat", category: "自定分类" }));
    const res = await caller().list();
    const odd = res.categories.find((c) => c.id === "自定分类");
    expect(odd?.label).toBe("自定分类");
  });

  it("搜索串先 trim 再传下去（带空格的输入框不该把空串当成有效关键词）", async () => {
    const list = vi.spyOn(skillRepository, "list").mockResolvedValue([]);
    await caller().list({ q: "  插画  " });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ q: "插画" });
    list.mockRestore();
  });

  it("默认排除停用项，`all: true` 才放开", async () => {
    const list = vi.spyOn(skillRepository, "list").mockResolvedValue([]);
    await caller().list();
    expect(list.mock.calls[0]?.[0]).toMatchObject({ includeInactive: false });
    await caller().list({ all: true });
    expect(list.mock.calls[1]?.[0]).toMatchObject({ includeInactive: true });
    list.mockRestore();
  });
});

describe("skill.create —— 重名的码与形状闸", () => {
  it("slug 撞车 → CONFLICT，且不覆盖已有的那一行", async () => {
    await caller().create(newSkill());
    expect(await envelope(caller().create(newSkill({ name: "改掉它" })))).toBe("CONFLICT");
    const row = await skillRepository.findBySlug("my-skill");
    expect(row?.name).toBe("我的技能");
  });

  it("内置技能的 slug 也算占用（用户不能覆盖内置项）", async () => {
    // 从种子常量取 slug，而不是从 list 的结果里摸 —— 后者的形状是
    // `{...Record<string,unknown>, tags}`，属性名在类型上不可见（判不了就得 cast）。
    const taken = BUILTIN_SKILLS[0]?.slug;
    expect(taken).toBeTruthy();
    await caller().list(); // 先让内置补齐落库
    expect(
      await envelope(
        caller().create(newSkill({ slug: taken, name: "覆盖内置", description: "x" })),
      ),
    ).toBe("CONFLICT");
    expect((await skillRepository.findBySlug(String(taken)))?.name).not.toBe("覆盖内置");
  });

  it("slug 带大写或空格 → BAD_REQUEST，且一次数据库都不查", async () => {
    const find = vi.spyOn(skillRepository, "findBySlug");
    for (const bad of ["My-Skill", "有中文", "a b", ""]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      expect(await envelope(caller().create(newSkill({ slug: bad })))).toBe("BAD_REQUEST");
    }
    expect(find).not.toHaveBeenCalled();
    find.mockRestore();
  });

  it("成功创建：zod 的默认值把 tags 补成空数组、sortOrder 补成 0", async () => {
    const res = await caller().create(newSkill({ slug: "fresh-one" }));
    const row = await skillRepository.findBySlug("fresh-one");
    expect(row).not.toBeNull();
    expect(res.skill.slug).toBe("fresh-one");
    expect(JSON.parse(String(row?.tags ?? "[]"))).toEqual([]);
    expect(row?.sortOrder).toBe(0);
  });
});
