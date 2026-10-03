// IO 层的判据：哪些目录会被当成「桌面实例的六个目录」。
// 依赖全部注入（exists / readFile / resolveArgs），不碰真实磁盘。
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDesktopStoragePaths } from "./desktop-storage-paths.server";

/** 用一份目录清单造 exists 注入点。 */
function existsOf(dirs: string[]) {
  const set = new Set(dirs.map((dir) => path.resolve(dir)));
  return (target: string) => set.has(path.resolve(target));
}

/** 桌面实例的最小布局：<实例根>/ComfyUI/main.py + 桌面标记文件。 */
const DESKTOP_ROOT = path.resolve("/inst");
const DESKTOP_DIRS = [
  DESKTOP_ROOT,
  path.join(DESKTOP_ROOT, ".comfyui-desktop-2"),
  path.join(DESKTOP_ROOT, "ComfyUI"),
  path.join(DESKTOP_ROOT, "ComfyUI", "main.py"),
];

const SHARED_ROOT = path.resolve("/shared");
const SHARED_YAML = [
  "comfyui_shared:",
  `  base_path: ${SHARED_ROOT}`,
  "  paths:",
  "    - models/",
  "    - input/",
  "    - output/",
  "",
].join("\n");

/** 默认注入：桌面布局 + 共享 yaml + 无启动参数覆盖。 */
function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    exists: existsOf(DESKTOP_DIRS),
    readFile: async () => SHARED_YAML,
    resolveArgs: async () => [] as string[],
    ...overrides,
  };
}

