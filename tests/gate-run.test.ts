/**
 * `pnpm gate run`（ISSUE #5173）：只从钩子步骤与 GATES 解析，不另立清单。
 */
import { describe, expect, it } from "vitest";

import { findGate, parseHookSteps } from "../scripts/gates/gate-run.mjs";

const HOOK = [
  '# run "说明" 不解析',
  '  run "CHANGELOG 碎片" node scripts/gates/check-changelog-fragments.cjs',
  'run "依赖新鲜度" node scripts/gates/check-deps-freshness.mjs --staged',
].join("\n");

describe("parseHookSteps", () => {
  it("只取真正可执行的 run 行，注释不算", () => {
    expect(parseHookSteps(HOOK)).toHaveLength(2);
    expect(parseHookSteps(HOOK)[0]?.label).toBe("CHANGELOG 碎片");
  });
});

describe("findGate", () => {
  const gates = { typecheck: { label: "Typecheck (tsc --noEmit)", args: ["typecheck"] } };
  it("按标签 / 脚本名 / basename 命中唯一一条", () => {
    expect(findGate({ hook: HOOK, gates, query: "CHANGELOG" })).toHaveLength(1);
    expect(findGate({ hook: HOOK, gates, query: "check-changelog-fragments" })[0]?.source).toBe(
      "pre-commit",
    );
    expect(findGate({ hook: HOOK, gates, query: "typecheck" })[0]?.source).toBe("quality-gate");
  });
  it("多名命中就报多条，不替人挑", () => {
    expect(findGate({ hook: HOOK, gates, query: "check" }).length).toBeGreaterThan(1);
  });
});
