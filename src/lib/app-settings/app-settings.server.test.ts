import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* 设置文件的落位与缓存都绑在 `process.cwd()` 与模块级 `cache` 上，所以每个用例都要：
 * 换 cwd → 重置模块缓存 → 动态 import（同 `llm/secrets.test.ts` 的手法）。
 * 用真临时目录而不是 mock `node:fs`：失效判据是**文件的内容摘要**，
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
  rmSync(sandbox, { force: true, recursive: true });
});

describe("getSettingsSync 的跨进程失效", () => {
  it("别的进程写盘后，本进程下一次取值读得到新值", async () => {
    /* 桌包拓扑的真形状：设置由内嵌 server 进程写、由执行宿主进程读，宿主只在第一次
     * 取值时读盘。这一条在「有缓存就永远用缓存」的实现下会红 —— 用户在设置页填完
     * comfy-cli 解释器点「重试」，宿主仍拿空值（桌包实测复现过同一个 FAILED）。 */
    writeSettings({ comfyCliPython: "" });
    const { DEFAULTS, getSettingsSync } = await loadSettingsServer();
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
    const { DEFAULTS, getSettingsSync } = await loadSettingsServer();
    expect(getSettingsSync().comfyuiPath).toBe(DEFAULTS.comfyuiPath);

    writeSettings({ comfyuiPath: "D:/ComfyUI" });
    expect(getSettingsSync().comfyuiPath).toBe("D:/ComfyUI");
  });

  it("指纹没变时走的是同一份缓存对象（不是每次都重读）", async () => {
    /* 反向判据：失效靠的是指纹，不是「每次取值都读盘」。用**对象同一性**当证据 ——
     * 命中缓存返回同一个引用，重读则每次新对象。 */
    writeSettings({ comfyCliPython: "A" });
    const { getSettingsSync } = await loadSettingsServer();
    const first = getSettingsSync();
    expect(first.comfyCliPython).toBe("A");
    expect(getSettingsSync()).toBe(first);

    /* 第二次写盘用**等长**的值（`"A"` → `"B"`）：这是刻意的，见下面那条用例 ——
     * 指纹是**内容摘要**，等长改写（甚至 mtime 相同）也必须被认出来。 */
    writeSettings({ comfyCliPython: "B" });
    const second = getSettingsSync();
    expect(second.comfyCliPython).toBe("B");
    expect(second).not.toBe(first);
  });

  it("**等长改写**必须被认出来 —— 指纹不能只看 mtime + size（ISSUE #1961）", async () => {
    /* 这一格是「判据分不出同一时间刻度内的等长改写」那条真实故障的确定性复刻。
     *
     * 原判据是 `mtimeMs:size` 二元组，而它**分不出**这种形态：
     * `"A"` → `"B"` 长度一样，只要两次写的 `mtimeMs` 落在同一刻度上，指纹就恒等
     * ⇒ 缓存照旧命中 ⇒ 读到的还是旧值（跨进程失效因此会漏）。
     * 本机实测：200 次背靠背等长改写里 **66 次**撞上同一个 `mtimeMs:size`
     * —— 也就是说它**只在负载高/时机巧时才红**，本地手工跑基本绿的。
     *
     * 所以这里**把 mtime 钉成同一个值**，把这个概率事件变成确定事件：
     * 旧实现（mtime + size）在这条上必红，新实现（内容摘要）必绿。
     * 用 `utimesSync` 钉一个固定时刻是刻意的 —— 它可注、可复现，
     * 而且不需要去猜操作系统的 mtime 分辨率。 */
    writeSettings({ comfyCliPython: "A" });
    const { getSettingsSync } = await loadSettingsServer();
    expect(getSettingsSync().comfyCliPython).toBe("A");

    /* 等长改写（`"A"` → `"B"`），并把 mtime 钉回**同一个**时刻 ——
     * 这正是「同一时间刻度内的等长改写」那一格。 */
    const pinned = new Date("2020-01-01T00:00:00.000Z");
    writeSettings({ comfyCliPython: "A" });
    utimesSync(settingsFile, pinned, pinned);
    expect(getSettingsSync().comfyCliPython).toBe("A");

    writeSettings({ comfyCliPython: "B" });
    utimesSync(settingsFile, pinned, pinned);
    expect(
      getSettingsSync().comfyCliPython,
      "等长改写 + mtime 钉住 ⇒ mtime+size 指纹不变，缓存把旧值端了出来",
    ).toBe("B");
  });

  it("saveSettings 落盘后本进程读到的是刚写的值", async () => {
    writeSettings({ comfyCliPython: "" });
    const { getSettingsSync, saveSettings } = await loadSettingsServer();
    const saved = await saveSettings({ comfyCliPython: "D:/x/python.exe" });
    expect(saved.comfyCliPython).toBe("D:/x/python.exe");
    expect(getSettingsSync().comfyCliPython).toBe("D:/x/python.exe");
    expect(readFileSync(settingsFile, "utf-8")).toContain("D:/x/python.exe");
  });
});
