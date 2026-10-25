/**
 * 平台侧跑用例**之前**的两道体检（`scripts/ci-worktree-deps.mjs`）。
 *
 * 这条判据补的是一格**被读错过**的现场：`受影响用例` 的输出里出现一串 `Error:` 与
 * 一段 `AggregateError`、一条断言都没红，而那一格非零退出 —— 于是「这台机器上依赖
 * 没装上」被写成「这次改动有回归」，被拦下的人照着那屏去查代码，查的是一件没发生的
 * 事。判据因此钉三件事：
 *
 *   ① **判据是 `node_modules/.modules.yaml`**，不是「目录在不在」—— 空目录与「装好了」
 *      在 `existsSync(directory)` 眼里是同一件事，而那个区别正是这一格的全部内容；
 *   ② 环境里串进来的 `npm_config_*` 要被认出来（前缀 / store / global 那几条带执行期
 *      校验，配错时每次 pnpm 都抛 AggregateError）；
 *   ③ 不 ok 时**必须**给出一条能粘的下一步 —— 这一档放行与否不由本模块决定，它唯一
 *      的产物就是那句话（写了没有读者等于没写）。
 */
import { describe, expect, it } from "vitest";

import {
  describeWorktreeDeps,
  NPM_CONFIG_KEYS,
  worktreeDepsProblem,
} from "../scripts/ci-worktree-deps.mjs";

describe("依赖面体检：装没装上", () => {
  it("`node_modules/.modules.yaml` 不在 ⇒ 不 ok，且下一步是那条装命令", () => {
    const r = worktreeDepsProblem({ installed: false });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain(".modules.yaml");
    expect(r.advice).toContain("pnpm install --frozen-lockfile");
  });

  it("装了 ⇒ ok，一句话读数", () => {
    const r = worktreeDepsProblem({ installed: true });
    expect(r.ok).toBe(true);
    expect(r.advice).toBeNull();
    expect(describeWorktreeDeps(r)).toContain("都过了");
  });

  it("读数里点明「这与用例红是两件事」—— 那一屏的原文就是 AggregateError", () => {
    const text = describeWorktreeDeps(
      worktreeDepsProblem({ installed: false }),
    );
    expect(text).toContain("AggregateError");
    expect(text).toContain("不是用例红");
    /* 这一档**不是绿也不是红**：不许被读成任何一种结论。 */
    expect(text).toContain("不算绿也不算红");
  });
});

describe("依赖面体检：npm_config_* 干净不干净", () => {
  it("干净的环境一个字都不报", () => {
    expect(worktreeDepsProblem({ installed: true, env: {} }).ok).toBe(true);
    /* 良性覆盖（registry / 别的 npm_config_ 项）**刻意不收**：报它只会让人学会忽略这条
     * 读数。这里判的是「不在名单里就不出声」。 */
    expect(
      worktreeDepsProblem({
        installed: true,
        env: { npm_config_registry: "https://registry.npmjs.org" },
      }).ok,
    ).toBe(true);
  });

  it("名单里的键串进来 ⇒ 不 ok，并把「清哪几个」点名", () => {
    const r = worktreeDepsProblem({
      installed: true,
      env: { npm_config_prefix: "D:/pnpm", npm_config_store_dir: "D:/pnpm" },
    });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("npm_config_prefix");
    expect(r.lines.join("\n")).toContain("npm_config_store_dir");
    expect(r.advice).toContain("unset npm_config_prefix");
  });

  it("空串 / 只有空白不算「置着」（与 `emptyStringAsUndefined` 同一口径）", () => {
    for (const v of ["", "   "]) {
      expect(
        worktreeDepsProblem({ installed: true, env: { npm_config_prefix: v } })
          .ok,
        `值 ${JSON.stringify(v)} 不该被读成「置着」`,
      ).toBe(true);
    }
  });

  it("两道都不成立时两条出路都给（不许只报第一条）", () => {
    const r = worktreeDepsProblem({
      installed: false,
      env: { npm_config_global: "true" },
    });
    expect(r.lines).toHaveLength(2);
    expect(r.advice).toContain("install");
    expect(r.advice).toContain("unset");
  });

  it("名单本身是「会影响安装形态」的那几个，不是 `npm_` 全前缀", () => {
    expect(NPM_CONFIG_KEYS).toContain("npm_config_prefix");
    expect(NPM_CONFIG_KEYS).toContain("npm_config_store_dir");
    /* `npm_package_*` 是 pnpm 给 lifecycle 脚本的，不是症状。 */
    expect(NPM_CONFIG_KEYS.some((k) => k.startsWith("npm_package"))).toBe(
      false,
    );
  });
});
