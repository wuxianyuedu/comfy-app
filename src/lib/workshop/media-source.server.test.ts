/**
 * `media-source.server.ts` 的媒体源解析判据。
 *
 * 这个模块此前**零执行者** —— 本批把它的「地址 → 磁盘」换成共用判据
 * （`~/lib/media/output-paths` 的 `artifactDiskPath`），改了一个判据却没有一份
 * 执行者，就是「修了 ≠ 记了」那个老形状（台账 §11.2.1 第二条）。所以用例按
 * **改了什么就钉什么**来写，重点是那一条边界：
 * 旧实现用 `abs.startsWith(GENERATED_DIR)` 收根，同级的 `generatedX` 目录
 * 前缀相同 → 会被算作根内（`/api/generated/../generatedX/evil.png` 归一后就是它）。
 *
 * mock 边界：只 spy `process.cwd()`（产物根由它派生，本机真实 cwd 会让判据随
 * 开发机的目录形态而变）；文件读写走**自己的临时目录**，不碰仓库的 `public/`。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { generatedRoot } from "~/lib/media/output-paths";
import { resolveMediaBytes } from "~/lib/workshop/media-source.server";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "media-source-"));
const ROOT = generatedRoot(TMP);

const cwdSpy = vi.spyOn(process, "cwd");

beforeAll(() => {
  fs.mkdirSync(ROOT, { recursive: true });
});

beforeEach(() => {
  cwdSpy.mockReturnValue(TMP);
});

afterEach(() => {
  // 只清调用记录，不 restore：restore 之后再把值塞回同一个 spy 就不生效了，
  // 表现为「后一半用例突然读到真实 cwd」
  cwdSpy.mockClear();
});

afterAll(() => {
  cwdSpy.mockRestore();
  // Windows：句柄未释放时 rmSync 会 EPERM，按仓库既有做法带重试
  fs.rmSync(TMP, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

describe("resolveMediaBytes —— 本地产物地址", () => {
  it("产物根内的真实文件：读到字节，mime 按扩展名", async () => {
    const file = path.join(ROOT, "t-1", "img_0.png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from("fake-png"));

    const { buffer, mime } = await resolveMediaBytes(
      "/api/generated/t-1/img_0.png",
      "http://127.0.0.1:3100",
    );
    expect(buffer.toString()).toBe("fake-png");
    expect(mime).toBe("image/png");
  });

  it("历史留下的 /generated/… 形状答得出同一个文件（两种形状同答案）", async () => {
    const { buffer } = await resolveMediaBytes(
      "/generated/t-1/img_0.png",
      "http://127.0.0.1:3100",
    );
    expect(buffer.toString()).toBe("fake-png");
  });

  it("同级 generatedX 不算根内：判据带 path.sep 边界", async () => {
    const outside = path.join(TMP, "public", "generatedX", "evil.png");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "not-mine");
    // 归一化之后落到的正是那个同级目录 —— startsWith(根) 会把它放行
    await expect(
      resolveMediaBytes(
        "/api/generated/../generatedX/evil.png",
        "http://127.0.0.1:3100",
      ),
    ).rejects.toThrow("无法定位本地生成文件");
  });

  it("越出产物根 → 拒绝，而不是读盘", async () => {
    const secret = path.join(TMP, "secrets.env");
    fs.writeFileSync(secret, "TOP-SECRET");
    await expect(
      resolveMediaBytes(
        "/api/generated/../secrets.env",
        "http://127.0.0.1:3100",
      ),
    ).rejects.toThrow("无法定位本地生成文件");
  });

  it("不是产物地址的相对路径同样拒绝（不给「换个前缀就能读任意文件」留缝）", async () => {
    await expect(
      resolveMediaBytes("/api/other/x.png", "http://127.0.0.1:3100"),
    ).rejects.toThrow("无法定位本地生成文件");
  });
});

describe("resolveMediaBytes —— 内联 data URL", () => {
  it("data URL 直接解出字节与 MIME", async () => {
    const base64 = Buffer.from("hello").toString("base64");
    const { buffer, mime } = await resolveMediaBytes(
      `data:image/jpeg;base64,${base64}`,
      "http://127.0.0.1:3100",
    );
    expect(buffer.toString()).toBe("hello");
    expect(mime).toBe("image/jpeg");
  });

  it("坏编码的 data URL 有明确文案（不是一句栈噪声）", async () => {
    await expect(
      resolveMediaBytes("data:image/jpeg;base64", "http://127.0.0.1:3100"),
    ).rejects.toThrow();
  });
});
