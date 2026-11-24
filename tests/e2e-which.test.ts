/**
 * `pnpm e2e:which` —— 按改动面给出相关 E2E spec 的只读映射（ISSUE #4876）。
 *
 * 判据钉在三件事上：① 改了某条 spec 的判据就只建议跑那条（最小读数）；
 * ② 改了公共地基 / 执行链路就按面提示 @critical / 出图主链路，不伪造精确命令；
 * ③ 参数与空改动面都落「没有结论」，不冒充「不用跑」。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { isRecord } from "../src/lib/is-record";

import {
  E2E_COMMON_FACES,
  EXECUTION_FACES,
  e2eSection,
  mapE2eSelection,
  parseArgs,
} from "../scripts/gates/e2e-which.mjs";

const SCRIPT = join(process.cwd(), "scripts", "gates", "e2e-which.mjs");

function run(args: Array<string> = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { code: 0, output };
  } catch (error) {
    const e: { status?: unknown; stderr?: unknown; stdout?: unknown } =
      typeof error === "object" && error !== null ? error : {};
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${typeof e.stdout === "string" ? e.stdout : ""}${
        typeof e.stderr === "string" ? e.stderr : ""
      }`,
    };
  }
}

describe("e2e:which —— 参数解析", () => {
  test("`--changed a b` 收成名单，`--json` 单列", () => {
    expect(parseArgs(["--changed", "e2e/a.spec.ts", "e2e/b.spec.ts"])).toEqual({
      changed: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
      json: false,
      help: false,
      unknown: [],
    });
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  test("名单在下一个旗标处截断；不认识的参数单列", () => {
    expect(parseArgs(["--changed", "a.ts", "--json"]).changed).toEqual(["a.ts"]);
    expect(parseArgs(["--bogus"]).unknown).toEqual(["--bogus"]);
  });
});

describe("e2e:which —— 改动面映射", () => {
  test("改了某条 spec 的判据 ⇒ 只建议跑那条，命令指名该文件", () => {
    const sel = mapE2eSelection(["e2e/view-tabs.spec.ts"]);
    expect(sel.specs).toEqual(["e2e/view-tabs.spec.ts"]);
    expect(sel.command).toBe("pnpm test:e2e e2e/view-tabs.spec.ts");
    expect(sel.reasons["e2e/view-tabs.spec.ts"]).toContain("判据");
  });

  test("多条 spec 命中 ⇒ 都列出，命令按 spec 顺序拼", () => {
    const sel = mapE2eSelection(["e2e/main-journey.spec.ts", "e2e/theme-toggle.spec.ts"]);
    expect(sel.specs).toEqual(["e2e/main-journey.spec.ts", "e2e/theme-toggle.spec.ts"]);
    expect(sel.command).toBe("pnpm test:e2e e2e/main-journey.spec.ts e2e/theme-toggle.spec.ts");
  });

  test("改了公共地基 ⇒ 提示 @critical，不伪造某一条 spec", () => {
    const sel = mapE2eSelection(["playwright.config.ts"]);
    expect(sel.specs).toEqual([]);
    expect(sel.command).toBeNull();
    expect(sel.broad.join(" ")).toContain("@critical");
    expect(E2E_COMMON_FACES).toContain("playwright.config.ts");
  });

  test("动了执行链路 ⇒ 建议跑出图主链路；与 spec 命中同在时不重复加", () => {
    const sel = mapE2eSelection(["src/lib/comfyui/lifecycle.ts"]);
    expect(sel.specs).toContain("e2e/main-journey.spec.ts");
    expect(sel.execution).toBe(true);
    expect(EXECUTION_FACES).toContain("src/lib/comfyui/**");

    const both = mapE2eSelection(["e2e/main-journey.spec.ts", "src/lib/sqlite-index.ts"]);
    expect(both.specs.filter((s) => s === "e2e/main-journey.spec.ts")).toHaveLength(1);
  });

  test("改了未登记的 spec 本身 ⇒ 恒等建议跑它自己，不落「无登记」（ISSUE #4942）", () => {
    /* nav-auto-collapse 不在 SPEC_FACES 登记表里 —— 此前自改时只能拿到「自行判断」。 */
    const sel = mapE2eSelection(["e2e/nav-auto-collapse.spec.ts"]);
    expect(sel.specs).toEqual(["e2e/nav-auto-collapse.spec.ts"]);
    expect(sel.command).toBe("pnpm test:e2e e2e/nav-auto-collapse.spec.ts");
    expect(sel.reasons["e2e/nav-auto-collapse.spec.ts"]).toContain("本身");
    expect(sel.note).not.toContain("自行判断");
  });

  test("登记过的 spec 仍用登记说明，恒等映射不覆盖它", () => {
    const sel = mapE2eSelection(["e2e/view-tabs.spec.ts"]);
    expect(sel.reasons["e2e/view-tabs.spec.ts"]).toContain("判据");
    expect(sel.reasons["e2e/view-tabs.spec.ts"]).not.toContain("本身");
  });

  test("e2e 下的非 spec 文件不恒等命中：support 仍走公共地基提示", () => {
    const sel = mapE2eSelection(["e2e/support/trpc-stub.ts"]);
    expect(sel.specs).toEqual([]);
    expect(sel.broad.join(" ")).toContain("@critical");
  });

  test("没命中任何登记 ⇒ 明说「自行判断」，不冒充「不用跑」", () => {
    const sel = mapE2eSelection(["docs/README.md"]);
    expect(sel.specs).toEqual([]);
    expect(sel.command).toBeNull();
    expect(sel.note).toContain("自行判断");
    const text = e2eSection(["docs/README.md"], sel).join("\n");
    expect(text).toContain("建议跑");
    expect(text).toContain("自行判断");
  });

  test("反斜杠路径先归一（Windows 的 git 可能给 `\\`）", () => {
    const sel = mapE2eSelection([String.raw`e2e\view-tabs.spec.ts`]);
    expect(sel.specs).toEqual(["e2e/view-tabs.spec.ts"]);
  });
});

