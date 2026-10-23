/**
 * 「平台文字开头一行署名」这条约定的只读审计（`scripts/check-comment-headers.mjs`，ISSUE #2269）。
 *
 * 这一格存在的理由是「在册 ≠ 出勤」那一型：署名由 `ship` 四条出口保证（#2268），
 * 但手工 `create-issue` 那一路与 #2217 之前的存量都不经过它 —— 立案当场扫 open 单子
 * 21 张：缺 19 · 重复 1 · 正常 1，而**没有任何一处能读出这件事**。
 *
 * 所以本文件钉的全是「读数会不会被读错」：
 *   ① 三态：`2`（一次列表都没读到）**不等于** `0` —— 那是「没审」，不是「审过且干净」；
 *   ② 单张 `get-issue` 读不到 ⇒ 记「读不到」，不判成「缺」、不因此变红
 *      （「拿不到测量」与「测量是红的」是两件事）；
 *   ③ 只读：一次写动作都不许发生；
 *   ④ PR 正文用列表自带的 `body`，不逐张再问一次 `get-pull`（多一问就是一轮网络）。
 *
 * 不碰真平台：`run` 全程注入假执行者。
 */
import { describe, expect, it } from "vitest";

import {
  collectShapes,
  main,
} from "../scripts/check-comment-headers.mjs";
import { headerShape } from "../scripts/ship-ticket.mjs";

type FakeResult = {
  status: number;
  stdout: string;
  stderr: string;
  error: string | null;
};

const ok = (stdout: string): FakeResult => ({
  status: 0,
  stdout,
  stderr: "",
  error: null,
});
const json = (data: unknown) => JSON.stringify({ status: 200, data });
const HEAD = (name: string) => `**[评论人：${name}]**`;

/** 假执行者：按子命令答；`bodies` 是「单号 → 正文」，缺键的那张答非 JSON（演「读不到」）。 */
function fake(opts: {
  issues?: { number: string; title: string }[];
  bodies?: Record<string, string>;
  pulls?: { number: string; title: string; body?: string }[];
  listsDown?: boolean;
}) {
  const calls: string[] = [];
  const run = (_cmd: string, args: string[]): FakeResult => {
    calls.push([_cmd, ...args].join(" "));
    if (opts.listsDown) {
      return { status: -1, stdout: "", stderr: "ENOENT", error: "ENOENT" };
    }
    if (args[0] === "issues" && args[1] === "list-issues") {
      return ok(json((opts.issues ?? []).map((i) => ({ ...i }))));
    }
    if (args[0] === "issues" && args[1] === "get-issue") {
      const number = args[args.indexOf("--number") + 1] ?? "";
      const body = opts.bodies?.[number];
      if (body === undefined) return ok("不是 JSON");
      return ok(json({ body }));
    }
    if (args[0] === "pulls" && args[1] === "list-pulls") {
      return ok(json(opts.pulls ?? []));
    }
    return ok("");
  };
  return { run, calls };
}

const I2265 = { number: "2265", title: "形态档在平台上没有判决面" };
const I2195 = { number: "2195", title: "质量门禁串行 spawnSync" };
const I2194 = { number: "2194", title: "工坊两份 memo 无失效出口" };
const ISSUES = [I2265, I2195, I2194];

describe("headerShape：署名形状四档", () => {
  it("缺 / 正常 / 重复 / 有但不在首行，各一档一个样本", () => {
    expect(headerShape("## 症状\n\n正文\n")).toBe("缺");
    expect(headerShape(`${HEAD("a")}\n\n## 症状\n`)).toBe("正常");
    expect(headerShape(`${HEAD("a")}\n${HEAD("a")}\n\n## 症状\n`)).toBe("重复");
    expect(headerShape(`## 症状\n\n${HEAD("a")}\n`)).toBe("不在首行");
    expect(headerShape("")).toBe("缺");
    expect(headerShape(null)).toBe("缺");
  });
});

describe("collectShapes：只读、且不逐张多问", () => {
  it("单张读不到记「读不到」，不判成「缺」", () => {
    const { run, calls } = fake({
      issues: ISSUES,
      bodies: { "2265": `${HEAD("y")}\n\n## 症状\n`, "2195": "## 症状\n" },
      pulls: [{ number: "2271", title: "一个 PR", body: `${HEAD("y")}\n\n正文` }],
    });
    const got = collectShapes({ run, slug: "o/r", pages: 1, pageSize: 30 });
    const byNumber = new Map(got.rows.map((r) => [r.number, r.shape]));
    expect(byNumber.get("2265")).toBe("正常");
    expect(byNumber.get("2195")).toBe("缺");
    expect(byNumber.get("2194")).toBe("读不到");
    expect(byNumber.get("2271")).toBe("正常");
    expect(got.ran).toBe(true);
    /* PR 正文取自列表那一条：不许再问 get-pull（每一问都是一轮网络）。 */
    expect(calls.some((c) => c.includes("get-pull"))).toBe(false);
    /* 只读：一次写动作都不许出现。 */
    expect(
      calls.some(
        (c) =>
          c.includes("update-issue") ||
          c.includes("post-issue") ||
          c.includes("post-pull") ||
          c.includes("merge-pull"),
      ),
    ).toBe(false);
  });
});

describe("main：三态与点名", () => {
  const collect = () => {
    const heard: string[] = [];
    return { heard, log: (s: string) => heard.push(s) };
  };

  it("有缺 ⇒ 1，并把那一张的号与形状念出来", () => {
    const { run } = fake({
      issues: [I2195],
      bodies: { "2195": "## 症状\n" },
    });
    const { heard, log } = collect();
    const code = main({ run, log, slug: "o/r" });
    expect(code).toBe(1);
    expect(heard.join("\n")).toContain("[缺] 单 #2195");
    expect(heard.join("\n")).toContain("样本 1 条");
  });

  it("只有「读不到」⇒ 0：缺读数不是红，也不许被算成缺", () => {
    const { run } = fake({ issues: [I2194], bodies: {} });
    const { heard, log } = collect();
    expect(main({ run, log, slug: "o/r" })).toBe(0);
    expect(heard.join("\n")).toContain("读不到」不判成「缺」");
  });

  it("列表一次都没读到 ⇒ 2，且话术明说那不是「审过且干净」", () => {
    const { run } = fake({ listsDown: true });
    const { heard, log } = collect();
    expect(main({ run, log, slug: "o/r" })).toBe(2);
    expect(heard.join("\n")).toContain("不构成");
  });

  it("取不到 slug ⇒ 2（没审），不去猜一个仓库名", () => {
    const { run } = fake({ issues: [] });
    const { heard, log } = collect();
    expect(main({ run, log, slug: "" })).toBe(2);
    expect(heard.join("\n")).toContain("slug");
  });

  it("`--json` 只发一份 JSON 文档，且 rows 只装非正常的那些", () => {
    const { run } = fake({
      issues: ISSUES,
      bodies: { "2265": `${HEAD("y")}\n\n正文`, "2195": "## 症状\n" },
    });
    const { heard, log } = collect();
    main({ run, log, slug: "o/r", json: true });
    /* 追一行人类总结会让机器侧 `JSON.parse` 撞「尾部多余内容」，看起来像数据坏了。 */
    expect(heard).toHaveLength(1);
    const parsed = JSON.parse(heard.join("\n")) as {
      total: number;
      rows: { number: string }[];
    };
    expect(parsed.total).toBe(3);
    expect(parsed.rows.map((r: { number: string }) => r.number)).toEqual([
      "2195",
      "2194",
    ]);
  });
});
