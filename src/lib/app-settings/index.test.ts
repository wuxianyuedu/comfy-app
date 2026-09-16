import { describe, expect, it } from "vitest";

import { migrateExitDefaults, type AppSettings } from "./app-settings.server";

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    trainerUrl: "",
    defaultVideoWorkflow: "auto",
    comfyLorasDir: "",
    comfyuiPath: "",
    comfyuiExtraArgs: "",
    comfyuiAutoStart: true,
    comfyuiPort: 0,
    loginRequired: false,
    exitKillComfyui: false,
    exitKillOllama: true,
    ...patch,
  };
}

describe("migrateExitDefaults 退出策略默认值迁移", () => {
  it("老文件里那条「旧默认 true」被翻成新默认 false 并落标记", () => {
    const migrated = migrateExitDefaults(
      makeSettings({ exitKillComfyui: true }),
    );
    expect(migrated.exitKillComfyui).toBe(false);
    expect(migrated.exitKillComfyuiDefaultMigrated).toBe(true);
  });

  it("已带标记的文件原样返回：用户后来手动勾选不会被再次覆盖", () => {
    const kept = makeSettings({
      exitKillComfyui: true,
      exitKillComfyuiDefaultMigrated: true,
    });
    expect(migrateExitDefaults(kept)).toBe(kept);
  });

  it("不碰 Ollama 的开关（另一个语义、另一套默认）", () => {
    expect(
      migrateExitDefaults(makeSettings({ exitKillOllama: false }))
        .exitKillOllama,
    ).toBe(false);
    expect(
      migrateExitDefaults(makeSettings({ exitKillOllama: true }))
        .exitKillOllama,
    ).toBe(true);
  });
});
