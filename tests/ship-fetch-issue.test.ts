/**
 * `pnpm ship --fetch-issue <号>`（ISSUE #3965）：把一张 issue 的正文 / 评论 / 图片
 * 一次取到本机固定目录。
 *
 * 纯函数（尾段提取 / 链接改写 / 文件名 / 渲染）逐个锁；编排层用假执行者全链跑
 * （get-imgs 的 `data` 指到临时目录里的真实文件，验证复制与改写），不碰真平台。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../scripts/ship/ship.mjs";
import { CODE } from "../scripts/ship/ship-codes.mjs";
import {
  extractImageTails,
  imageLocalName,
  renderCommentsMd,
  renderIssueMd,
  rewriteImageLinks,
  runFetchIssue,
} from "../scripts/ship/ship-fetch-issue.mjs";

type FakeResult = { error: string | null; status: number; stderr: string; stdout: string };

const T1 =
  "imgs/issues/2121210354049937408/iLp1blGSxWz2pkEWJctM1D/4dacf6b6-81cc-4259-a7be-c7ab528ff862.png";
const T2 =
  "imgs/issues/2121210354049937408/iLp1blGSxWz2pkEWJctM1D/f3c0b348-2862-43d5-a776-95da8a0fa44d.png";

describe("extractImageTails / rewriteImageLinks / imageLocalName（纯函数）", () => {
  it("按出现顺序抽去重的尾段；`)`、空格与中文标点不带偏", () => {
    const text = [
      `![a](https://cnb.cool/x/y/-/${T1})`,
      `看图：https://cnb.cool/x/y/-/${T2}。`,
      `重复：${T1} 又出现一次。`,
    ].join("\n");
    expect(extractImageTails(text)).toEqual([T1, T2]);
    expect(extractImageTails("没有图片")).toEqual([]);
  });

  it("rewriteImageLinks：映射内的换成本地路径，没映射的原样保留", () => {
    const mapping = new Map([[T1, "imgs/a.png"]]);
    const text = `见 ${T1} 与 ${T2}`;
    expect(rewriteImageLinks(text, mapping)).toBe(`见 imgs/a.png 与 ${T2}`);
  });

  it("rewriteImageLinks：带站点前缀的完整链接整条换成本地路径（#4057）", () => {
    const url = `https://cnb.cool/x/y/-/${T1}`;
    const mapping = new Map([[url, "imgs/a.png"]]);
    const text = `<img src="${url}" class="cnb-md-image__upload" />`;
    const out = rewriteImageLinks(text, mapping);
    expect(out).toBe(`<img src="imgs/a.png" class="cnb-md-image__upload" />`);
    /* 只换尾段的话，站点前缀会留下来拼出 404 地址 —— 那正是 #4057 的现场。 */
    expect(out).not.toContain("https://cnb.cool");
  });

  it("imageLocalName：保留原文件名；撞名加序号；非法字符换 _", () => {
    const used = new Set<string>();
    expect(imageLocalName(`imgs/issues/1/k/shot.png`, used)).toBe("shot.png");
    expect(imageLocalName(`imgs/issues/1/k/shot.png`, used)).toBe("img-2-shot.png");
    expect(imageLocalName(`imgs/issues/1/k/怪 名字.png`, used)).toBe("____.png");
  });
});

describe("renderIssueMd / renderCommentsMd（纯函数）", () => {
  it("issue 文档带 front matter 与空正文占位", () => {
    const md = renderIssueMd({
      number: 3965,
      title: "ship处理issue",
      state: "open",
      author: "月读",
      createdAt: "C",
      updatedAt: "U",
      priority: "",
      labels: [],
      body: "  ",
      fetchedAt: "F",
      commentsCount: 2,
      imagesTotal: 1,
      imagesFailed: 0,
    });
    expect(md).toContain("# #3965 ship处理issue");
    expect(md).toContain("优先级：（未设）");
    expect(md).toContain("（正文为空）");
    expect(md).toContain("抓取时间：F");
  });

  it("评论文档：无评论给占位，有评论逐条小节", () => {
    expect(renderCommentsMd([])).toContain("（无评论）");
    const md = renderCommentsMd([{ index: 1, author: "月读", createdAt: "C", body: "看图" }]);
    expect(md).toContain("### 评论 1 · 月读 · C");
    expect(md).toContain("看图");
  });
});

