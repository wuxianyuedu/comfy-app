/**
 * CI 生产启动必须有真实的 `BETTER_AUTH_SECRET`（ISSUE #489）
 * ===========================================================================
 *
 * 背景：CI 的 Build / E2E 两步只设 `SKIP_ENV_VALIDATION=1`，不注入
 * `BETTER_AUTH_SECRET`。而 `SKIP_ENV_VALIDATION=1` 只绕过 `src/env.js` 的
 * schema 校验，**绕过不了 better-auth 自己的生产校验**：`next start`（生产
 * 模式）下该值缺失 → better-auth 退回内置 `DEFAULT_SECRET` → 抛
 * `You are using the default secret. Please set BETTER_AUTH_SECRET …` →
 * `createTRPCContext()` 抛错 → 所有 `authedProcedure` 全灭。
 *
 * 实测后果：3 条 @critical 用例（ComfyUI 页签内嵌 / 不可嵌说明 / 浏览器打开）
 * 全部挂在同一个 helper 上 —— 它们守卫的是「设置页整体读不出来」这一类退化，
 * 门禁却因此对这类退化**失去信号**。而它们又是 CI 里唯一跑真浏览器的关节。
 *
 * 为什么本地/Windows 从不发现：桌面启动器会自动生成 `.env`，`BETTER_AUTH_SECRET`
 * 是真的；`next dev` 下 `NODE_ENV !== "production"` 也不触发该校验。**只有
 * 「无 `.env` 的生产启动」这一个组合会炸** —— CI 与全新 Linux 检出正好都是。
 *
 * 本用例把「CI 里凡设了 SKIP_ENV_VALIDATION 的步骤，必须一并注入
 * BETTER_AUTH_SECRET」这条约定锁成可失败断言，防止下次有人只搬 SKIP_ENV_VALIDATION。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CI_PATH = join(process.cwd(), ".github", "workflows", "ci.yml");
const ci = readFileSync(CI_PATH, "utf8");

/** 从 `- name: X` 处切出该步骤的 YAML 片段（到下一个同级 `- name:` 或文件末）。 */
function stepBlocks(src: string): { name: string; body: string }[] {
  const re = /^ {6}- name: (.+)$/gm;
  const marks: { name: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    marks.push({ name: (m[1] ?? "").trim(), start: m.index });
  }
  return marks.map((mk, i) => ({
    name: mk.name,
    body: src.slice(mk.start, marks[i + 1]?.start ?? src.length),
  }));
}

const steps = stepBlocks(ci);

describe("CI 步骤：SKIP_ENV_VALIDATION 必须与 BETTER_AUTH_SECRET 成对", () => {
  it("至少解析出预期数量的 CI 步骤（防止切片判据自己失效）", () => {
    // 反向锚点：若 YAML 缩进变了导致 `stepBlocks` 一个都切不出来，
    // 下面的断言会「因为没命中而恒真」——这里先把解析结果钉住。
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps.map((s) => s.name)).toContain("Build");
    expect(steps.map((s) => s.name)).toContain("E2E (Playwright @critical)");
  });

  const withSkip = steps.filter((s) => s.body.includes("SKIP_ENV_VALIDATION"));

  it("确实有设 SKIP_ENV_VALIDATION 的步骤（否则本用例失去对象）", () => {
    expect(withSkip.length).toBeGreaterThanOrEqual(2);
  });

  it.each(
    // 用例名带步骤名，失败时能直接指出是哪一步漏了
    ["Build", "E2E (Playwright @critical)"],
  )("步骤「%s」在跳过 env 校验的同时注入 BETTER_AUTH_SECRET", (name) => {
    const step = steps.find((s) => s.name === name);
    expect(step, `CI 里找不到步骤「${name}」`).toBeDefined();
    const body = step?.body ?? "";
    // 判据必须落在 **env 键**上，不能写成「片段里出现过这个词」：步骤的说明
    // 注释里也会提到 BETTER_AUTH_SECRET（本仓库正是这么写的），拿 `toContain`
    // 去查会被注释放过 —— 那就成了「注释写了就算注入」的自欺。
    const envVars = [...body.matchAll(/^ {10}([A-Z0-9_]+):/gm)].map((x) => x[1]);
    expect(envVars, `步骤「${name}」没有可解析的 env 键`).toContain(
      "SKIP_ENV_VALIDATION",
    );
    expect(
      envVars,
      `步骤「${name}」设了 SKIP_ENV_VALIDATION 却没在 env 里注入 BETTER_AUTH_SECRET：` +
        `生产模式下 better-auth 会退回内置 DEFAULT_SECRET 并抛错，` +
        `所有 authedProcedure 全灭（设置页整页读不出来），` +
        `3 条 @critical 用例会集体挂在同一个 helper 上（ISSUE #489）`,
    ).toContain("BETTER_AUTH_SECRET");
  });

  it("注入的 BETTER_AUTH_SECRET 满足 schema 的 min(32)（否则等于没注入）", () => {
    const re = /BETTER_AUTH_SECRET:\s*"([^"]+)"/g;
    const values = [...ci.matchAll(re)].map((x) => x[1] ?? "");
    expect(values.length, "CI 里没有出现 BETTER_AUTH_SECRET 的值").toBeGreaterThan(0);
    for (const v of values) {
      expect(v.length, `BETTER_AUTH_SECRET 占位值不足 32 字符：${v.length}`).toBeGreaterThanOrEqual(32);
    }
  });
});
