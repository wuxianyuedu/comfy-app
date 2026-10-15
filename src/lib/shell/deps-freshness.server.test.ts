/**
 * 回归护栏：依赖面新鲜度的**服务端读取**（`/api/dev/build-id` 那一档的产出方）。
 *
 * 它回答的问题是：「这一版跑着的依赖，是不是仓库 lockfile 那一份？」——
 * 用户侧的动作不同（前者是 `Ctrl+R`，后者要**停服务 + `pnpm install`**），
 * 所以形态必须分得清：`drift`（拉了新代码没重装）/ `no-install`（从没装好）/
 * `unresolved`（lockfile 一致、个别声明依赖解析不到）/ `fresh`。
 *
 * 判据本身（`lockfileDrift` / `unresolvableDeclaredDeps`）另有用例覆盖，这里只钉
 * 本函数的**翻译与守卫**：
 *   · 非 development 环境直接返回 null（生产不该去摸 git / lockfile）；
 *   · 没有 lockfile（检出可能不完整）→ 不提示（无法判定 ≠ 陈旧）；
 *   · 四态各自映射到 `{stale, state}`，`unresolved` 带上缺失清单。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lockfileDrift,
  unresolvableDeclaredDeps,
} from "../../../scripts/launcher-core/worktree.mjs";

import { readDepsFreshness } from "./deps-freshness.server";

vi.mock("../../../scripts/launcher-core/worktree.mjs", () => ({
  lockfileDrift: vi.fn(),
  unresolvableDeclaredDeps: vi.fn(),
}));

const drift = vi.mocked(lockfileDrift);
const missingProbe = vi.mocked(unresolvableDeclaredDeps);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  drift.mockReset();
  missingProbe.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readDepsFreshness", () => {
  it("非 development 环境 → null（不参与判据，也不去摸 git / lockfile）", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(readDepsFreshness("/nonexistent")).toBeNull();
    expect(drift).not.toHaveBeenCalled();
  });

  it("仓库没有 lockfile → null（检出可能不完整，无法判定 ≠ 陈旧）", () => {
    drift.mockReturnValue({ state: "no-lockfile", modulesLock: null });
    expect(readDepsFreshness("/nonexistent")).toBeNull();
    expect(missingProbe).not.toHaveBeenCalled();
  });

  it("lockfile 漂移 → stale drift", () => {
    drift.mockReturnValue({ state: "drift", modulesLock: null });
    expect(readDepsFreshness("/nonexistent")).toEqual({
      stale: true,
      state: "drift",
      missing: [],
    });
    expect(missingProbe).not.toHaveBeenCalled();
  });

  it("从未装好 / 装残 → stale no-install", () => {
    drift.mockReturnValue({ state: "no-install", modulesLock: null });
    expect(readDepsFreshness("/nonexistent")).toEqual({
      stale: true,
      state: "no-install",
      missing: [],
    });
    expect(missingProbe).not.toHaveBeenCalled();
  });

  it("lockfile 一致但个别依赖解析不到 → stale unresolved + 缺失清单", () => {
    drift.mockReturnValue({ state: "fresh", modulesLock: null });
    missingProbe.mockReturnValue(["foo", "bar"]);
    expect(readDepsFreshness("/nonexistent")).toEqual({
      stale: true,
      state: "unresolved",
      missing: ["foo", "bar"],
    });
  });

  it("lockfile 一致且全部可解析 → fresh（不陈旧）", () => {
    drift.mockReturnValue({ state: "fresh", modulesLock: null });
    missingProbe.mockReturnValue([]);
    expect(readDepsFreshness("/nonexistent")).toEqual({
      stale: false,
      state: "fresh",
      missing: [],
    });
  });
});
