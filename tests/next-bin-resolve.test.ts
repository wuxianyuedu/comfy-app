/**
 * next bin 解析共用件（`scripts/launcher-core/next-bin.mjs`）的行为测试（ISSUE #4155）。
 *
 * dev.mjs / start.mjs 的 server 链自 #4155 起直启 next bin（不再经 `pnpm exec` 的
 * Windows shim），bin 路径只从这里解析。本文件在临时工作区里钉住解析行为的四个方向：
 * ① 正常解析出 bin 绝对路径（bin 字段对象形态，即 next 自己的写法）；
 * ② bin 字段是字符串形态（单 bin 包写法）也能解析；
 * ③ 依赖没装（解析不到 next/package.json）→ null，调用方给可行动提示；
 * ④ bin 落点文件不存在（包被清空的残骸）→ null，不把不存在的路径交给 spawn。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveNextBin } from "../scripts/launcher-core/next-bin.mjs";

/** 造一个最小可解析的 `next` 包（node_modules/next/{package.json → bin → 实体文件}）。 */
const makeNextPackage = (root: string, binField: unknown, writeBinFile: boolean): void => {
  const pkgDir = path.join(root, "node_modules", "next");
  fs.mkdirSync(path.join(pkgDir, "dist", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "next", version: "0.0.0", bin: binField }),
    "utf8",
  );
  if (writeBinFile) {
    fs.writeFileSync(path.join(pkgDir, "dist", "bin", "next"), "#!/usr/bin/env node\n", "utf8");
  }
};

describe("resolveNextBin —— server 链的 bin 入口解析（ISSUE #4155）", () => {
  const tmps: string[] = [];
  afterEach(() => {
    for (const dir of tmps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const makeRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-bin-"));
    tmps.push(dir);
    fs.writeFileSync(path.join(dir, "package.json"), "{}", "utf8");
    return dir;
  };

  it("bin 字段为对象形态（next 自己的写法）→ 解析出 bin 绝对路径", () => {
    const root = makeRoot();
    makeNextPackage(root, { next: "dist/bin/next" }, true);
    const bin = resolveNextBin(root);
    expect(bin, "应解析到 bin 绝对路径").not.toBeNull();
    const binPath = /** @type {string} */ (bin ?? "");
    expect(path.basename(binPath)).toBe("next");
    expect(binPath, "bin 必须落在 next 包自己的目录里").toContain(
      path.join("node_modules", "next", "dist", "bin"),
    );
  });

  it("bin 字段为字符串形态（单 bin 包写法）→ 同样解析得到", () => {
    const root = makeRoot();
    makeNextPackage(root, "dist/bin/next", true);
    expect(resolveNextBin(root)).not.toBeNull();
  });

  it("依赖没装（解析不到 next/package.json）→ null", () => {
    const root = makeRoot();
    expect(resolveNextBin(root), "没装依赖时必须是 null（调用方给可行动提示）").toBeNull();
  });

  it("bin 落点文件不存在（包被清空的残骸）→ null，不把坏路径交给 spawn", () => {
    const root = makeRoot();
    makeNextPackage(root, { next: "dist/bin/next" }, false);
    expect(resolveNextBin(root)).toBeNull();
  });
});
