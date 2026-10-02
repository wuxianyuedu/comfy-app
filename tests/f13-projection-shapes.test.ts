/**
 * 「调用点的形状错误不许被咽掉」判据（台账 F13）。
 *
 * 起因是一次 Prisma→Drizzle 迁移：仓储的投影参数被写成 `select?: unknown`，
 * 交给 Drizzle 时又写 `db.select(select as never)`。于是调用点留着 Prisma 的
 * 布尔投影（`{ id: true, status: true }`）时 **tsc 一声不响**，运行时生成空投影
 * → SQL 语法错 —— `train.cancel` 从那次迁移起**每次都 500**，而那条 procedure
 * 当时零执行者，所以没有任何一条红过。
 *
 * 同一族的第二处（本批一起修）：`workflowTemplateRepository.findByIdForUserSelect(userId, id, _select?: unknown)`
 * —— 参数名承诺投影，实现里是 `select()` 全列取，三个调用点还在传 Prisma 形状的
 * `{ id: true, rawJson: true, … }`。这一支的后果是性能而不是 500：详情加载每次
 * 都把 `rawJson` 与 `positions` 两个大 JSON blob 整行拖出来。
 *
 * 三条判据都是**形状**而不是语义 —— 它们抓的是「编译器被叫停」这个动作本身：
 *  · `as never` 出现在非测试源码里 = 写的人在对 tsc 说「这里别查我」。它偶尔是对的
 *    （转发第三方 API 的签名时确实要给个交代），所以不是一刀切禁用，而是
 *    **逐处登记 + 写清为什么**；新增一条未登记的即红，登记的那处不存在了也红
 *    （`as never` 消失了却不删登记 = 这张表失去记账能力）。
 *  · 投影类参数（名字含 select / projection / columns）的类型不许是 `unknown` / `any`。
 *  · `.select(… as never)` 这一整个形状不许出现（它就是当年那句）。
 * 另加一条仓库层的：`src/lib/core/repository-*.ts` 的签名里不许有以 `_` 开头的参数 ——
 * 那条下划线正是「我知道它没人用，但我不想删」的写法，也就是空气参数的来源。
 *
 * 已知边界（不假装没有）：
 *  · 形状判据抓不到「类型是对的但语义错了」；那一半由执行者维度与逐入口用例负责
 *    （`tests/trpc-surface-executors.test.ts`）。
 *  · 登记表按**文件 + 该文件内的出现次数**记账，不按行号 —— 行号会在无关改动里漂，
 *    漂了的登记项等于一张对不上账的表。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

/** `as never` 的逐处登记：文件 → `{ 次数, 为什么 } }`。
 *
 *  要加一条进来，先答「为什么不能改成把类型收对」—— 本批刚把三处改掉了：
 *  LLM 回来的景别在**解析边界**用 `normalizeShotType` 收进清单（那里原本是
 *  `s.shotType as never`，等于「模型说什么存什么」）；仓储的投影参数改成了真列清单。
 *  剩下这两类是签名桥接，最后一类是真欠账（F13′）。 */
const AS_NEVER_LEDGER: Record<string, { count: number; reason: string }> = {
  "src/lib/core/logger.ts": {
    count: 1,
    reason:
      "转发原生 console 方法：`method.apply(this, args)` 的 args 是 unknown[]，原生 Console 的重载不收 —— 这里是「对齐第三方签名」，不是「绕过一个我们该做的检查」。",
  },
  "src/lib/log/capture-streams.server.ts": {
    count: 2,
    reason:
      "覆写 stream.write 时把 encoding/callback 两形参转交原实现，同一个「对齐第三方签名」的桥接（Node 的 write 重载在 TS 里收成 never 才通得过）。",
  },
};

/** 递归收集 `src/**` 的非测试 `.ts` / `.tsx`。 */
function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSource(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(full);
  }
  return out;
}

const files = collectSource(path.join(process.cwd(), "src")).map((f) => {
  const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
  return { rel, text: stripComments(readFileSync(f, "utf8")) };
});

