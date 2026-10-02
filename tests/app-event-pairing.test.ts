/**
 * `AppEvents` 表里每一条事件**两端都得在场** —— 有派发方，也有订阅方。
 *
 * ## 为什么这一条值得机械化
 *
 * `~/lib/app-events` 把「事件名与载荷类型定义在同一行」已经做完了，但它管不到
 * **有没有人用这一行**。而事件通道的两种坏掉方式全都是静默的：
 *
 *   · **派发方没了、监听器还挂着** —— 表现是「界面该刷新的时候没刷新」。
 *     没有任何构建、测试会报它；注释还会继续写着「某某按钮通过它请求打开详情」，
 *     于是下一个读代码的人顺着这句话去找按钮，找不到，然后以为是自己看错了。
 *   · **订阅方没了、广播还在发** —— 比第一种更隐蔽：`refreshCustomNodes()` 曾经
 *     每次解析完都发一条 `custom-nodes:updated`，而它的订阅侧（画布的添加节点
 *     菜单）早已不在库里。代码照常执行、事件照常派发、什么都没发生。
 *
 * 装机时实测到的存量正是这两类的三个实例（`open-task` 与
 * `comfyapp:local-workflows-path-changed` 只有订阅，`custom-nodes:updated` 只有派发），
 * 三处都逐条处置在同一次提交里：死端删除、欠账记进台账 E9。
 *
 * ## 口径
 *
 * - **测试文件不算任何一端**。「只有用例在调的口」不等于安全，是「可以烂掉而没人红」
 *   —— 口径同 E3′ 的消费方维度（`tests/trpc-surface-executors.test.ts`）。
 * - **认两种写法**：`emitAppEvent("a:b", …)` 的字面量形态，以及
 *   `emitAppEvent(SOME_CONST, …)` 的常量间接形态（先在全库把
 *   `const SOME_CONST = "a:b"` 解成名字再比）。只认字面量会误报后者 ——
 *   而误报一片的判据会被当噪音关掉，那比没有判据更糟。
 * - **`app-events` 自己不算端**：那是定义处。
 * - 先过 `stripComments`：注释里举例提到某个事件名不是派发。
 *
 * ## 与既有判据的分工（§12.18：新增守卫前先查有没有更强的一条）
 *
 * P61（`scripts/check-ui-primitives.cjs`）管的是**反方向**：不许绕过出口裸写
 * `new CustomEvent("…")` / `addEventListener("a:b")`。两条判据不重叠，
 * 也不该合并 —— 一条查「有没有走出口」，一条查「出口两端齐不齐」。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const TABLE_FILE = "src/lib/app-events.ts";

interface SourceFile {
  /** 相对仓库根、正斜杠的路径（断言消息里要能直接点开）。 */
  rel: string;
  /** 已经剥掉注释的源码。 */
  text: string;
}

function collectSources(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        /* 只跳这两类：`generated` 在本仓库是**产物根**的名字，
         * 别处抄来的「跳过名为 generated 的目录」会把真源文件一起摘掉
         * （同一份扫描工具在不同目录语义不同，实测踩过一次）。 */
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\./.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      /* 定义处不算任何一端：它的类型注释里会写出每个事件名。 */
      if (rel === TABLE_FILE) continue;
      out.push({ rel, text: fs.readFileSync(abs, "utf8") });
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/** 表里的事件名（键带引号或不带引号都认）。 */
function readEventTable(source: string): string[] {
  const start = source.indexOf("export interface AppEvents");
  if (start < 0) return [];
  const block = source.slice(start, source.indexOf("\n}", start));
  const names: string[] = [];
  for (const match of block.matchAll(
    /^\s{2}(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm,
  )) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }
  return names;
}

/**
 * `const NAME = "事件名"` 的解引用表。
 *
 * 派发侧完全可以传常量（库里就有一处这么写），只认字面量的判据会把它判成「没派发」。
 */
function readNameConstants(sources: SourceFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of sources) {
    for (const match of file.text.matchAll(
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*"([^"]+)"/g,
    )) {
      const identifier = match[1];
      const name = match[2];
      if (identifier && name) map.set(identifier, name);
    }
  }
  return map;
}

/**
 * 把一次调用的首个实参解析成事件名。
 *
 * 字面量形态（正则的第 1 组）拿到的**已经不带引号**，直接就是名字；
 * 标识符形态（第 2 组）要过一遍常量表。解不出名字的那些（来自 `pickKey()` 这类
 * 别处的值）返回 null —— 不许算成端，否则「把事件名塞进变量再随便传」
 * 就绕开了整条判据。
 */
function resolveEventName(
  literal: string | undefined,
  identifier: string | undefined,
  names: Map<string, string>,
): string | null {
  if (literal !== undefined) return literal;
  if (identifier === undefined) return null;
  return names.get(identifier) ?? null;
}

