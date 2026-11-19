/**
 * 「这份检出是不是开发检出」的判据（ISSUE #3396 / #3623 共用这一条）。
 *
 * 判据只有一条：检出里有没有启动编排器 `scripts/dev-launcher.mjs`。它在 = 源码在手，
 * 「保存为项目默认」才有可写的目标文件；正式包（standalone 分发载荷）里没有编排器，
 * 这一格必为 false。
 *
 * 这里真读临时目录（不 mock fs）：这一层的全部价值就是「文件在不在」，桩掉 fs
 * 之后判据就测不出任何东西。`root` 参数就是为它留的。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isDevCheckout } from "./dev-checkout.server";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "dev-checkout-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("开发检出的判据", () => {
  it("检出里有启动编排器才算开发检出", async () => {
    expect(isDevCheckout(root)).toBe(false);
    const launcher = path.join(root, "scripts", "dev-launcher.mjs");
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(launcher, "// 桩：形态判据只看它在不在", "utf8");
    expect(isDevCheckout(root)).toBe(true);
  });

  it("目录在、文件不在 ⇒ 不是开发检出（判据只看编排器那一个文件）", async () => {
    await fs.mkdir(path.join(root, "scripts"), { recursive: true });
    expect(isDevCheckout(root)).toBe(false);
  });
});
