import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* 设置文件的落位与缓存都绑在 `process.cwd()` 与模块级 `cache` 上，所以每个用例都要：
 * 换 cwd → 重置模块缓存 → 动态 import（同 `llm/secrets.test.ts` 的手法）。
 * 用真临时目录而不是 mock `node:fs`：失效判据是**文件指纹**（mtimeMs + size），
 * mock 出来的「变了/没变」是本用例自说自话。 */
const originalCwd = process.cwd();
let sandbox: string;
let settingsFile: string;

async function loadSettingsServer() {
  vi.resetModules();
  return await import("./app-settings.server");
}

function writeSettings(payload: Record<string, unknown>): void {
  mkdirSync(join(sandbox, "data"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(payload, null, 2), "utf-8");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "app-settings-server-"));
  settingsFile = join(sandbox, "data", "app-settings.json");
  process.cwd = () => sandbox;
});

afterEach(() => {
  process.cwd = () => originalCwd;
  rmSync(sandbox, { recursive: true, force: true });
});

describe("getSettingsSync 的跨进程失效", () => {
  it("别的进程写盘后，本进程下一次取值读得到新值", async () => {
    /* 桌包拓扑的真形状：设置由内嵌 server 进程写、由执行宿主进程读，宿主只在第一次
     * 取值时读盘。这一条在「有缓存就永远用缓存」的实现下会红 —— 用户在设置页填完
     * comfy-cli 解释器点「重试」，宿主仍拿空值（桌包实测复现过同一个 FAILED）。 */
    writeSettings({ comfyCliPython: "" });
    const { getSettingsSync, DEFAULTS } = await loadSettingsServer();
    expect(getSettingsSync().comfyCliPython).toBe("");

    writeSettings({
      comfyCliPython: "D:/tools/python-venv/comfy-cli/Scripts/python.exe",
    });
    expect(getSettingsSync().comfyCliPython).toBe(
      "D:/tools/python-venv/comfy-cli/Scripts/python.exe",
    );
    /* 其余字段仍按 DEFAULTS 兜住：重读走的是同一条合并路径，不是把缓存原样留着。 */
    expect(getSettingsSync().comfyuiPort).toBe(DEFAULTS.comfyuiPort);
  });

  it("文件从缺失到出现：缺失期拿默认值，出现后读得到", async () => {
    const { getSettingsSync, DEFAULTS } = await loadSettingsServer();
    expect(getSettingsSync().comfyuiPath).toBe(DEFAULTS.comfyuiPath);

    writeSettings({ comfyuiPath: "D:/ComfyUI" });
    expect(getSettingsSync().comfyuiPath).toBe("D:/ComfyUI");
  });

  it("指纹没变时走的是同一份缓存对象（不是每次都重读）", async () => {
    /* 反向判据：失效靠的是指纹，不是「每次取值都读盘」。用**对象同一性**当证据 ——
     * 命中缓存返回同一个引用，重读则每次新对象。
     * （不用「改内容但把 mtime 复原」这种手法：`utimes` 只能到毫秒，而 NTFS 记到
     * 亚毫秒，复原出来的 mtime 永远差那一小截，判的就不是缓存了。） */
    writeSettings({ comfyCliPython: "A" });
    const { getSettingsSync } = await loadSettingsServer();
    const first = getSettingsSync();
    expect(first.comfyCliPython).toBe("A");
    expect(getSettingsSync()).toBe(first);

    /* ⚠️ 第二次写盘的**长度必须与第一次不同**（`"A"` → `"BB"`，不是 `"B"`）。
     *
     * 指纹是 `mtimeMs:size` 二元组，而两次 `writeFileSync` 连着跑时**可能落在同一个
     * mtime 刻度上** —— 那时若 size 也一样，指纹就真的没变，缓存**正确地**返回旧值，
     * 而这行读取被读成「缓存没失效」。
     *
     * 实测：平台侧 `cnb-60n-1k50qev62` 上这条红（`expected 'A' to be 'B'`），
     * 而本机（ext4，纳秒 mtime）恒绿 —— 判据把「这台宿主的时钟/文件系统刻度」
     * 写成了恒真性质。长度不同则 size 必然不同，与刻度无关。 */
    writeSettings({ comfyCliPython: "BB" });
    const second = getSettingsSync();
    expect(second.comfyCliPython).toBe("BB");
    expect(second).not.toBe(first);
  });

  it("saveSettings 落盘后本进程读到的是刚写的值", async () => {
    writeSettings({ comfyCliPython: "" });
    const { saveSettings, getSettingsSync } = await loadSettingsServer();
    const saved = await saveSettings({ comfyCliPython: "D:/x/python.exe" });
    expect(saved.comfyCliPython).toBe("D:/x/python.exe");
    expect(getSettingsSync().comfyCliPython).toBe("D:/x/python.exe");
    expect(readFileSync(settingsFile, "utf-8")).toContain("D:/x/python.exe");
  });
});
