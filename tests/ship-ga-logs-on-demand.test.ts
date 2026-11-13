/**
 * `scripts/ship-ga-logs-on-demand.mjs` 的判据（§12.20：把「手工 start-build → 再读回」
 * 收进一条 `pnpm ship --gh-logs pr:<号>`）。
 *
 * 钉住最容易静默失效的几件：
 *   ① 触发命令形状与 `.cnb.yml` 的 `api_trigger_ga_logs` 同源，且 `--sync false` 在场；
 *   ② 「发出去没有」只认 `sn` 回读 —— 退出码 0 不算，403 原文要转述（含 stderr）；
 *   ③ 等回读只认**新写出来的** `scope=all` marker，旧 `failed` 评论不冒充结果；
 *   ④ 等不到只给「没结论」，不改三态、不假装日志为空；
 *   ⑤ `--dry-run` 一条写动作都不发。
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { RELAY_MARKER } from "../scripts/ci-ga-logs-relay.mjs";
import type { ExecResult } from "../scripts/ship-exec.mjs";
import {
  awaitOnDemandRelay,
  ensureOnDemandLogs,
  ON_DEMAND_EVENT,
  onDemandTriggerArgs,
  triggerOnDemandLogs,
} from "../scripts/ship-ga-logs-on-demand.mjs";

const SLUG = "moon-read/comfy-app-t3";
const PR = 3684;
const ROOT = path.resolve(__dirname, "..");

/** 造一条 cnb -v 的 JSON 信封输出。 */
function envelope(data: unknown): string {
  return `status: 200\n${JSON.stringify({ status: 200, data })}`;
}

/** 造 relay 评论正文：`scope` 不给 = #3437 旧评论（按 failed 读）。 */
function markerBody(asset: string, scope?: string): string {
  const s = scope === undefined ? "" : ` scope=${scope}`;
  return (
    `<!-- ${RELAY_MARKER} run=4242 sha=${"c".repeat(40)} pr=${String(PR)} jobs=2 bytes=99${s} -->\n` +
    `[f.b64](/-/files/${asset})`
  );
}

/** 把一条正文压成 relay 附件的 base64（与 GA 侧脚本同形）。 */
function relayB64(text: string): string {
  return Buffer.from(gzipSync(Buffer.from(text, "utf8"))).toString("base64");
}

/** 每次调用时由 `nextComments` 决定「这一眼 CNB 上有没有评论」，模拟 relay 晚到。 */
function fakeRun(opts: { attachment: string; comments: () => unknown[]; startBuild?: ExecResult }) {
  const calls: string[] = [];
  const run = (_cmd: string, args: string[]): ExecResult => {
    const key = args.join(" ");
    calls.push(key);
    if (key.includes("start-build")) {
      return (
        opts.startBuild ?? {
          error: null,
          stderr: "",
          stdout: envelope({ sn: "cnb-test-1k79abc" }),
          status: 0,
        }
      );
    }
    if (key.includes("list-comments")) {
      return { error: null, stderr: "", stdout: envelope(opts.comments()), status: 0 };
    }
    if (key.includes("get-files")) {
      return { error: null, stderr: "", stdout: envelope(relayB64(opts.attachment)), status: 0 };
    }
    return { error: null, stderr: "", stdout: "{}", status: 0 };
  };
  return { calls, run };
}

describe("① 触发命令形状：与 .cnb.yml 的触发口同源", () => {
  it("argv 带事件 / PR 号 / --sync false，不带 --branch", () => {
    const args = onDemandTriggerArgs(SLUG, PR);
    expect(args.slice(0, 2)).toEqual(["build", "start-build"]);
    expect(args).toContain("--repo");
    expect(args).toContain(SLUG);
    expect(args).toContain(ON_DEMAND_EVENT);
    expect(args).toContain(`GA_LOG_PR_NUMBER=${String(PR)}`);
    expect(args).toContain("false");
    expect(args).not.toContain("--branch");
  });

  it("契约：事件名在 .cnb.yml 里真有一条同名的顶层流水线（不是凭空造的事件）", () => {
    const cnb = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    expect(cnb).toMatch(new RegExp(`^  ${ON_DEMAND_EVENT}:\\s*$`, "m"));
  });
});