/** 扫出一份源码里两处调用的事件名。 */
function sidesOf(
  file: SourceFile,
  names: Map<string, string>,
): { emitted: string[]; subscribed: string[] } {
  const emitted: string[] = [];
  const subscribed: string[] = [];
  for (const [fn, bucket] of [
    ["emitAppEvent", emitted],
    ["subscribeAppEvent", subscribed],
  ] as const) {
    for (const match of file.text.matchAll(
      new RegExp(`\\b${fn}\\s*\\(\\s*(?:"([^"]+)"|([A-Za-z_$][\\w$]*))`, "g"),
    )) {
      const name = resolveEventName(match[1], match[2], names);
      if (name) bucket.push(name);
    }
  }
  return { emitted, subscribed };
}

interface PairingRow {
  event: string;
  emitters: string[];
  subscribers: string[];
}

function judge(sources: SourceFile[], tableSource: string): PairingRow[] {
  /* 剥注释这一步放在 `judge` 里面而不是采集时：真实扫描与合成反证必须吃同一条
   * 口径，否则「注释里提到某个事件名不算端」这条承诺只是文件头的一句话，
   * 没有任何东西保证它真的生效。 */
  const clean = sources.map((file) => ({
    rel: file.rel,
    text: stripComments(file.text),
  }));
  const names = readNameConstants(clean);
  const table = readEventTable(stripComments(tableSource));
  const emitters = new Map<string, string[]>();
  const subscribers = new Map<string, string[]>();
  for (const file of clean) {
    const sides = sidesOf(file, names);
    for (const event of sides.emitted) {
      emitters.set(event, [...(emitters.get(event) ?? []), file.rel]);
    }
    for (const event of sides.subscribed) {
      subscribers.set(event, [...(subscribers.get(event) ?? []), file.rel]);
    }
  }
  return table.map((event) => ({
    event,
    emitters: emitters.get(event) ?? [],
    subscribers: subscribers.get(event) ?? [],
  }));
}

describe("AppEvents 表的两端成对", () => {
  const sources = collectSources();
  const tableSource = fs.readFileSync(path.join(ROOT, TABLE_FILE), "utf8");
  const rows = judge(sources, tableSource);

  it("扫描面非空、表也非空（清单自己静默失效时「零命中」长得像「都齐了」）", () => {
    expect(sources.length).toBeGreaterThan(400);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    /* 定义处确实被排除了：它自己的类型注释里写着每一个事件名，
     * 算进来会让「每条都有订阅方」恒真。 */
    expect(sources.some((file) => file.rel === TABLE_FILE)).toBe(false);
  });

  it("每一条既有派发方又有订阅方", () => {
    const broken = rows.filter(
      (row) => row.emitters.length === 0 || row.subscribers.length === 0,
    );
    expect(
      broken.map(
        (row) =>
          `${row.event} → 派发 ${row.emitters.length} 处 / 订阅 ${row.subscribers.length} 处`,
      ),
    ).toEqual([]);
  });

  it("反向证明：只剩一端的通道会被点名，两端都在的不报", () => {
    const table = [
      "export interface AppEvents {",
      '  "only:emit": undefined;',
      '  "only:subscribe": { id: string };',
      '  "both:ways": undefined;',
      "}",
    ].join("\n");
    const synthetic: SourceFile[] = [
      {
        rel: "virtual/a.ts",
        /* 常量间接形态也必须认到：`ONLY_EMIT_EVENT` 解成 `only:emit`。 */
        text: [
          'const ONLY_EMIT_EVENT = "only:emit";',
          "emitAppEvent(ONLY_EMIT_EVENT);",
          'emitAppEvent("both:ways");',
        ].join("\n"),
      },
      {
        rel: "virtual/b.ts",
        text: [
          'subscribeAppEvent("only:subscribe", () => {});',
          'subscribeAppEvent("both:ways", () => {});',
        ].join("\n"),
      },
      /* 注释里的名字不算端 —— 判据若把注释当派发，「写清楚为什么没有订阅方」
       * 这种说明本身就会让它变绿，那是把判据关掉。 */
      {
        rel: "virtual/c.ts",
        text: '/* 曾经还有 subscribeAppEvent("only:emit", …) 的订阅侧 */',
      },
    ];
    const judged = judge(synthetic, table);
    expect(
      judged.map((row) => [
        row.event,
        row.emitters.length,
        row.subscribers.length,
      ]),
    ).toEqual([
      ["only:emit", 1, 0],
      ["only:subscribe", 0, 1],
      ["both:ways", 1, 1],
    ]);

    const broken = judged.filter(
      (row) => row.emitters.length === 0 || row.subscribers.length === 0,
    );
    expect(broken.map((row) => row.event)).toEqual([
      "only:emit",
      "only:subscribe",
    ]);
  });

  it("表里有行、但两处调用都不认识的事件名不会蒙混过关", () => {
    /* `emitAppEvent(someOtherThing)` 这种实参解析不出名字的，不许被算成派发 ——
     * 否则「把事件名塞进一个变量再随便传」就绕开了整条判据。 */
    const synthetic = judge(
      [
        {
          rel: "virtual/d.ts",
          text: "const key = pickKey(); emitAppEvent(key); subscribeAppEvent(key, () => {});",
        },
      ],
      'export interface AppEvents {\n  "some:thing": undefined;\n}',
    );
    expect(synthetic[0]?.emitters).toEqual([]);
    expect(synthetic[0]?.subscribers).toEqual([]);
  });
});
