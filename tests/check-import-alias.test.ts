/**
 * import 别名门禁的自测（ISSUE #640）：`@/` 与 `~/` 在 `tsconfig.json` 的 `paths` 里都能解析，写错不报错
 * 也不变色，代价只是风格分叉。判据须精确到「哪一行是静态模块说明符」，且不能误伤注释——注释里写
 * 「旧写法是 @/…」正是 §12.4.1 要求的 Why。用临时仓库跑真脚本，断言该拦的拦、该放的放，别让门禁变成误报源。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { copyGateDeps } from "./helpers/gate-repo";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-import-alias.cjs");
const tempDirs: Array<string> = [];

/** 造一个只含被测文件的临时仓库（脚本按仓库根解析扫描目录）。 */
function scanner(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "import-alias-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  /* 判据 `require("./gate-scan-read.cjs")`（`--staged` 的共享短路器）—— 临时仓库只放得下被测那一份脚本时，缺依赖的表现是可读性极差的 requireStack，所以按 `require("./x.cjs")` 递归补齐（同 `tests/helpers/gate-repo.ts` 的文件头）。 */
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  copyGateDeps(path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (): { ok: boolean; output: string } => {
    try {
      return {
        ok: true,
        output: execFileSync(
          process.execPath,
          [path.join(root, "scripts", path.basename(SCRIPT))],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (error) {
      /* SAFETY: 类型断言已复核 */
      const e = error as { stderr?: string; stdout?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };
  return { run };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-import-alias", () => {
  it("放行统一用 ~ 前缀的 import", () => {
    const { run } = scanner({
      "src/components/ui/empty-state.tsx":
        'import { cn } from "~/lib/utils";\nexport const a = cn("p-2");\n',
    });
    const { ok, output } = run();
    expect(output).toContain("[alias] OK");
    expect(ok).toBe(true);
  });

  it('拦下 `from "@/…"`（含 src/components/ui，shadcn 生成物默认写法）', () => {
    const { run } = scanner({
      "src/components/ui/status-badge.tsx":
        'import { cn } from "@/lib/utils";\nexport const a = cn("p-2");\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("src/components/ui/status-badge.tsx:1");
    expect(output).toContain("@/lib/utils");
  });

  it("拦下动态 import 与 vi.mock 里的 @/（非 import 语句的等价写法）", () => {
    const { run } = scanner({
      "src/app/workspace/page.tsx": 'export const lazy = () => import("@/components/studio");\n',
      "src/components/studio/hooks/use-x.test.ts": 'vi.mock("@/lib/media/media", () => ({}));\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("src/app/workspace/page.tsx:1");
    expect(output).toContain("src/components/studio/hooks/use-x.test.ts:1");
  });

  it("注释里的 `@/…` 放行（解释旧写法来由的 Why 不该被逼删）", () => {
    const { run } = scanner({
      "src/lib/app-settings/index.ts":
        "// 默认端口只有一处定义：`@/lib/endpoints` —— 需要常量的地方直接引它。\n" +
        "export const a = 1;\n",
      "src/server/workshop/types.ts":
        "/** 来自 @/lib/workshop/types 的数据模型 */\nexport const b = 2;\n",
    });
    const { ok, output } = run();
    expect(output).not.toContain("别名用");
    expect(ok).toBe(true);
  });

  it("相对路径与第三方包名不受影响（只管别名前缀）", () => {
    const { run } = scanner({
      "src/lib/foo.ts":
        'import { readFileSync } from "node:fs";\nimport x from "./bar";\nimport y from "@scope/pkg";\n',
    });
    const { ok } = run();
    expect(ok).toBe(true);
  });

  it("e2e/ 也在扫描范围内（同一份判据，不让 e2e 变成缺口）", () => {
    const { run } = scanner({
      "e2e/helpers.ts": 'export { x } from "@/lib/endpoints";\n',
    });
    const { ok, output } = run();
    expect(ok).toBe(false);
    expect(output).toContain("e2e/helpers.ts:1");
  });
});
