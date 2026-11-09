/**
 * `scripts/ship-ga-logs-cnb.mjs` 的判据（ISSUE #3437 本地 CNB 站内读回）。
 *
 * 钉住四件最容易静默失效的事：
 *   ① `findRelayComment` 倒着扫列表认**最新**一条 marker（平台列表是旧→新、不支持 sort）；
 *   ② `readRelayAttachment` 只认平台 JSON 信封的 `data` 字符串；
 *   ③ `decodeRelayPayload` 的 gzip→base64 往返，坏数据回 null 不抛；
 *   ④ `readRelayLogs` 三跳任一缺席回 null（由调用方退回 GitHub 链路，不改三态）。
 * 另钉 marker 身份读数与相对/绝对链接两种形状（与 relay 侧同一份 `parseRelayComment`）。
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import type { ExecResult } from "../scripts/ship-exec.mjs";
import {
  decodeRelayPayload,
  findRelayComment,
  readRelayAttachment,
  readRelayLogs,
  readRelayMarker,
  RELAY_MARKER,
} from "../scripts/ship-ga-logs-cnb.mjs";

const SHA = "b".repeat(40);
const ASSET = "u/key/f.b64";

/** 造一条 cnb -v 的 JSON 信封输出。 */
function envelope(data: unknown): string {
  return `status: 200\n${JSON.stringify({ status: 200, data })}`;
}

/** 把「命令 → 输出」做成 run 执行者。 */
function fakeRun(map: Record<string, string>) {
  return (_cmd: string, args: string[]): ExecResult => {
    const key = args.join(" ");
    for (const [needle, out] of Object.entries(map)) {
      if (key.includes(needle)) {
        return { error: null, status: 0, stderr: "", stdout: out };
      }
    }
    return { error: null, status: 0, stderr: "", stdout: "{}" };
  };
}

function commentBody(extra = ""): string {
  return (
    `<!-- ${RELAY_MARKER} run=4242 sha=${SHA} pr=3437 jobs=2 bytes=99${extra} -->\n` +
    `[f.b64](/-/files/${ASSET})`
  );
}

describe("① 认最新一条 marker（列表旧→新）", () => {
  it("倒着扫，命中最新那条而不是更早的", () => {
    const run = fakeRun({
      "list-comments": envelope([
        { body: "普通评论", id: "1" },
        { body: commentBody(), id: "2" },
        {
          body: `<!-- ${RELAY_MARKER} run=9999 sha=${SHA} pr=3437 jobs=1 bytes=1 -->\n[old](/-/files/u/key/old.b64)`,
          id: "3",
        },
      ]),
    });
    const hit = findRelayComment(run, "moon-read/comfy-app-t3", 3437);
    expect(hit?.run).toBe("9999");
    expect(hit?.assetPath).toBe("u/key/old.b64");
  });
  it("列表读不到 / 没有 marker ⇒ null", () => {
    expect(findRelayComment(fakeRun({ "list-comments": "not json" }), "a/b", 1)).toBeNull();
    expect(
      findRelayComment(
        fakeRun({ "list-comments": envelope([{ body: "none", id: "1" }]) }),
        "a/b",
        1,
      ),
    ).toBeNull();
  });
  it("平台把相对链补成绝对 URL 也认得回", () => {
    const absolute = `<!-- ${RELAY_MARKER} run=7 sha=${SHA} pr=9 jobs=1 bytes=1 -->\n[f](https://cnb.cool/a/b/-/files/${ASSET})`;
    expect(readRelayMarker(absolute)?.assetPath).toBe(ASSET);
  });
});

describe("② 读附件：只认 data 字符串", () => {
  it("正常读回 base64 文本", () => {
    const b64 = Buffer.from("hello").toString("base64");
    expect(readRelayAttachment(fakeRun({ "get-files": envelope(b64) }), "a/b", ASSET)).toBe(b64);
  });
  it("data 不是字符串 / 缺 data / 不是 JSON ⇒ null", () => {
    expect(
      readRelayAttachment(fakeRun({ "get-files": envelope({ x: 1 }) }), "a/b", ASSET),
    ).toBeNull();
    expect(
      readRelayAttachment(fakeRun({ "get-files": JSON.stringify({ status: 200 }) }), "a/b", ASSET),
    ).toBeNull();
    expect(readRelayAttachment(fakeRun({ "get-files": "not json" }), "a/b", ASSET)).toBeNull();
  });
});

describe("③ base64 → gzip 往返", () => {
  it("能还原正文，且空白（折行）不影响", () => {
    const raw = "== run 4242 / job「heavy-gates」==\n##[error]boom\n";
    const b64 = Buffer.from(gzipSync(Buffer.from(raw))).toString("base64");
    const wrapped = b64.replaceAll(/(?<chunk>.{20})/gu, "$<chunk>\n");
    expect(decodeRelayPayload(b64)).toBe(raw);
    expect(decodeRelayPayload(wrapped)).toBe(raw);
  });
  it("空串 / 坏 base64 / 非 gzip ⇒ null，不抛", () => {
    expect(decodeRelayPayload("")).toBeNull();
    expect(decodeRelayPayload("!!!!not base64!!!!")).toBeNull();
    expect(decodeRelayPayload(Buffer.from("plain text").toString("base64"))).toBeNull();
  });
});

describe("④ readRelayLogs：任一跳缺席回 null", () => {
  const raw = "== run 4242 / job「x」==\n##[error]boom\n";
  const b64 = Buffer.from(gzipSync(Buffer.from(raw))).toString("base64");
  it("三跳齐全 ⇒ 正文 + 身份读数", () => {
    const run = fakeRun({
      "get-files": envelope(b64),
      "list-comments": envelope([{ body: commentBody(), id: "2" }]),
    });
    const r = readRelayLogs({ number: 3437, run, slug: "a/b" });
    expect(r?.text).toBe(raw);
    expect(r?.meta.run).toBe("4242");
    expect(r?.meta.sha).toBe(SHA);
    expect(r?.meta.jobs).toBe(2);
  });
  it("评论缺席 / 附件缺席 / 正文坏掉 ⇒ null", () => {
    expect(
      readRelayLogs({
        number: 1,
        run: fakeRun({
          "get-files": envelope(b64),
          "list-comments": envelope([{ body: "x", id: "1" }]),
        }),
        slug: "a/b",
      }),
    ).toBeNull();
    expect(
      readRelayLogs({
        number: 1,
        run: fakeRun({
          "get-files": "{}",
          "list-comments": envelope([{ body: commentBody(), id: "2" }]),
        }),
        slug: "a/b",
      }),
    ).toBeNull();
    expect(
      readRelayLogs({
        number: 1,
        run: fakeRun({
          "get-files": envelope("bad!!!"),
          "list-comments": envelope([{ body: commentBody(), id: "2" }]),
        }),
        slug: "a/b",
      }),
    ).toBeNull();
  });
});
