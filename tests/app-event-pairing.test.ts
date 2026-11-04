/**
 * `AppEvents` 每条事件**两端都得在场**（有派发、有订阅）。`~/lib/app-events` 只管「名字与载荷同行」，管不到有没有人用；两种坏法都静默：派发方没了而监听器仍挂着（该刷新时不刷新），订阅方没了而广播照发（`refreshCustomNodes()` 的 `custom-nodes:updated` 即此）。
 * 装机实测三个实例：`open-task`、`comfyapp:local-workflows-path-changed` 只有订阅，`custom-nodes:updated` 只有派发。口径：测试文件不算端（同 E3′）、认字面量与常量间接、`app-events` 自身不算端、**同文件的派发+订阅不算两端**（自环，静默但长得像齐全）、先过 `stripComments`。
 * 与 P61（`check-ui-primitives.cjs`）不重叠：它管「有没有走出口」，本条管「出口两端齐不齐」。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const TABLE_FILE = "src/lib/app-events.ts";

type SourceFile = {
  /** 相对仓库根、正斜杠的路径（断言消息里要能直接点开）。 */
  rel: string;
  /** 已经剥掉注释的源码。 */
  text: string;
};

function collectSources(): Array<SourceFile> {
  const out: Array<SourceFile> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        /* 只跳这两类：`generated` 在本仓库是**产物根**的名字，
         * 别处抄来的「跳过名为 generated 的目录」会把真源文件一起摘掉
         * （同一份扫描工具在不同目录语义不同，实测踩过一次）。 */
        if (entry.name === "node_modules" || entry.name === ".next") {
          continue;
        }
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }
      if (/\.(test|spec)\./.test(entry.name)) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      /* 定义处不算任何一端：它的类型注释里会写出每个事件名。 */
      if (rel === TABLE_FILE) {
        continue;
      }
      out.push({ rel, text: fs.readFileSync(abs, "utf8") });
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/** 表里的事件名（键带引号或不带引号都认）。 */
function readEventTable(source: string): Array<string> {
  /* 表的声明形态两种都认：`interface` 与 `type =`。声明形态归 lint 规则管，
   * 这条判据只认「这张表在哪儿」 —— 只认一种写法会在改写声明形态那一批把扫描面
   * 静默打成 0（0 条恰好像「都齐了」，见本文件头注）。 */
  const start = source.search(/export (?:interface AppEvents \{|type AppEvents = \{)/);
  if (start < 0) {
    return [];
  }
  const block = source.slice(start, source.indexOf("\n}", start));
  const names: Array<string> = [];
  for (const match of block.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)) {
    const name = match[1] ?? match[2];
    if (name !== undefined && name !== "") {
      names.push(name);
    }
  }
  return names;
}

/**
 * `const NAME = "事件名"` 的解引用表。
 *
 * 派发侧完全可以传常量（库里就有一处这么写），只认字面量的判据会把它判成「没派发」。
 */
function readNameConstants(sources: Array<SourceFile>): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of sources) {
    for (const match of file.text.matchAll(
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*"([^"]+)"/g,
    )) {
      const identifier = match[1];
      const name = match[2];
      if (identifier !== undefined && identifier !== "" && name !== undefined && name !== "") {
        map.set(identifier, name);
      }
    }
  }
  return map;
}

/**
 * 把一次调用的首个实参解析成事件名：字面量形态（正则第 1 组）已不带引号，标识符形态（第 2 组）
 * 要过常量表。解不出名字的（来自 `pickKey()` 这类别处的值）返回 null —— 不许算成端，否则
 * 「把事件名塞进变量再随便传」就绕开了整条判据。
 */
function resolveEventName(
  literal: string | undefined,
  identifier: string | undefined,
  names: Map<string, string>,
): string | null {
  if (literal !== undefined) {
    return literal;
  }
  if (identifier === undefined) {
    return null;
  }
  return names.get(identifier) ?? null;
}

/** 扫出一份源码里两处调用的事件名。 */
function sidesOf(
  file: SourceFile,
  names: Map<string, string>,
): { emitted: Array<string>; subscribed: Array<string> } {
  const emitted: Array<string> = [];
  const subscribed: Array<string> = [];
  /* SAFETY: 类型断言已复核 */
  for (const [fn, bucket] of [
    ["emitAppEvent", emitted],
    ["subscribeAppEvent", subscribed],
  ] as const) {
    for (const match of file.text.matchAll(
      new RegExp(`\\b${fn}\\s*\\(\\s*(?:"([^"]+)"|([A-Za-z_$][\\w$]*))`, "g"),
    )) {
      const name = resolveEventName(match[1], match[2], names);
      if (name !== null && name !== "") {
        bucket.push(name);
      }
    }
  }
  return { emitted, subscribed };
}

