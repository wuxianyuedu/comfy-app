// MCP 侧 workshop API 配置缓存的指纹失效（#4231）：与 Next 侧
// `~/lib/workshop/api-channel.server`（ISSUE #3836）同一机制的双入口另一半。
// 钉的行为：配置文件被**另一个进程**（Next 设置页）改写后，本进程的下一次读取
// 必须拿到新值——旧实现缓存一旦建立永不失效，用户改了 apiKey/endpoint，
// MCP 工具永远拿旧值直到重启。测试写自己的临时目录，不碰仓库 data/。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureWorkshopApiSettingsFileForTest, getWorkshopApiSettingsSync } from "./api-channel";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "comfy-mcp-api-channel-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("MCP 侧配置缓存的指纹失效（#4231）", () => {
  it("外部进程改写配置文件后，下一次读取拿到新值（缓存按指纹失效）", () => {
    const file = path.join(tmp, "workshop-api-settings.json");
    configureWorkshopApiSettingsFileForTest(file);

    writeFileSync(file, JSON.stringify({ image: { baseUrl: "https://old.example.com" } }), "utf8");
    const first = getWorkshopApiSettingsSync();
    expect(first.image.baseUrl).toBe("https://old.example.com");

    /* 另一个进程（Next 设置页）改写同一份文件：本进程（MCP）的缓存必须失效。 */
    writeFileSync(file, JSON.stringify({ image: { baseUrl: "https://new.example.com" } }), "utf8");
    const second = getWorkshopApiSettingsSync();
    expect(second.image.baseUrl).toBe("https://new.example.com");
  });

  it("文件不变时缓存复用；文件被删后回落默认（指纹留空 ≠ 任何缓存）", () => {
    const file = path.join(tmp, "workshop-api-settings.json");
    configureWorkshopApiSettingsFileForTest(file);

    writeFileSync(file, JSON.stringify({ image: { baseUrl: "https://x.example.com" } }), "utf8");
    const first = getWorkshopApiSettingsSync();
    expect(first.image.baseUrl).toBe("https://x.example.com");

    rmSync(file);
    const afterDelete = getWorkshopApiSettingsSync();
    expect(afterDelete.image.baseUrl).toBe("");
  });
});