describe("runFetchIssue：假执行者全链（#3965）", () => {
  let root: string;
  let imgDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-issue-"));
    imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-issue-imgs-"));
    fs.writeFileSync(path.join(imgDir, "a.png"), "PNG-A");
    fs.writeFileSync(path.join(imgDir, "b.png"), "PNG-B");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(imgDir, { recursive: true, force: true });
  });

  /** 假执行者：三条 cnb 读命令按参数分发；get-imgs 的 data 指到临时目录真文件。 */
  function fakeRun(opts: { failImgs?: boolean; failIssue?: boolean }) {
    const log: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const ok = (obj: unknown): FakeResult => ({
        status: 0,
        stdout: JSON.stringify(obj),
        stderr: "",
        error: null,
      });
      if (cmd !== "cnb") {
        return { status: 0, stdout: "", stderr: "", error: null };
      }
      if (args[0] === "issues" && args[1] === "get-issue") {
        if (opts.failIssue) {
          return { status: 1, stdout: "", stderr: "boom", error: null };
        }
        return ok({
          status: 200,
          data: {
            number: 3965,
            title: "ship处理issue",
            state: "open",
            author: { username: "u1", nickname: "月读" },
            created_at: "C0",
            updated_at: "U0",
            priority: "",
            labels: [{ name: "提单人:yuedu-win" }],
            body: `正文一\n![a](https://cnb.cool/x/y/-/${T1})`,
          },
        });
      }
      if (args[0] === "issues" && args[1] === "list-issue-comments") {
        return ok({
          status: 200,
          data: [
            { author: { nickname: "评审" }, created_at: "C1", body: `看 ${T2}` },
            { author: { nickname: "月读" }, created_at: "C2", body: `再来 ${T1}` },
          ],
        });
      }
      if (args[0] === "issues" && args[1] === "get-imgs") {
        if (opts.failImgs) {
          return { status: 1, stdout: "", stderr: "404", error: null };
        }
        const tail = String(args[args.indexOf("--img-path") + 1] ?? "");
        const src = tail.endsWith("4dacf6b6-81cc-4259-a7be-c7ab528ff862.png")
          ? path.join(imgDir, "a.png")
          : path.join(imgDir, "b.png");
        return ok({ status: 200, contentType: "image/png", data: src });
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    return { run, log };
  }

  it("全链：正文 + 评论落 md，图片复制进 imgs/ 且链接换成本地相对路径", () => {
    const f = fakeRun({});
    const code = runFetchIssue({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "moon-read/comfy-app-t3",
      number: 3965,
      root,
    });
    expect(code).toBe(CODE.GREEN);
    const dir = path.join(root, ".tmp", "issues", "3965");
    const issueMd = fs.readFileSync(path.join(dir, "issue.md"), "utf8");
    const commentsMd = fs.readFileSync(path.join(dir, "comments.md"), "utf8");
    /* 图片链接换成了本地相对路径，原始尾段不再出现。 */
    expect(issueMd).toContain("imgs/4dacf6b6-81cc-4259-a7be-c7ab528ff862.png");
    expect(issueMd).not.toContain(T1);
    /* #4057：整条 URL（含站点前缀）都要换掉 —— 只换尾段会拼出 404 地址。 */
    expect(issueMd).not.toContain("https://cnb.cool");
    expect(commentsMd).not.toContain("https://cnb.cool");
    expect(commentsMd).toContain("imgs/f3c0b348-2862-43d5-a776-95da8a0fa44d.png");
    expect(commentsMd).toContain("### 评论 2 · 月读 · C2");
    /* 图片真被复制（内容对得上）。 */
    expect(
      fs.readFileSync(path.join(dir, "imgs", "4dacf6b6-81cc-4259-a7be-c7ab528ff862.png"), "utf8"),
    ).toBe("PNG-A");
    expect(
      fs.readFileSync(path.join(dir, "imgs", "f3c0b348-2862-43d5-a776-95da8a0fa44d.png"), "utf8"),
    ).toBe("PNG-B");
    expect(f.log.join("\n")).toContain("已落到");
  });

  it("重跑即更新：同一目录整份重写，不报错", () => {
    const f = fakeRun({});
    const io = {
      run: f.run,
      log: (l: string) => f.log.push(l),
      slug: "moon-read/comfy-app-t3",
      number: 3965,
      root,
    };
    expect(runFetchIssue(io)).toBe(CODE.GREEN);
    expect(runFetchIssue(io)).toBe(CODE.GREEN);
    expect(
      fs.readFileSync(path.join(root, ".tmp", "issues", "3965", "issue.md"), "utf8"),
    ).toContain("#3965");
  });

  it("图片取不到 ⇒ warn 一行、原链接保留，整体仍是 0", () => {
    const f = fakeRun({ failImgs: true });
    const code = runFetchIssue({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "moon-read/comfy-app-t3",
      number: 3965,
      root,
    });
    expect(code).toBe(CODE.GREEN);
    const issueMd = fs.readFileSync(path.join(root, ".tmp", "issues", "3965", "issue.md"), "utf8");
    expect(issueMd).toContain(T1);
    expect(f.log.join("\n")).toContain("图片取不到");
  });

  it("issue 取不到 ⇒ 2（没跑起来，不是内容为空）", () => {
    const f = fakeRun({ failIssue: true });
    const code = runFetchIssue({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "moon-read/comfy-app-t3",
      number: 3965,
      root,
    });
    expect(code).toBe(CODE.NOT_RUN);
  });
});

