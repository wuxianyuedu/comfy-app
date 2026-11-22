/**
 * `scripts/gates/check-server-bare-fetch.cjs`（#4724 的防复发门禁）：服务端身份
 * 的模块（src/server、src/app/api、声明 server-only / .server.ts 的 src/lib）
 * 出现绕过 safeFetch 的裸 `fetch(` 即红。硬闸：命中即退 1。
 */
import { defineGateRepo, expectGateRan } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "gates/check-server-bare-fetch.cjs",
});

test("src/server 内裸 fetch → 红并报行号", ({ repo }) => {
  repo.write(
    "src/server/thing.ts",
    'export async function f(): Promise<unknown> {\n  return fetch("http://example.invalid");\n}\n',
  );
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(1);
  expect(r.output).toContain("src/server/thing.ts:2");
});

test("src/app/api 同在扫描面；safeFetch 调用不算裸 fetch", ({ repo }) => {
  repo.write(
    "src/app/api/x/route.ts",
    'import { safeFetch } from "~/lib/network/outbound-url.server";\n' +
      "export async function f(): Promise<unknown> {\n" +
      '  return safeFetch("http://example.invalid", { scenario: "llm-upstream" });\n' +
      "}\n",
  );
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(0);
});

test("声明 server-only / .server.ts 的 src/lib 模块在扫描面；注释里的 fetch( 不算", ({ repo }) => {
  repo.write(
    "src/lib/a.server.ts",
    'export async function f(): Promise<unknown> {\n  return fetch("http://example.invalid");\n}\n',
  );
  repo.write(
    "src/lib/b.ts",
    'import "server-only";\n// 这行注释提到 fetch( 形态，不是调用\nexport const x = 1;\n',
  );
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(1);
  expect(r.output).toContain("src/lib/a.server.ts:2");
  expect(r.output).not.toContain("src/lib/b.ts");
});

test("未声明服务端身份的 src/lib 模块不在扫描面（客户端同源调用不误伤）", ({ repo }) => {
  repo.write(
    "src/lib/browser-thing.ts",
    'export const f = (): Promise<unknown> => fetch("/api/x");\n',
  );
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(0);
});