describe("e2e:which —— 入口本身", () => {
  test("`--help` ⇒ 退 0，讲清读数与退码", () => {
    const { code, output } = run(["--help"]);
    expect(code).toBe(0);
    expect(output).toContain("--changed");
    expect(output).toContain("没有结论");
  });

  test("空名单 ⇒ 退 2，说清这不是「改动面为空」", () => {
    const { code, output } = run(["--changed"]);
    expect(code).toBe(2);
    expect(output).toContain("没给名单");
  });

  test("不认识的旗标 ⇒ 退 2", () => {
    const { code, output } = run(["--changd", "e2e/a.spec.ts"]);
    expect(code).toBe(2);
    expect(output).toContain("--changd");
  });

  test("入口复现 ISSUE #4942：--changed 指向未登记 spec ⇒ 退 0 且给出该 spec 自己", () => {
    const { code, output } = run(["--changed", "e2e/nav-auto-collapse.spec.ts"]);
    expect(code).toBe(0);
    expect(output).toContain("e2e/nav-auto-collapse.spec.ts");
    expect(output).toContain("pnpm test:e2e e2e/nav-auto-collapse.spec.ts");
    expect(output).not.toContain("无登记");
  });

  test("给一条 spec 路径 ⇒ 退 0，人读与 JSON 两种形态都给读数", () => {
    const human = run(["--changed", "e2e/main-journey.spec.ts"]);
    expect(human.code).toBe(0);
    expect(human.output).toContain("e2e/main-journey.spec.ts");
    expect(human.output).toContain("pnpm test:e2e");

    const json = run(["--changed", "e2e/main-journey.spec.ts", "--json"]);
    expect(json.code).toBe(0);
    const raw: unknown = JSON.parse(json.output);
    expect(isRecord(raw)).toBe(true);
    if (!isRecord(raw)) throw new Error("unreachable：上一行已断言");
    expect(Array.isArray(raw.specs)).toBe(true);
    expect(raw.specs).toContain("e2e/main-journey.spec.ts");
    expect(typeof raw.command).toBe("string");
    expect(String(raw.command)).toContain("pnpm test:e2e");
  });
});
