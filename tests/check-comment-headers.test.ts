/**
 * 「平台文字开头一行署名」这条约定的只读审计（`scripts/check-comment-headers.mjs`，ISSUE #2269）。
 *
 * 这一格存在的理由是「在册 ≠ 出勤」那一型：署名由 `ship` 四条出口保证（#2268），
 * 但手工 `create-issue` 那一路与 #2217 之前的存量都不经过它 —— 立案当场扫 open 单子
 * 21 张：缺 19 · 重复 1 · 正常 1，而**没有任何一处能读出这件事**。
 *
 * 所以本文件钉的全是「读数会不会被读错」：
 *   ① 三态：`2`（一次列表都没读到）**不等于** `0` —— 那是「没审」，不是「审过且干净」；
 *   ② 单张 `get-issue` / `get-pull` 读不到 ⇒ 记「读不到」，不判成「缺」、不因此变红
 *      （「拿不到测量」与「测量是红的」是两件事）；
 *   ③ 只读：一次写动作都不许发生；
 *   ④ **PR 正文只认逐张 `get-pull` 那一份** —— 这一条在本文件里曾经写成它的反面
 *      （「PR 正文用列表自带的 `body`，不逐张再问」，理由是省一轮网络）。那句教义
 *      正是 ISSUE #2788 的藏身处：`list-pulls` 确实**有** `body` 这个键、类型是 string，
 *      而列表形态里它的值是**空串**（实测四张 open PR 全为 0 长度）—— 于是每一条 PR
 *      都被判成「缺署名」，而断言 `calls 里没有 get-pull` 把这个取数错误**钉成了要求**。
 *      ⇒ 判据的 bug 会在被测面长出教义；修判据时那条教义必须同批反过来，
 *      否则下一次「优化」还会照原样省掉那一问。
 *
 * 不碰真平台：`run` 全程注入假执行者。
 */
import { describe, expect, it } from "vitest";

import { collectShapes, main } from "../scripts/check-comment-headers.mjs";
import { headerShape } from "../scripts/ship-ticket.mjs";

