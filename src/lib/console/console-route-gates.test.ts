/**
 * 回归护栏：`/api/console/run` 的**三道闸门与它们的顺序**（ISSUE #1327）。
 *
 * 为什么是源形态判据而不是请求级用例：这条路由能执行**任意本机命令**，而它的
 * 安全性完全由「三道闸是否按序生效」决定 —— 而这三道闸各自都好测
 * （`isLoopbackRequest` / `requireRequestUser` / `parseConsoleLine` 都有独立
 * 用例），**唯独它们在这份文件里的排列与「一个都不许省」**没有任何运行时用例
 * 抓得住：删掉回环检查之后，一个带着合法会话的请求照样 200，测起来一切正常。
 *
 * 这与 `tests/container-single-access.test.ts`（唯一装配点）、
 * `tests/film-resume-startup-point.test.ts`（唯一启动点）是同一类判据：
 * 被守的不是某段逻辑，而是**这份文件里那几行的存在与次序**。
 *
 * 正文里逐条说明「为什么必须是这个顺序」（顺序即成本：先便宜的后贵的）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROUTE = join(ROOT, "src/app/api/console/run/route.ts");
const source = readFileSync(ROUTE, "utf-8");

/** 剥掉注释再判形态：注释里出现「allow」这类词不该被当成代码。 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** 某个片段的出现位置；-1 = 没出现。 */
const at = (needle: string) => code.indexOf(needle);

describe("/api/console/run 的三道闸", () => {
  it("① 回环闸在最前：非本机的请求**先**被挡下，连会话都不查", () => {
    const loopback = at("isLoopbackRequest(req.headers)");
    const auth = at("requireRequestUser()");
    expect(
      loopback,
      "回环闸不见了 —— 这条路由会对着局域网敞开任意命令执行",
    ).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(-1);
    expect(loopback).toBeLessThan(auth);
    // 挡下时回 403（不是 401 —— 「不是本机」与「没登录」是两件事，
    // 混成一个状态码会让用户去查错方向）。
    expect(code).toContain("status: 403");
  });

  it("② 会话闸在解析命令之前：未登录不进入命令解析", () => {
    const auth = at("requireRequestUser()");
    const readBody = at("readJsonRecord(req)");
    const parse = at("parseConsoleLine(");
    expect(auth).toBeGreaterThan(-1);
    expect(readBody).toBeGreaterThan(auth);
    expect(parse).toBeGreaterThan(readBody);
    // 未登录走与其余 REST 面**同一条** 401 信封（不自己拼一份）。
    expect(code).toContain("unauthorizedResponse()");
  });

  it("③ 入参闸：长度先于解析，解析不通过不许起进程", () => {
    const lengthCheck = at("MAX_COMMAND_CHARS");
    const parse = at("parseConsoleLine(");
    expect(lengthCheck).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(-1);
    expect(lengthCheck).toBeLessThan(parse);
    // 解析失败即 400 返回，后面才轮到 `runner.run`。
    expect(code).toContain("status: 400");
    expect(at("runner.run(")).toBeGreaterThan(parse);
  });

  it("单槽：忙时 409 拒绝（而不是排队让用户以为点了没反应）", () => {
    expect(code).toContain("runner.busy()");
    expect(code).toContain("status: 409");
    expect(at("runner.busy()")).toBeLessThan(at("runner.run("));
  });

  it("断开即回收：cancel 里调 runner.cancel()，且用 cancelOnClose 判据避免重复杀", () => {
    expect(code).toContain("cancelOnClose");
    expect(code).toContain("runner.cancel()");
    /* 正常跑完（exit 帧已发）之后必须把 cancelOnClose 置 false —— 否则我们
     * 主动 close 流时还会去杀一次已经退出的 pid（失败路径上多一条噪声，
     * 且在「pid 被复用」的极端情况下会杀错进程）。 */
    expect(code).toMatch(/cancelOnClose\s*=\s*false/);
  });

  it("回路与其余流式路由同形：SSE 帧头与禁缓冲都写全", () => {
    expect(code).toContain("text/event-stream");
    expect(code).toContain("X-Accel-Buffering");
    expect(code).toContain("no-store");
  });

  it("预算常量只有一个出处（路由不许自己写死上限）", () => {
    expect(source).toContain("MAX_COMMAND_CHARS");
    expect(source).toContain("MAX_RUN_MS");
    // 路由里不得出现裸的数字上限（写死一处就会与界面/文档三处漂移）。
    expect(code).not.toMatch(/MAX_COMMAND_CHARS\s*=\s*\d/);
    expect(code).not.toMatch(/timeoutMs:\s*\d/);
  });
});
