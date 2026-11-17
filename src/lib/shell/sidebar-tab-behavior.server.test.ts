/**
 * 侧栏页签行为的服务端存储（ISSUE #3623）。
 *
 * 这一层的题目是**两份来源怎么合**：项目默认（入库那份 JSON，跟代码走）给基线，
 * 本机覆盖（`data/sidebar-tab-behavior.json`）在这台机器上逐项压过它。五条用例各钉
 * 一件事——
 *
 *   ① 没有覆盖文件时读到的是项目默认（不是空配置 —— 「没配过」与「配置是空的」
 *      是两件事，混淆会让九项全回落成常驻）；
 *   ② 覆盖存在时**逐项**压过默认（没配过的那几项原样留着）；
 *   ③ 坏 JSON / 读不出来按「没有覆盖」处理，不把工作区打成 500；
 *   ④ 保存走差集：与项目默认相同的项不落盘，「改回默认」免费成立；
 *   ⑤ 「保存为项目默认」只在开发检出可用，且全量写进入库那份 JSON。
 *
 * 这里**真读写临时目录**（不 mock fs）：这一层的全部价值就是「读到了哪一份、
 * 内容有没有被归一化」——桩掉 fs 之后这两件都判不出来。`root` 参数就是为它留的。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSidebarTabConfig,
  loadSidebarTabProjectDefaults,
  resetSidebarTabConfig,
  saveSidebarTabConfig,
  saveSidebarTabConfigAsProjectDefaults,
  SIDEBAR_TAB_DEFAULTS_REL_PATH,
  SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH,
  SIDEBAR_TAB_LOCAL_REL_PATH,
} from "./sidebar-tab-behavior.server";
import { projectSidebarTabConfig } from "./sidebar-tab-behavior";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "sidebar-tab-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** 读本机覆盖那份文件的原始文本（不存在返回 null）。 */
async function readRaw(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, SIDEBAR_TAB_LOCAL_REL_PATH), "utf8");
  } catch {
    return null;
  }
}

/** 把临时 root 布置成一份「开发检出」：编排器在位。 */
async function asDevCheckout(): Promise<void> {
  const launcher = path.join(root, "scripts", "dev-launcher.mjs");
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.writeFile(launcher, "// 桩：形态判据只看它在不在", "utf8");
}

describe("侧栏页签行为：项目默认 + 本机覆盖", () => {
  it("覆盖落在本机运行期目录 data/，不是入库的项目配置", () => {
    expect(SIDEBAR_TAB_LOCAL_REL_PATH).toBe("data/sidebar-tab-behavior.json");
    expect(SIDEBAR_TAB_LOCAL_REL_PATH.startsWith("data/")).toBe(true);
    expect(SIDEBAR_TAB_LOCAL_REL_PATH.startsWith("config/")).toBe(false);
    expect(SIDEBAR_TAB_DEFAULTS_REL_PATH).toBe("src/lib/shell/sidebar-tab-defaults.json");
    expect(SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH).toBe(
      path.join("data", "sidebar-tab-project-defaults.json"),
    );
  });

  it("没有覆盖文件时读到的是项目默认（不是空配置）", async () => {
    const config = await loadSidebarTabConfig(root);
    expect(config).toEqual(projectSidebarTabConfig());
    // 反向对照：「读一次写一次」会把「看一眼」事故性地固化成这台机器的覆盖。
    expect(Object.keys(config).length).toBeGreaterThan(0);
    await expect(readRaw()).resolves.toBeNull();
  });

  it("覆盖逐项压过默认：没配过的那几项原样留着", async () => {
    await saveSidebarTabConfig({ console: "shared" }, root);
    const config = await loadSidebarTabConfig(root);
    expect(config.console).toBe("shared");
    expect(config.models).toBe(projectSidebarTabConfig().models);
  });

  it("保存走差集：与项目默认相同的项不落盘", async () => {
    const saved = await saveSidebarTabConfig(
      { console: "shared", models: projectSidebarTabConfig().models ?? "independent" },
      root,
    );
    expect(saved).toEqual({ console: "shared" });
    expect(JSON.parse((await readRaw()) ?? "{}")).toEqual(saved);
  });

  it("坏 JSON 按「没有覆盖」处理，不把工作区打成 500", async () => {
    const file = path.join(root, SIDEBAR_TAB_LOCAL_REL_PATH);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ 这不是 JSON", "utf8");
    await expect(loadSidebarTabConfig(root)).resolves.toEqual(projectSidebarTabConfig());
  });

  it("写不进去时报错并带上路径（不静默吞掉）", async () => {
    // 让 data 那一段是个**文件**：mkdir / 写都必然失败，模拟只读 / 被占用的目录
    await fs.writeFile(path.join(root, "data"), "占位", "utf8");
    await expect(saveSidebarTabConfig({ console: "shared" }, root)).rejects.toThrow(
      /侧栏页签行为写入失败.*sidebar-tab-behavior\.json/s,
    );
  });

  it("还原默认：删掉本机覆盖，生效值回落项目默认", async () => {
    await saveSidebarTabConfig({ console: "shared" }, root);
    await expect(readRaw()).resolves.not.toBeNull();

    const restored = await resetSidebarTabConfig(root);
    expect(restored).toEqual(projectSidebarTabConfig());
    await expect(readRaw()).resolves.toBeNull();
  });

  it("还原默认：覆盖本来就不在时不动、不建文件", async () => {
    const restored = await resetSidebarTabConfig(root);
    expect(restored).toEqual(projectSidebarTabConfig());
    await expect(readRaw()).resolves.toBeNull();
  });
});