type FakeResult = {
  error: string | null;
  status: number;
  stderr: string;
  stdout: string;
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
  bodies?: Record<string, string>;
  issues?: Array<{ number: string; title: string }>;
  listsDown?: boolean;
  /** PR 正文只能从 `get-pull` 拿：`prBodies` 是「PR 号 → 正文」，缺键的那张答非 JSON。 */
  prBodies?: Record<string, string>;
  /** PR 列表那一条的**形状**（`body` 恒为空串 —— 与实测的 `list-pulls` 一致，见文件头 ④）。 */
  pulls?: Array<{ number: string; title: string }>;
}) {
  const calls: Array<string> = [];
  const run = (_cmd: string, args: Array<string>): FakeResult => {
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
      if (body === undefined) {
        return ok("不是 JSON");
      }
      return ok(json({ body }));
    }
    if (args[0] === "pulls" && args[1] === "list-pulls") {
      /* 列表那份 `body` 一律给**空串**（真实形态），用例不许靠它得出结论。 */
      return ok(
        json((opts.pulls ?? []).map((p) => ({ ...p, body: "" }))),
      );
    }
    if (args[0] === "pulls" && args[1] === "get-pull") {
      const number = args[args.indexOf("--number") + 1] ?? "";
      const body = opts.prBodies?.[number];
      if (body === undefined) {
        return ok("不是 JSON");
      }
      return ok(json({ body }));
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

describe("collectShapes：只读，且 PR 正文只认逐张 get-pull 那一份", () => {
  it("单张读不到记「读不到」，不判成「缺」；PR 那一侧同一口径", () => {
    const { run, calls } = fake({
      issues: ISSUES,
      bodies: { "2265": `${HEAD("y")}\n\n## 症状\n`, "2195": "## 症状\n" },
      pulls: [{ number: "2271", title: "一个 PR" }],
      prBodies: { "2271": `${HEAD("y")}\n\n正文` },
    });
    const got = collectShapes({ run, slug: "o/r", pages: 1, pageSize: 30 });
    const byNumber = new Map(got.rows.map((r) => [r.number, r.shape]));
    expect(byNumber.get("2265")).toBe("正常");
    expect(byNumber.get("2195")).toBe("缺");
    expect(byNumber.get("2194")).toBe("读不到");
    expect(byNumber.get("2271")).toBe("正常");
    expect(got.ran).toBe(true);
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

  /**
   * 这一条就是 #2788 本身：夹具给的是**实测形态**（`list-pulls` 的 `body` 是空串，
   * `get-pull` 的那份才有署名）。修之前这里拿列表那份判 ⇒ 「缺」；修之后拿 `get-pull`
   * ⇒ 「正常」。断言同时数 `get-pull` 的**次数** —— 只判形状的话，
   * 「整条 PR 侧都不参与判决」也能绿。
   */
  it("列表的 body 是空串（真形态）：判「正常」而不是「缺」，且每张 PR 确实各问一次", () => {
    const { run, calls } = fake({
      issues: [],
      pulls: [
        { number: "2786", title: "带署名的 PR" },
        { number: "2787", title: "另一张带署名的 PR" },
      ],
      prBodies: {
        "2786": `${HEAD("y")}\n\n## 为什么\n`,
        "2787": `${HEAD("c")}\n\n## 为什么\n`,
      },
    });
    const got = collectShapes({ run, slug: "o/r", pages: 1, pageSize: 30 });
    expect(got.rows.map((r) => [r.number, r.shape])).toEqual([
      ["2786", "正常"],
      ["2787", "正常"],
    ]);
    expect(calls.filter((c) => c.includes("get-pull"))).toHaveLength(2);
  });

  it("PR 的 get-pull 读不到 ⇒ 「读不到」，不判成「缺」", () => {
    const { run } = fake({
      issues: [],
      pulls: [{ number: "2790", title: "取不到的那张" }],
      prBodies: {},
    });
    const got = collectShapes({ run, slug: "o/r", pages: 1, pageSize: 30 });
    expect(got.rows.map((r) => [r.number, r.shape])).toEqual([["2790", "读不到"]]);
  });
});

describe("main：三态与点名", () => {
  const collect = () => {
    const heard: Array<string> = [];
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

  /**
   * 退码这一半必须由 PR 那一侧答一次：#2788 的失效形态正是「假阳性一路带进退码」
   * （`shape !== "读不到"` 那一句），而上面那条用例走的是单子那一侧，碰不到它。
   */
  it("PR 侧全合规 ⇒ 0（修之前这里是 1：列表那份空串被逐张判成「缺」）", () => {
    const { run } = fake({
      issues: [],
      pulls: [{ number: "2786", title: "带署名的 PR" }],
      prBodies: { "2786": `${HEAD("y")}\n\n正文` },
    });
    const { heard, log } = collect();
    expect(main({ run, log, slug: "o/r" })).toBe(0);
    expect(heard.join("\n")).toContain("正常 1");
  });

  it("PR 侧真缺署名 ⇒ 1，并念出是哪一张", () => {
    const { run } = fake({
      issues: [],
      pulls: [{ number: "2787", title: "手写正文的 PR" }],
      prBodies: { "2787": "## 为什么\n\n正文\n" },
    });
    const { heard, log } = collect();
    expect(main({ run, log, slug: "o/r" })).toBe(1);
    expect(heard.join("\n")).toContain("[缺] PR #2787");
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
    const parsed = /* SAFETY: 类型断言已复核 */ JSON.parse(heard.join("\n")) as {
      rows: Array<{ number: string }>;
      total: number;
    };
    expect(parsed.total).toBe(3);
    expect(parsed.rows.map((r: { number: string }) => r.number)).toEqual(["2195", "2194"]);
  });
});