describe("② 触发这一跳：只认 sn 回读，效应完整转述", () => {
  it("读到 sn ⇒ 算发出去，并念出 build 链接", () => {
    const lines: string[] = [];
    const { calls, run } = fakeRun({ attachment: "", comments: () => [] });
    const r = triggerOnDemandLogs({
      dryRun: false,
      log: (l) => lines.push(l),
      pr: PR,
      run,
      slug: SLUG,
    });
    expect(r.ok).toBe(true);
    expect(r.sn).toBe("cnb-test-1k79abc");
    expect(calls.some((c) => c.includes("start-build"))).toBe(true);
    expect(lines.join("\n")).toContain("按需触发已派发：build cnb-test-1k79abc");
  });

  it("退出码 0 但没 sn ⇒ 「没结论」，且 stderr 的 403 原文照念", () => {
    const lines: string[] = [];
    const { run } = fakeRun({
      attachment: "",
      comments: () => [],
      startBuild: {
        error: null,
        stderr: "403 Missing required scopes: repo-cnb-trigger:rw",
        stdout: 'status: 403\n{"errcode":10023}',
        status: 0,
      },
    });
    const r = triggerOnDemandLogs({
      dryRun: false,
      log: (l) => lines.push(l),
      pr: PR,
      run,
      slug: SLUG,
    });
    expect(r.ok).toBe(false);
    expect(r.sn).toBeNull();
    expect(lines.join("\n")).toContain("403 Missing required scopes");
    expect(lines.join("\n")).toContain("没有结论");
  });

  it("--dry-run 只念计划，一条 cnb 都不发", () => {
    const lines: string[] = [];
    const { calls, run } = fakeRun({ attachment: "", comments: () => [] });
    const r = triggerOnDemandLogs({
      dryRun: true,
      log: (l) => lines.push(l),
      pr: PR,
      run,
      slug: SLUG,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(lines.join("\n")).toContain("--dry-run 计划");
  });
});

describe("③ 等回读：只认新写出来的 scope=all 评论", () => {
  it("旧的 failed 评论不冒充按需结果，新 scope=all 到了才返回正文", async () => {
    const OLD = "u/key/old.b64";
    const NEW = "u/key/new.b64";
    let eyes = 0;
    const { run } = fakeRun({
      attachment: "== run 4242 / job「static-gates」（success）==\nlint ok\n",
      comments: () => {
        eyes += 1;
        if (eyes === 1) return [{ body: markerBody(OLD), id: "1" }];
        return [
          { body: markerBody(OLD), id: "1" },
          { body: markerBody(NEW, "all"), id: "2" },
        ];
      },
    });
    const lines: string[] = [];
    const r = await awaitOnDemandRelay({
      baselineAssetPath: OLD,
      intervalMs: 1,
      log: (l) => lines.push(l),
      maxMs: 10_000,
      pr: PR,
      run,
      sleep: () => Promise.resolve(),
      slug: SLUG,
    });
    expect(r.ok).toBe(true);
    expect(r.relay?.meta.scope).toBe("all");
    expect(r.relay?.text).toContain("lint ok");
    expect(r.tries).toBe(2);
    expect(lines.join("\n")).toContain("站内回读命中");
  });

  it("一直没等到 ⇒ 「没有结论」，不是「日志为空」", async () => {
    const OLD = "u/key/old.b64";
    let t = 0;
    const { run } = fakeRun({
      attachment: "",
      comments: () => [{ body: markerBody(OLD), id: "1" }],
    });
    const lines: string[] = [];
    const r = await awaitOnDemandRelay({
      baselineAssetPath: OLD,
      intervalMs: 1,
      log: (l) => lines.push(l),
      maxMs: 3,
      now: () => {
        t += 2;
        return t;
      },
      pr: PR,
      run,
      sleep: () => Promise.resolve(),
      slug: SLUG,
    });
    expect(r.ok).toBe(false);
    expect(r.relay).toBeNull();
    expect(lines.join("\n")).toContain("超预算");
    expect(lines.join("\n")).toContain("没有结论");
  });
});

describe("④ 整链：基线 → 触发 → 等回读", () => {
  it("CNB 侧原本没有评论 ⇒ 一条命令把日志拿回来", async () => {
    const NEW = "u/key/new.b64";
    let eyes = 0;
    const { calls, run } = fakeRun({
      attachment: "== run 4242 / job「lint」（success）==\nall green\n",
      comments: () => {
        eyes += 1;
        return eyes >= 2 ? [{ body: markerBody(NEW, "all"), id: "2" }] : [];
      },
    });
    const lines: string[] = [];
    const r = await ensureOnDemandLogs({
      dryRun: false,
      intervalMs: 1,
      log: (l) => lines.push(l),
      maxMs: 10_000,
      pr: PR,
      run,
      sleep: () => Promise.resolve(),
      slug: SLUG,
    });
    expect(r.source).toBe("on-demand");
    expect(r.relay?.text).toContain("all green");
    expect(calls.filter((c) => c.includes("start-build")).length).toBe(1);
    expect(lines.join("\n")).toContain("按需触发已派发");
  });

  it("触发没送达 ⇒ 不轮询、不读回，如实给没结论", async () => {
    const { calls, run } = fakeRun({
      attachment: "",
      comments: () => [],
      startBuild: { error: null, stderr: "403 no scope", stdout: "{}", status: 0 },
    });
    const lines: string[] = [];
    const r = await ensureOnDemandLogs({
      dryRun: false,
      intervalMs: 1,
      log: (l) => lines.push(l),
      maxMs: 10_000,
      pr: PR,
      run,
      sleep: () => Promise.resolve(),
      slug: SLUG,
    });
    expect(r.source).toBe("trigger-failed");
    expect(r.relay).toBeNull();
    /* 触发没送达 ⇒ 一次都不进轮询、也不读附件：只念出平台原文就收手。 */
    expect(calls.filter((c) => c.includes("list-comments"))).toHaveLength(0);
    expect(calls.filter((c) => c.includes("get-files"))).toHaveLength(0);
  });

  it("--dry-run 一条写动作都不发", async () => {
    const { calls, run } = fakeRun({ attachment: "", comments: () => [] });
    const lines: string[] = [];
    const r = await ensureOnDemandLogs({
      dryRun: true,
      intervalMs: 1,
      log: (l) => lines.push(l),
      maxMs: 10_000,
      pr: PR,
      run,
      sleep: () => Promise.resolve(),
      slug: SLUG,
    });
    expect(r.source).toBe("dry-run");
    expect(calls.some((c) => c.includes("start-build"))).toBe(false);
    expect(lines.join("\n")).toContain("--dry-run 计划");
  });
});