describe("resolveDesktopStoragePaths", () => {
  it("非桌面实例与空路径返回 null（不拿别的形态的目录凑数）", async () => {
    expect(await resolveDesktopStoragePaths("")).toBeNull();
    expect(await resolveDesktopStoragePaths(null)).toBeNull();
    // 源码根里只有 main.py，没有桌面标记 → portable。
    const portable = existsOf([
      path.resolve("/plain"),
      path.resolve("/plain/main.py"),
    ]);
    expect(
      await resolveDesktopStoragePaths(path.resolve("/plain"), {
        exists: portable,
        readFile: async () => "",
        resolveArgs: async () => [],
      }),
    ).toBeNull();
  });

  it("桌面实例：模型目录在 base 下，共享目录来自 yaml", async () => {
    const result = await resolveDesktopStoragePaths(DESKTOP_ROOT, baseDeps());
    expect(result).not.toBeNull();
    const base = path.join(DESKTOP_ROOT, "ComfyUI");
    expect(result?.baseDir).toBe(base);
    expect(result?.instanceRoot).toBe(DESKTOP_ROOT);
    expect(result?.modelDir.path).toBe(path.join(base, "models"));
    expect(result?.inputDir.path).toBe(path.join(base, "input"));
    expect(result?.outputDir.path).toBe(path.join(base, "output"));
    expect(result?.sharedModelDirs).toEqual([
      {
        path: path.join(SHARED_ROOT, "models"),
        exists: false,
        source: "comfyui_shared",
      },
    ]);
    expect(result?.sharedInputDirs).toEqual([
      {
        path: path.join(SHARED_ROOT, "input"),
        exists: false,
        source: "comfyui_shared",
      },
    ]);
    expect(result?.sharedOutputDirs).toEqual([
      {
        path: path.join(SHARED_ROOT, "output"),
        exists: false,
        source: "comfyui_shared",
      },
    ]);
    expect(result?.extraModelPathsFile).toBe(
      path.join(base, "extra_model_paths.yaml"),
    );
  });

  it("base 下没有 yaml 时退回实例根读（extraModelPathsFile 如实记落点）", async () => {
    const rootYaml = path.join(DESKTOP_ROOT, "extra_model_paths.yaml");
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        readFile: async (target: string) => {
          // ComfyUI 从自己的 cwd（base 目录）读这份文件；那里没有才退实例根。
          if (path.resolve(target) !== path.resolve(rootYaml)) {
            throw new Error("ENOENT");
          }
          return `comfyui_shared:\n  base_path: ${SHARED_ROOT}\n  paths:\n    - models\n`;
        },
      }),
    );
    expect(result?.extraModelPathsFile).toBe(rootYaml);
    expect(result?.sharedModelDirs).toHaveLength(1);
  });

  it("没有 yaml 时共享目录为空，六个目录仍给得出主目录", async () => {
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        readFile: async () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(result?.extraModelPathsFile).toBeNull();
    expect(result?.sharedModelDirs).toEqual([]);
    expect(result?.modelDir.path).toBe(
      path.join(DESKTOP_ROOT, "ComfyUI", "models"),
    );
  });

  it("启动参数优先于 yaml 与布局：--base-directory / --input-directory 生效", async () => {
    const customBase = path.resolve("/custom-base");
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        exists: existsOf([
          ...DESKTOP_DIRS,
          path.join(customBase, "models"),
          path.join(customBase, "input"),
          path.join(customBase, "output"),
        ]),
        resolveArgs: async () => [
          "--enable-manager",
          "--base-directory",
          customBase,
          `--input-directory=${path.join(customBase, "in")}`,
        ],
      }),
    );
    expect(result?.modelDir).toEqual({
      path: path.join(customBase, "models"),
      exists: true,
      source: "--base-directory",
    });
    expect(result?.inputDir).toEqual({
      path: path.join(customBase, "in"),
      exists: false,
      source: "--input-directory",
    });
    // 输出目录未被参数覆盖 → 仍跟着 base，且来源为空。
    expect(result?.outputDir).toEqual({
      path: path.join(customBase, "output"),
      exists: true,
      source: null,
    });
  });

  it("yaml 顶层 base_path 覆盖布局判据（来源标出来）", async () => {
    const yamlBase = path.resolve("/yaml-base");
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        readFile: async () => `base_path: ${yamlBase}\n`,
      }),
    );
    expect(result?.modelDir).toEqual({
      path: path.join(yamlBase, "models"),
      exists: false,
      source: "extra_model_paths.yaml base_path",
    });
  });

  it("yaml 把 base 写成本实例时，那份目录不算共享（不列两遍）", async () => {
    const base = path.join(DESKTOP_ROOT, "ComfyUI");
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        readFile: async () =>
          `self:\n  base_path: ${base}\n  paths:\n    - models\n    - input\n`,
      }),
    );
    expect(result?.sharedModelDirs).toEqual([]);
    expect(result?.sharedInputDirs).toEqual([]);
  });

  it("共享目录去重：同一个目录被两个条目各写一遍只留一条", async () => {
    const result = await resolveDesktopStoragePaths(
      DESKTOP_ROOT,
      baseDeps({
        readFile: async () =>
          [
            `first:\n  base_path: ${SHARED_ROOT}\n  paths:\n    - models\n`,
            `second:\n  base_path: ${SHARED_ROOT}/\n  paths:\n    - models/\n`,
          ].join(""),
      }),
    );
    expect(result?.sharedModelDirs).toHaveLength(1);
  });

  it("配置直接指到源码根时 base 就是它自己（无 ComfyUI/ 子层）", async () => {
    const sourceRoot = path.join(DESKTOP_ROOT, "ComfyUI");
    const result = await resolveDesktopStoragePaths(
      sourceRoot,
      baseDeps({
        exists: existsOf([
          ...DESKTOP_DIRS,
          path.join(sourceRoot, "models"),
          path.join(sourceRoot, "input"),
          path.join(sourceRoot, "output"),
          path.join(sourceRoot, "extra_model_paths.yaml"),
        ]),
      }),
    );
    expect(result?.instanceRoot).toBe(DESKTOP_ROOT);
    expect(result?.baseDir).toBe(sourceRoot);
    expect(result?.modelDir.exists).toBe(true);
    expect(result?.extraModelPathsFile).toBe(
      path.join(sourceRoot, "extra_model_paths.yaml"),
    );
  });
});
