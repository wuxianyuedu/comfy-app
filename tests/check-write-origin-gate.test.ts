/**
 * `scripts/gates/check-write-origin-gate.cjs`（#4723 的防复发门禁）：带写方法
 * （POST/PUT/DELETE/PATCH）的 REST 路由必须过 `~/server/lib/same-origin` 的
 * 统一同源出口。硬闸：命中即退 1。同 `check-ui-logic-separation`：复制进一次性
 * workspace 再跑，绝不往真 `src/` 种文件（并行会话共用检出）。
 */
import { defineGateRepo, expectGateRan } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "gates/check-write-origin-gate.cjs",
});

test("带写方法但未过同源闸 → 红并点名文件", ({ repo }) => {
  repo.write("src/app/api/x/route.ts", "export async function POST() {\n  return null;\n}\n");
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(1);
  expect(r.output).toContain("src/app/api/x/route.ts");
  expect(r.output).toContain("同源闸");
});

test("过闸的写路由 → 绿", ({ repo }) => {
  repo.write(
    "src/app/api/x/route.ts",
    'import { rejectCrossOriginWrite } from "~/server/lib/same-origin";\n' +
      "export async function POST(req: Request) {\n" +
      "  const crossOrigin = rejectCrossOriginWrite(req);\n" +
      "  if (crossOrigin !== null) {\n" +
      "    return crossOrigin;\n" +
      "  }\n" +
      "  return null;\n" +
      "}\n",
  );
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(0);
});

test("只读路由（仅 GET）不要求过闸", ({ repo }) => {
  repo.write("src/app/api/x/route.ts", "export async function GET() {\n  return null;\n}\n");
  const r = repo.run();
  expectGateRan(r);
  expect(r.code).toBe(0);
});
