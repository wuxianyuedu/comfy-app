/**
 * node-engines.mjs 的判据测试 —— 重点锁「within() 下界包容性」那一处曾取反的 bug，
 * 以及三个顺手收口的小口子（collectDependencyFloors 静默漏扫 / recommendFrom 已满足仍建议
 * / 独立上界 fail-closed）。方向与 `covers(depRange, declared)` 一致：声明必须是每条依赖
 * 范围的子集（别记反）。
 *
 * 这些用例是 `node-engines.mjs` 的「能力」判据；ok:false 经
 * `tests/dev-launcher-toolchain-gate.test.ts` 的 `checkDeclaredFloor({ root })` 断言
 * `r.ok === true`，在 PR 阻塞测试档里转成非零退出 —— 即「闸能拦违规」。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectDependencyFloors,
  covers,
  describeNodeAgainstFloor,
  parseRange,
  satisfies,
} from "../scripts/node-engines.mjs";

describe("within() 下界包容性矩阵（曾取反的 bug）", () => {
  it("下界四行全对（含修复前误报为 true 的真实 gap）", () => {
    // outer = 依赖范围，inner = 本仓声明；covers(outer, inner) = inner ⊆ outer
    expect(covers(">=20", ">=20"), ">=20 ⊇ >=20").toBe(true);
    expect(covers(">20", ">20"), ">20 ⊇ >20").toBe(true);
    expect(covers(">=20", ">20"), ">=20 ⊇ >20").toBe(true);
    // 修复前这一行误报 true（把真实 gap 放过）：outer >20 不含 20、inner >=20 含 20，
    // 20 ∈ inner 但 20 ∉ outer ⇒ 真 gap，应为 false。
    expect(covers(">20", ">=20"), ">20 ⊇ >=20 应为 false（真 gap）").toBe(false);
  });

  it("上界四行全对（带下界的合法区间，避免独立上界退化成 null）", () => {
    expect(covers(">=20 <=23", ">=20 <=23")).toBe(true);
    expect(covers(">20 <23", ">20 <23")).toBe(true);
    expect(covers(">=20 <=23", ">=20 <23")).toBe(true);
    expect(covers(">20 <=23", ">=20 <=23"), "真 gap 应为 false").toBe(false);
  });
});

describe("satisfies / parseRange 的三态与 fail-closed", () => {
  it("读不懂的形状返回 null（不是 false），由调用方转「没跑起来」", () => {
    expect(parseRange("20.x")).toBeNull();
    expect(parseRange("^0.2.3")).toBeNull();
    expect(parseRange("*")).toBeNull();
  });

  it("独立上界（无下界）视为读不懂 ⇒ null（fail-closed，不静默放行）", () => {
    expect(parseRange("<23.0.0")).toBeNull();
    expect(satisfies("22.0.0", "<23.0.0")).toBeNull();
  });

  it("正常形状给 boolean", () => {
    expect(satisfies("24.20.0", ">=22.12.0")).toBe(true);
    expect(satisfies("20.0.0", ">=22.12.0")).toBe(false);
  });
});

describe("describeNodeAgainstFloor：已满足时不再给升级建议", () => {
  it("声明范围内 ⇒ recommend 为 null（不读起来像「必须升」）", () => {
    const r = describeNodeAgainstFloor({ version: "26.12.1", range: ">=26.12.1" });
    expect(r.ok).toBe(true);
    expect(r.recommend).toBeNull();
  });

  it("声明范围内（较低合法版本）⇒ recommend 为 null", () => {
    const r = describeNodeAgainstFloor({ version: "22.22.2", range: ">=22.12.0" });
    expect(r.ok).toBe(true);
    expect(r.recommend).toBeNull();
  });

  it("越界 ⇒ recommend 给最近可达档", () => {
    const r = describeNodeAgainstFloor({ version: "24.20.0", range: ">=26.12.1" });
    expect(r.ok).toBe(false);
    expect(r.recommend).toBe("26.12.1");
  });
});

describe("collectDependencyFloors：exports 隐藏 package.json 的包不静默漏扫", () => {
  it("require.resolve 抛、但直接读盘能找到时仍计入扫描范围", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "node-engines-"));
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "root", dependencies: { hidden: "1.0.0" } }),
      );
      // 这个包的 exports 不暴露 ./package.json ⇒ require.resolve(`${name}/package.json`) 会抛
      fs.mkdirSync(path.join(root, "node_modules", "hidden"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "node_modules", "hidden", "package.json"),
        JSON.stringify({
          name: "hidden",
          version: "1.0.0",
          engines: { node: ">=22.12.0" },
          exports: { ".": "./index.js" },
        }),
      );
      const scanned = collectDependencyFloors(root);
      expect(scanned.ok, "应能从磁盘兜底读到 hidden 的 engines").toBe(true);
      if (!scanned.ok) {
        throw new Error("collectDependencyFloors 应成功");
      }
      const hit = scanned.floors.find((f) => f.pkg === "hidden");
      expect(hit, "hidden 不该静默退出扫描范围").toBeDefined();
      expect(hit?.range).toBe(">=22.12.0");
      expect(scanned.resolvedCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("依赖未装（连磁盘文件都没有）⇒ resolved===0 ⇒ ok:false（不是「零命中」）", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "node-engines-missing-"));
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "root", dependencies: { gone: "1.0.0" } }),
      );
      const scanned = collectDependencyFloors(root);
      expect(scanned.ok).toBe(false);
      expect(/* SAFETY: 类型断言已复核 */ (scanned as { reason?: string }).reason).toMatch(
        /没解析到/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