describe("ship --fetch-issue：分派与互斥（ISSUE #3965，假执行者）", () => {
  let root: string;
  let imgDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-issue-main-"));
    imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-issue-main-imgs-"));
    fs.writeFileSync(path.join(imgDir, "a.png"), "PNG-A");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(imgDir, { recursive: true, force: true });
  });

  function mainRun(opts: { branch?: string }) {
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({ status: 0, stdout, stderr: "", error: null });
    /* cnb 的取数面是 JSON（cnbJson 吃 stdout）——对象入参在这里先序列化。 */
    const okJson = (obj: unknown): FakeResult => ({
      status: 0,
      stdout: JSON.stringify(obj),
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("origin\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/origin/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok(opts.branch ?? "master");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "get-issue") {
        return okJson({
          status: 200,
          data: {
            number: 3965,
            title: "ship处理issue",
            state: "open",
            author: { username: "u1", nickname: "月读" },
            created_at: "C0",
            updated_at: "U0",
            priority: "",
            labels: [],
            body: `![a](https://cnb.cool/x/y/-/${T1})`,
          },
        });
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "list-issue-comments") {
        return okJson({ status: 200, data: [] });
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "get-imgs") {
        return okJson({ status: 200, contentType: "image/png", data: path.join(imgDir, "a.png") });
      }
      return ok("");
    };
    return { run, log };
  }

  it("分派到 runFetchIssue：文件落进 root 的 .tmp/issues/3965/", async () => {
    const f = mainRun({});
    const code = await main({
      args: ["--fetch-issue", "3965"],
      run: f.run,
      log: (l: string) => f.log.push(l),
      probeCnb: () => true,
      root,
    });
    expect(code).toBe(CODE.GREEN);
    expect(fs.existsSync(path.join(root, ".tmp", "issues", "3965", "issue.md"))).toBe(true);
    expect(f.log.join("\n")).toContain("已落到");
  });

  it("与显式动作同行 ⇒ 2；号不像号 ⇒ 2", async () => {
    const f = mainRun({});
    const code = await main({
      args: ["--fetch-issue", "3965", "--merge"],
      run: f.run,
      log: (l: string) => f.log.push(l),
      probeCnb: () => true,
      root,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("--fetch-issue 只读、一次只做一件");

    const f2 = mainRun({});
    const code2 = await main({
      args: ["--fetch-issue", "abc"],
      run: f2.run,
      log: (l: string) => f2.log.push(l),
      probeCnb: () => true,
      root,
    });
    expect(code2).toBe(CODE.NOT_RUN);
    expect(f2.log.join("\n")).toContain("收的是 issue 号");
  });
});