type PairingRow = {
  emitters: Array<string>;
  event: string;
  subscribers: Array<string>;
};

/**
 * 两端不齐 —— 含「一端都没有」与「只有自环」两种。判据是「存在一对**不同文件**的派发方与订阅方」，
 * 不是「两处都非空」：后者会被同文件的 `emitAppEvent(x)` + `subscribeAppEvent(x)` 蒙过去，
 * 那是自己给自己广播（表现与没有订阅方一样，静态上看不出）。
 */
function isUnpaired(row: PairingRow): boolean {
  return !row.emitters.some((emitter) =>
    row.subscribers.some((subscriber) => subscriber !== emitter),
  );
}

function judge(sources: Array<SourceFile>, tableSource: string): Array<PairingRow> {
  /* 剥注释这一步放在 `judge` 里面而不是采集时：真实扫描与合成反证必须吃同一条
   * 口径，否则「注释里提到某个事件名不算端」这条承诺只是文件头的一句话，
   * 没有任何东西保证它真的生效。 */
  const clean = sources.map((file) => ({
    rel: file.rel,
    text: stripComments(file.text),
  }));
  const names = readNameConstants(clean);
  const table = readEventTable(stripComments(tableSource));
  const emitters = new Map<string, Array<string>>();
  const subscribers = new Map<string, Array<string>>();
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

  it("每一条既有派发方又有订阅方，且两端不在同一个文件里", () => {
    const broken = rows.filter(isUnpaired);
    expect(
      broken.map(
        (row) =>
          `${row.event} → 派发 ${row.emitters.length} 处 / 订阅 ${row.subscribers.length} 处${
            row.emitters.length > 0 && row.subscribers.length > 0 ? "（只有自环）" : ""
          }`,
      ),
    ).toEqual([]);
  });

  it("反向证明：只剩一端的通道会被点名，两端都在的不报", () => {
    const table = [
      "export type AppEvents = {",
      '  "only:emit": undefined;',
      '  "only:subscribe": { id: string };',
      '  "both:ways": undefined;',
      '  "self:loop": undefined;',
      '  "mixed:ends": undefined;',
      "};",
    ].join("\n");
    const synthetic: Array<SourceFile> = [
      {
        rel: "virtual/a.ts",
        /* 常量间接形态也必须认到：`ONLY_EMIT_EVENT` 解成 `only:emit`。 */
        text: [
          'const ONLY_EMIT_EVENT = "only:emit";',
          "emitAppEvent(ONLY_EMIT_EVENT);",
          'emitAppEvent("both:ways");',
          // 派发方自己也订阅一条：不许因此判成「只有自环」——
          // 判的是「有没有一对不同文件的两端」，不是「这个文件干了两件事」。
          'emitAppEvent("mixed:ends");',
          'subscribeAppEvent("mixed:ends", () => {});',
        ].join("\n"),
      },
      {
        rel: "virtual/b.ts",
        text: [
          'subscribeAppEvent("only:subscribe", () => {});',
          'subscribeAppEvent("both:ways", () => {});',
          'subscribeAppEvent("mixed:ends", () => {});',
        ].join("\n"),
      },
      /* 注释里的名字不算端 —— 判据若把注释当派发，「写清楚为什么没有订阅方」
       * 这种说明本身就会让它变绿，那是把判据关掉。 */
      {
        rel: "virtual/c.ts",
        text: '/* 曾经还有 subscribeAppEvent("only:emit", …) 的订阅侧 */',
      },
      /* 自环：同一文件里派发 + 订阅。跑起来一句「派发成功」，界面上什么都没有 ——
       * 与「订阅方没了」同一种静默，但静态上**两端计数都非零**，
       * 不加这一条判据就是「看着齐」的空通道有处可藏。 */
      {
        rel: "virtual/e.ts",
        text: ['emitAppEvent("self:loop");', 'subscribeAppEvent("self:loop", () => {});'].join(
          "\n",
        ),
      },
    ];
    const judged = judge(synthetic, table);
    expect(judged.map((row) => [row.event, row.emitters.length, row.subscribers.length])).toEqual([
      ["only:emit", 1, 0],
      ["only:subscribe", 0, 1],
      ["both:ways", 1, 1],
      ["self:loop", 1, 1],
      ["mixed:ends", 1, 2],
    ]);

    const broken = judged.filter(isUnpaired);
    expect(broken.map((row) => row.event)).toEqual(["only:emit", "only:subscribe", "self:loop"]);
    /* `both:ways` 与 `mixed:ends` 必须**不**在名单里：后者是「派发方自己也订阅」
     * 这一常见形状，误报一片的判据会被当噪音关掉，那比没有判据更糟。 */
    expect(broken.map((row) => row.event)).not.toContain("mixed:ends");
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