const AS_NEVER = /\bas never\b/g;
/** 投影类参数被写成 unknown / any（函数签名与对象字面量里都算）。 */
const UNKNOWN_PROJECTION =
  /[{,(]\s*\w*(?:select|projection|columns)\w*\??\s*:\s*(?:unknown|any)\b/gi;
/** 当年那一整句：把 unknown 压成 never 喂给 Drizzle 的 select。 */
const SELECT_AS_NEVER = /\.select\([^)]*\bas never\b/g;
/** 仓储签名里的下划线参数（「我知道没人用」的写法）。 */
/** MCP 工具入参里的「什么都收」：`z.any()` 使整个边界没有校验。 */
const MCP_ANY = /\bz\.any\s*\(/g;

const UNDERSCORE_PARAM = /[(,]\s*_\w+\??\s*:/g;

describe("F13：形状判据不许把「调用点写错了」咽掉", () => {
  it("扫描面本身不是空的（判据不许在空输入上假绿）", () => {
    expect(files.length).toBeGreaterThan(400);
    // 登记表里登记的文件必须真的在扫描面里 —— 否则这张表已经对不上账了
    for (const rel of Object.keys(AS_NEVER_LEDGER)) {
      expect(
        files.some((f) => f.rel === rel),
        rel,
      ).toBe(true);
    }
  });

  it("每一处 as never 都要登记，且登记的数量要准", () => {
    const found = new Map<string, number>();
    for (const { rel, text } of files) {
      const n = text.match(AS_NEVER)?.length ?? 0;
      if (n > 0) found.set(rel, n);
    }
    const unregistered = [...found.entries()]
      .filter(([rel]) => !AS_NEVER_LEDGER[rel])
      .map(([rel, n]) => `${rel} ×${n}`);
    const stale = Object.entries(AS_NEVER_LEDGER)
      .filter(([rel, entry]) => found.get(rel) !== entry.count)
      .map(
        ([rel, entry]) =>
          `${rel}（登记 ${entry.count}，实际 ${found.get(rel) ?? 0}）`,
      );
    expect(
      unregistered,
      "新增的 as never：改掉它，或登记「为什么改不掉」",
    ).toEqual([]);
    expect(
      stale,
      "登记表与实际不符：删掉或改数字（数字变了通常是好事）",
    ).toEqual([]);
  });

  it("每条登记都写着「为什么」", () => {
    for (const [rel, entry] of Object.entries(AS_NEVER_LEDGER))
      expect(entry.reason.length, `${rel} 的理由是空的`).toBeGreaterThan(20);
  });

  it("投影类参数不许是 unknown / any，也不许出现 .select(… as never)", () => {
    const hits: string[] = [];
    for (const { rel, text } of files) {
      for (const m of text.matchAll(UNKNOWN_PROJECTION))
        hits.push(`${rel} → ${m[0].trim()}`);
      for (const m of text.matchAll(SELECT_AS_NEVER))
        hits.push(`${rel} → ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("仓储层签名里不许有以 _ 开头的参数（空气能力的来源）", () => {
    const hits: string[] = [];
    for (const { rel, text } of files) {
      if (!/src\/lib\/core\/repository[^/]*\.ts$/.test(rel)) continue;
      for (const m of text.matchAll(UNDERSCORE_PARAM))
        hits.push(`${rel} → ${m[0].trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it("MCP 工具的入参 schema 里不许出现 z.any()（外部可控输入的最后一道闸）", () => {
    /* 这扇门能整幅覆盖草稿的角色卡与分镜并落库，所以它是 `as never` 最该被拦住的地方：
     * `z.array(z.any())` + `as never` 一叠，形状检查就整个消失了（台账 F13′ 的原始形态）。
     * 契约本体在 `~/lib/workshop/types` 的写侧那一段，MCP 侧只引用它。 */
    const mcpFiles = files.filter((f) => f.rel.startsWith("src/server/mcp/"));
    expect(
      mcpFiles.length,
      "MCP 面一个文件都没扫到 = 这条判据是空的",
    ).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const { rel, text } of mcpFiles) {
      for (const m of text.matchAll(MCP_ANY)) hits.push(`${rel} → ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("判据自身可反证：三种被禁形状都要能照出来，登记与注释不算数", () => {
    const probe = (source: string) => ({
      asNever: (source.match(AS_NEVER) ?? []).length,
      unknownProjection: (source.match(UNKNOWN_PROJECTION) ?? []).length,
      selectAsNever: (source.match(SELECT_AS_NEVER) ?? []).length,
      underscore: (source.match(UNDERSCORE_PARAM) ?? []).length,
      mcpAny: (source.match(MCP_ANY) ?? []).length,
    });
    // 当年那一整句，三个计数一起命中
    const original = probe(
      "async cancel(id: string, select?: unknown) {\n  return db.select(select as never).from(t);\n}",
    );
    expect(original.unknownProjection).toBe(1);
    expect(original.selectAsNever).toBe(1);
    expect(original.asNever).toBe(1);
    // 空气参数
    expect(
      probe(
        "async findByIdForUserSelect(userId: string, id: string, _select?: unknown) {",
      ).underscore,
    ).toBe(1);
    // MCP 面的「什么都收」：合成一份必须照得出来（照不出的那条判据是装饰）
    expect(
      probe('characters: z.array(z.any()).describe("Character 数组")').mcpAny,
    ).toBe(1);
    // 只有注释里出现 → 剥完注释就不该照到（否则每次引用事故都会红）
    expect(
      probe(stripComments("// db.select(select as never) 这句已经删了"))
        .asNever,
    ).toBe(0);
  });
});