describe("保存为项目默认：开发检出的写回入口（ISSUE #3623）", () => {
  it("非开发检出大声拒绝（正式包没有源码可写，这条调用就是错用）", async () => {
    await expect(
      saveSidebarTabConfigAsProjectDefaults({ console: "shared" }, root),
    ).rejects.toThrow(/只在开发检出可用/);
    // 拒绝的同时什么都没写（src 编译源与 data/ 运行时覆盖都不在）
    await expect(
      fs.readFile(path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH), "utf8"),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH), "utf8"),
    ).rejects.toThrow();
  });

  it("开发检出：全量写进本机项目默认覆盖（data/，不写 src，ISSUE #4150）", async () => {
    await asDevCheckout();
    const res = await saveSidebarTabConfigAsProjectDefaults(
      { console: "shared", models: "shared" },
      root,
    );
    expect(res.config).toEqual({ console: "shared", models: "shared" });
    const raw = await fs.readFile(
      path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(res.config);
    expect(res.file).toBe(path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH));
    /* src 那份编译源运行期不再被写：工作树噪声与 dev 模块图失效的根源。 */
    await expect(
      fs.readFile(path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH), "utf8"),
    ).rejects.toThrow();
    /* 写完即生效：读取链先认本机覆盖。 */
    await expect(loadSidebarTabProjectDefaults(root)).resolves.toEqual(res.config);
  });

  it("存量搬迁：旧版写进 src 的用户态在读链上自动搬去 data/（ISSUE #4150）", async () => {
    await asDevCheckout();
    /* 旧版现场：src 那份被「保存为项目默认」写过、与编译快照不同
     * （快照里 console="independent"）。 */
    const legacy = { console: "shared", models: "shared" };
    await fs.mkdir(path.dirname(path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH),
      `${JSON.stringify(legacy, null, 2)}
`,
      "utf8",
    );
    await expect(loadSidebarTabProjectDefaults(root)).resolves.toEqual(legacy);
    /* runtime 落点接住了用户态；此后 src 即使被还原也不影响读取。 */
    const migrated = await fs.readFile(
      path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH),
      "utf8",
    );
    expect(JSON.parse(migrated)).toEqual(legacy);
  });

  it("src 与编译快照一致（提交态）时不迁移：本机不钉住基线", async () => {
    await asDevCheckout();
    const committed = projectSidebarTabConfig();
    await fs.mkdir(path.dirname(path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, SIDEBAR_TAB_DEFAULTS_REL_PATH),
      `${JSON.stringify(committed, null, 2)}
`,
      "utf8",
    );
    await expect(loadSidebarTabProjectDefaults(root)).resolves.toEqual(committed);
    /* 没有用户态就没有搬迁：runtime 落点保持缺省回落。 */
    await expect(
      fs.readFile(path.join(root, SIDEBAR_TAB_PROJECT_DEFAULTS_RUNTIME_REL_PATH), "utf8"),
    ).rejects.toThrow();
  });

  it("本机覆盖读不出来时回落编译进来的那份快照（正式包形态）", async () => {
    // root 下没有 data/ 覆盖（正式包形态）
    await expect(loadSidebarTabProjectDefaults(root)).resolves.toEqual(projectSidebarTabConfig());
  });
});
