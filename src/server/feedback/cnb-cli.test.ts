/**
 * 「运行环境 cnb cli」调用面的契约：不内置凭证、命令走 argv 数组（不经 shell）、
 * -v 回执只认 status/data 原值、建单号与附件链接都从平台回执取。
 * mock 边界：node:child_process 的 spawn 换成假 Child，命令与参数逐项断言；
 * 命令形态解析 / 整树回收是既有地基，这里恒等透传与空操作，不依赖本机装没装 cnb。
 */
import { EventEmitter } from "node:events";
import type * as NodeChildProcess from "node:child_process";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type FakeStream = EventEmitter & { setEncoding: (enc: string) => void };
type FakeChild = EventEmitter & {
  pid: number;
  stderr: FakeStream;
  stdout: FakeStream;
};

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn<(command: string, args: Array<string>) => FakeChild>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  return { ...actual, spawn: spawnMock };
});
vi.mock("~/lib/process/kill-process-tree", () => ({
  killProcessTree: () => Promise.resolve({ ok: true, via: "mock" }),
}));
vi.mock("~/lib/process/executable-resolve", () => ({
  resolveCommandInvocation: (name: string, args: Array<string>) => ({
    command: name,
    args,
    resolved: true,
  }),
}));

import {
  createFeedbackIssue,
  postFeedbackAssetsComment,
  probeCnbCli,
  uploadFeedbackAsset,
} from "./cnb-cli";

function fakeStream(): FakeStream {
  return Object.assign(new EventEmitter(), {
    setEncoding: () => undefined,
  });
}

/** 造一个假子进程，并让 spawn() 被真正调用之后才发 stdout / close。 */
function givenChild(stdout: string, stderr = ""): void {
  const child: FakeChild = Object.assign(new EventEmitter(), {
    pid: 424_242,
    stderr: fakeStream(),
    stdout: fakeStream(),
  });
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      if (stdout !== "") {
        child.stdout.emit("data", stdout);
      }
      if (stderr !== "") {
        child.stderr.emit("data", stderr);
      }
      child.emit("close", 0);
    });
    return child;
  });
}

/** 造一个假子进程，stdout 按 chunks 逐段发（输出上限的判据要多段输出才测得到）。 */
function givenChunkedChild(chunks: Array<string>): void {
  const child: FakeChild = Object.assign(new EventEmitter(), {
    pid: 424_242,
    stderr: fakeStream(),
    stdout: fakeStream(),
  });
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      for (const chunk of chunks) {
        child.stdout.emit("data", chunk);
      }
      child.emit("close", 0);
    });
    return child;
  });
}

/** 收集一次 spawn 的 argv，供断言「不经 shell、参数逐项传」。 */
function lastArgs(): Array<string> {
  const call = spawnMock.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("spawn 没被调用");
  }
  return call[1];
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeCnbCli（只读探测）", () => {
  it("输出「已登录」判可用", async () => {
    givenChild("✅ 已登录。");
    await expect(probeCnbCli()).resolves.toEqual({ available: true, reason: "" });
    expect(lastArgs()).toContain("status");
  });

  it("输出「未登录」给可见原因，且不调用任何写接口", async () => {
    givenChild("⚠️  未登录，请执行 `cnb login` 进行授权。");
    const status = await probeCnbCli();
    expect(status.available).toBe(false);
    expect(status.reason).toContain("cnb login");
    expect(lastArgs()).toEqual(["status"]);
  });

  it("命令起不来也只给一句原因，不抛", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });
    const status = await probeCnbCli();
    expect(status.available).toBe(false);
    expect(status.reason).toContain("spawn ENOENT");
  });

  it("输出超过 256KB 上限后不再累积：上限之后才出现的「已登录」不算数（#4339）", async () => {
    // 契约值与 cnb-cli.ts 的 MAX_OUTPUT_CHARS 同源（探测只需要判「已登录」，
    // cli 狂刷输出时不得无界累积）；改上限要同批改这条。
    const filler = "x".repeat(256 * 1024);
    givenChunkedChild([filler, "✅ 已登录。"]);
    const status = await probeCnbCli();
    expect(status.available, "上限截断之后的内容不参与判读").toBe(false);
    expect(status.reason).toContain("未登录");
  });

  it("上限内（含前导噪声）的正常探测不受截断影响", async () => {
    givenChunkedChild(["y".repeat(100 * 1024), "✅ 已登录。"]);
    await expect(probeCnbCli()).resolves.toEqual({ available: true, reason: "" });
  });
});

describe("createFeedbackIssue（建单）", () => {
  it("标题与正文走 --body-file，Issue 号只信 data.number", async () => {
    givenChild(JSON.stringify({ status: 201, data: { number: "3390" } }));
    const result = await createFeedbackIssue("[运行反馈] 点了没反应", "## 问题描述");
    expect(result).toEqual({ ok: true, issueNumber: "3390", error: "" });
    const args = lastArgs();
    expect(args).toContain("create-issue");
    expect(args).toContain("--body-file");
    expect(args).toContain("-v");
    expect(args.join(" ")).not.toContain("## 问题描述");
  });

  it("非 2xx 回执如实转成失败原因", async () => {
    givenChild(JSON.stringify({ status: 403, data: { errcode: 403, errmsg: "no permission" } }));
    const result = await createFeedbackIssue("[运行反馈] x", "body");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no permission");
  });

  it("回执不是 JSON 时不猜，给一句可见原因", async () => {
    givenChild("not json at all");
    const result = await createFeedbackIssue("[运行反馈] x", "body");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("没有返回可用回执");
  });
});

describe("uploadFeedbackAsset（传附件）", () => {
  it("图片走 upload-image，回执里的 asset_link 原样交出", async () => {
    givenChild(JSON.stringify({ status: 200, data: { asset_link: "<img src='x' />" } }));
    const result = await uploadFeedbackAsset("3390", "/tmp/shot.png", "image");
    expect(result).toEqual({ ok: true, link: "<img src='x' />", error: "" });
    expect(lastArgs()).toContain("upload-image");
  });

  it("诊断 zip 走 upload-file", async () => {
    givenChild(JSON.stringify({ status: 200, data: { asset_link: "[zip](/-/files/x)" } }));
    await uploadFeedbackAsset("3390", "/tmp/diag.zip", "file");
    expect(lastArgs()).toContain("upload-file");
  });

  it("回执缺 asset_link 判失败，不把空链接当成功", async () => {
    givenChild(JSON.stringify({ status: 200, data: {} }));
    const result = await uploadFeedbackAsset("3390", "/tmp/x.png", "image");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("附件链接");
  });
});

describe("postFeedbackAssetsComment（附件引用）", () => {
  it("把链接写进一条评论，正文走 --body-file", async () => {
    givenChild(JSON.stringify({ status: 201, data: {} }));
    const result = await postFeedbackAssetsComment("3390", ["- shot.png：<img ...>"]);
    expect(result).toEqual({ ok: true, error: "" });
    const args = lastArgs();
    expect(args).toContain("post-issue-comment");
    expect(args).toContain("--body-file");
  });

  it("没有附件时一次命令都不发", async () => {
    const result = await postFeedbackAssetsComment("3390", []);
    expect(result.ok).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
