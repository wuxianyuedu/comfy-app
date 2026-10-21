import { describe, expect, it } from "vitest";

import {
  buildLevers,
  classifyFilesystem,
  isSameVolume,
  parseArgs,
  renderReport,
  summarizeLevers,
  volumeRootOf,
} from "../scripts/dev-drive-tune.mjs";

/**
 * 契约测试：开发盘调优脚本的**判据**与**命令形态**。
 *
 * 为什么要钉住「块克隆靠实测、不靠文件系统类型推断」：这份工具的全部价值就在
 * 那条差别上 —— 「卷是 ReFS」与「卷被指定为开发驱动器」是两件事，块克隆只认后者。
 * 一旦有人把结论写死成「ReFS 就有块克隆」，报告会开始说假话，而假话比没有更贵。
 */

/** 探测结果的形状（取自被测模块的类型，测试不另抄一份）。 */
type Report = Parameters<typeof buildLevers>[0];
/** 动作矩阵里的一条。 */
type Lever = ReturnType<typeof buildLevers>[number];

/** 造一份探测结果：只填与本组用例有关的字段，其余留空。 */
function makeReport(overrides: Partial<Report> = {}): Report {
  const base: Report = {
    repo: "G:\\repo",
    platform: "win32",
    volume: {
      root: "G:\\",
      fsType: "ReFS",
      label: "dev",
      category: "refs",
      devDrive: "unknown",
      devDriveLabel: "未知（需要管理员才能查）",
      defenderPerformanceMode: false,
      filters: [],
      filtersKnown: false,
    },
    capabilities: {
      hardlink: true,
      blockClone: false,
      blockCloneKnown: true,
      libuvForceClone: false,
      sparse: false,
    },
    pnpm: {
      storePath: "G:\\.pnpm-store\\v11",
      sameVolume: true,
      importMethod: null,
    },
    git: { untrackedCache: "true", indexVersion: "4", commitGraph: "true" },
    cache: {
      temp: {
        envName: "TEMP",
        path: "G:\\Temp",
        sameVolume: true,
        suggestedSubPath: "Temp",
      },
      cargoHome: {
        envName: "CARGO_HOME",
        path: "G:\\.cargo",
        sameVolume: true,
        suggestedSubPath: ".cargo",
      },
      playwright: {
        envName: "PLAYWRIGHT_BROWSERS_PATH",
        path: "G:\\.cache\\ms-playwright",
        sameVolume: true,
        suggestedSubPath: ".cache\\ms-playwright",
      },
      npmCache: {
        envName: "npm_config_cache",
        path: "G:\\.npm-cache",
        sameVolume: true,
        suggestedSubPath: ".npm-cache",
      },
    },
    defender: {
      known: true,
      realTime: true,
      exclusions: [],
      performanceMode: false,
    },
    workdirs: [],
  };
  return { ...base, ...overrides };
}

/** 在动作矩阵里按 id 取一条。 */
function leverOf(report: Report, id: string): Lever {
  const found = buildLevers(report).find((lever) => lever.id === id);
  if (!found) throw new Error(`动作矩阵里应有 ${id} 这一条`);
  return found;
}

describe("parseArgs", () => {
  it("默认四项开关都不开", () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      json: false,
      check: false,
      bench: false,
    });
  });

  it("四个开关各自独立打开", () => {
    expect(parseArgs(["--apply"]).apply).toBe(true);
    expect(parseArgs(["--json"]).json).toBe(true);
    expect(parseArgs(["--check"]).check).toBe(true);
    expect(parseArgs(["--bench"]).bench).toBe(true);
  });

  it("未知参数被忽略（不当作开关，也不报错）", () => {
    expect(parseArgs(["--nope"])).toEqual({
      apply: false,
      json: false,
      check: false,
      bench: false,
    });
  });
});

describe("卷与文件系统的判据", () => {
  it("Windows 下取所在卷根并统一大写", () => {
    expect(volumeRootOf("G:\\ComfyAPP\\app", "win32")).toBe("G:\\");
    expect(volumeRootOf("g:\\x", "win32")).toBe("G:\\");
  });

  it("非 Windows 一律视为同一卷", () => {
    expect(volumeRootOf("/home/me/app", "linux")).toBe("/");
  });

  it("同卷为真、跨卷为假、缺路径为假", () => {
    expect(isSameVolume("G:\\a", "G:\\b", "win32")).toBe(true);
    expect(isSameVolume("G:\\a", "C:\\b", "win32")).toBe(false);
    expect(isSameVolume("", "C:\\b", "win32")).toBe(false);
  });

  it("文件系统类型归一（大小写不敏感，空值是未知）", () => {
    expect(classifyFilesystem("ReFS")).toBe("refs");
    expect(classifyFilesystem("refs")).toBe("refs");
    expect(classifyFilesystem("NTFS")).toBe("ntfs");
    expect(classifyFilesystem("exFAT")).toBe("other");
    expect(classifyFilesystem("")).toBe("unknown");
    expect(classifyFilesystem(null)).toBe("unknown");
  });
});

describe("块克隆这一条：判据只能来自实测", () => {
  it("实测复制共享物理簇 → 就位", () => {
    const report = makeReport();
    report.capabilities.blockClone = true;
    const lever = leverOf(report, "block-clone");
    expect(lever.status).toBe("ok");
  });

  it("实测复制不共享物理簇 → 受阻，且破坏性的格式化动作只在「不是开发驱动器」时才给", () => {
    const lever = leverOf(makeReport(), "block-clone");
    expect(lever.status).toBe("blocked");
    const admin = lever.actions.filter((action) => action.scope === "admin");
    expect(admin.length).toBeGreaterThan(0);
    expect(admin[0]?.command).toContain("Format-Volume");
    expect(admin[0]?.command).toContain("-DevDrive");

    const devDrive = makeReport();
    devDrive.volume.devDrive = "yes";
    devDrive.volume.devDriveLabel = "是（受信任）";
    const lever2 = leverOf(devDrive, "block-clone");
    expect(lever2.status).toBe("blocked");
    expect(
      lever2.actions.filter((action) => action.scope === "admin").length,
    ).toBe(0);
  });

  it("读不到物理簇 → 不判（不猜）", () => {
    const report = makeReport();
    report.capabilities.blockCloneKnown = false;
    const lever = leverOf(report, "block-clone");
    expect(lever.status).toBe("na");
  });

  it("libuv 的强制克隆标志不可用 ≠ 这块卷不支持克隆", () => {
    // 这一条是踩过坑才写下的：Windows 上 COPYFILE_FICLONE_FORCE 一律 ENOSYS，
    // 那测的是 libuv 的实现状态，不是卷的能力。判据只认实测的物理簇共享。
    const report = makeReport();
    report.capabilities.blockClone = true;
    report.capabilities.libuvForceClone = false;
    const lever = leverOf(report, "block-clone");
    expect(lever.status).toBe("ok");
    expect(lever.actions.some((action) => action.label.includes("clone"))).toBe(
      true,
    );
  });

  it("不是 ReFS → 与本条无关，不判", () => {
    const report = makeReport();
    report.volume.category = "ntfs";
    report.volume.fsType = "NTFS";
    const lever = leverOf(report, "block-clone");
    expect(lever.status).toBe("na");
  });
});

describe("其余杠杆的状态判定", () => {
  it("pnpm store 与检出同卷 → 就位；跨卷 → 待办并给出改法", () => {
    expect(leverOf(makeReport(), "pnpm-store").status).toBe("ok");

    const report = makeReport({
      pnpm: {
        storePath: "C:\\store\\v11",
        sameVolume: false,
        importMethod: null,
      },
    });
    const lever = leverOf(report, "pnpm-store");
    expect(lever.status).toBe("actionable");
    expect(lever.actions[0]?.command).toContain("pnpm config set store-dir");
  });

  it("git 三项齐 → 就位；索引不是 v4 → 待办", () => {
    expect(leverOf(makeReport(), "git-index").status).toBe("ok");

    const report = makeReport({
      git: { untrackedCache: "true", indexVersion: "2", commitGraph: "true" },
    });
    expect(leverOf(report, "git-index").status).toBe("actionable");
  });

  it("Defender：受信任的开发驱动器 → 就位；未标信任 → 待办；查不到信任状态 → 不判", () => {
    const trusted = makeReport();
    trusted.volume.devDrive = "yes";
    trusted.volume.devDriveLabel = "是（受信任）";
    expect(leverOf(trusted, "defender").status).toBe("ok");

    const untrusted = makeReport();
    untrusted.volume.devDrive = "yes";
    untrusted.volume.devDriveLabel = "是（未标信任）";
    const lever = leverOf(untrusted, "defender");
    expect(lever.status).toBe("actionable");
    expect(lever.actions[0]?.command).toContain("fsutil devdrv trust");

    // 信任状态查不到（fsutil 要管理员）时判不了，不猜。
    expect(leverOf(makeReport(), "defender").status).toBe("na");
  });

  it("不是开发驱动器、实时保护开着又没排除 → 受阻（给排除项动作）", () => {
    const report = makeReport();
    report.volume.devDrive = "no";
    report.volume.devDriveLabel = "否（普通 ReFS 卷）";
    const lever = leverOf(report, "defender");
    expect(lever.status).toBe("blocked");
    expect(lever.actions[0]?.command).toContain("Add-MpPreference");
  });

  it("不是开发驱动器、但该卷已在排除项里 → 就位", () => {
    const excluded = makeReport({
      volume: {
        root: "G:\\",
        fsType: "ReFS",
        label: "dev",
        category: "refs",
        devDrive: "no",
        devDriveLabel: "否（普通 ReFS 卷）",
        defenderPerformanceMode: false,
        filters: [],
        filtersKnown: false,
      },
      defender: {
        known: true,
        realTime: true,
        exclusions: ["G:\\"],
        performanceMode: false,
      },
    });
    expect(leverOf(excluded, "defender").status).toBe("ok");
  });

  it("读不到 Defender 策略 → 不判（不猜）", () => {
    const report = makeReport({
      defender: {
        known: false,
        realTime: null,
        exclusions: [],
        performanceMode: false,
      },
    });
    expect(leverOf(report, "defender").status).toBe("na");
  });

  it("缓存目录在系统盘 → 待办，且动作是用户级环境变量", () => {
    const report = makeReport();
    report.cache.cargoHome = {
      envName: "CARGO_HOME",
      path: "C:\\Users\\me\\.cargo",
      sameVolume: false,
      suggestedSubPath: ".cargo",
    };
    const lever = leverOf(report, "cargo-home");
    expect(lever.status).toBe("actionable");
    expect(lever.actions[0]?.scope).toBe("user");
    expect(lever.actions[0]?.command).toContain("setx CARGO_HOME");
  });

  it("构建目录被软链接到别的卷 → 待办并点名那条路径", () => {
    const report = makeReport({
      workdirs: [
        {
          name: "node_modules",
          exists: true,
          realPath: "C:\\nm",
          sameVolume: false,
        },
        {
          name: ".git",
          exists: true,
          realPath: "G:\\repo\\.git",
          sameVolume: true,
        },
      ],
    });
    const lever = leverOf(report, "workdir");
    expect(lever.status).toBe("actionable");
    expect(lever.detail).toContain("node_modules");
  });
});

/**
 * 造一份 I/O 实测结果：只填与本组用例有关的字段。
 *
 * `engineSeconds` 是那个第三方引擎在负载窗口里吃到的 CPU 秒 —— 0 表示「在跑但没干活」。
 */
function makeBench(
  options: {
    engineSeconds?: number;
    enginePresent?: boolean;
    known?: boolean;
  } = {},
) {
  return {
    ran: true,
    note: "",
    bigMB: 256,
    smallCount: 1000,
    targets: [
      {
        label: "开发卷",
        dir: "G:\\.workbuddy\\dev-drive-bench",
        bigWriteMbps: 2900,
        bigReadMbps: 7300,
        smallCreatePerSec: 2553,
        smallReadPerSec: 8636,
        elapsedMs: 3031,
        cpuTop: [{ name: "MsMpEng", seconds: 18.9 }],
        watched: [
          {
            filter: "lnvscenter",
            process: "wsctrl11",
            label: "联想 / 火绒",
            present: options.enginePresent ?? true,
            seconds: options.engineSeconds ?? 0,
            known: options.known ?? true,
          },
        ],
      },
    ],
  };
}

describe("开发卷上的筛选器", () => {
  it("读不到清单 → 不判", () => {
    const report = makeReport();
    report.volume.filtersKnown = false;
    expect(leverOf(report, "dev-drive-filters").status).toBe("na");
  });

  it("只挂 Defender → 就位（性能模式覆盖整块卷）", () => {
    const report = makeReport();
    report.volume.filtersKnown = true;
    report.volume.filters = ["WdFilter"];
    expect(leverOf(report, "dev-drive-filters").status).toBe("ok");
  });

  it("挂着第三方筛选器但没实测 → 不判（挂着 ≠ 在扫），并给出复测命令", () => {
    const report = makeReport();
    report.volume.filtersKnown = true;
    report.volume.filters = ["lnvscenter", "WdFilter"];
    const lever = leverOf(report, "dev-drive-filters");
    expect(lever.status).toBe("na");
    expect(lever.detail).toContain("lnvscenter");
    expect(
      lever.actions.some((action) => action.command.includes("--bench")),
    ).toBe(true);
  });

  it("实测到第三方引擎在扫 → 待办，并给出那两条安全策略路径", () => {
    const report = makeReport();
    report.volume.filtersKnown = true;
    report.volume.filters = ["lnvscenter", "WdFilter"];
    report.bench = makeBench({ engineSeconds: 12.5 });
    const lever = leverOf(report, "dev-drive-filters");
    expect(lever.status).toBe("actionable");
    expect(lever.detail).toContain("12.5");
    expect(
      lever.actions.some((action) =>
        action.command.includes("setfiltersallowed"),
      ),
    ).toBe(true);
  });

  it("实测到第三方引擎 CPU 增量为 0 → 就位，且不给「改安全策略」的动作", () => {
    const report = makeReport();
    report.volume.filtersKnown = true;
    report.volume.filters = ["lnvscenter", "WdFilter"];
    report.bench = makeBench({ engineSeconds: 0 });
    const lever = leverOf(report, "dev-drive-filters");
    expect(lever.status).toBe("ok");
    expect(lever.detail).toContain("没有在扫");
    expect(lever.actions).toHaveLength(0);
  });

  it("认不出第三方筛选器对应哪个引擎进程 → 不判（不猜）", () => {
    const report = makeReport();
    report.volume.filtersKnown = true;
    report.volume.filters = ["SomeOtherFilter", "WdFilter"];
    report.bench = makeBench({ known: false });
    const lever = leverOf(report, "dev-drive-filters");
    expect(lever.status).toBe("na");
  });
});

describe("报告与计数", () => {
  it("计数按状态分档，四档加起来等于总条数", () => {
    const levers = buildLevers(makeReport());
    const summary = summarizeLevers(levers);
    expect(summary.total).toBe(levers.length);
    expect(summary.ok + summary.actionable + summary.blocked + summary.na).toBe(
      levers.length,
    );
  });

  it("渲染出的文本带着检出根、能力实测与动作矩阵三段", () => {
    const report = makeReport();
    report.levers = buildLevers(report);
    report.summary = summarizeLevers(report.levers);
    const text = renderReport(report);
    expect(text).toContain("检出根");
    expect(text).toContain("能力实测");
    expect(text).toContain("动作矩阵");
    expect(text).toContain("block-clone");
  });

  it("报告可以原样序列化成 JSON（机器可读出口）", () => {
    const report = makeReport();
    report.levers = buildLevers(report);
    report.summary = summarizeLevers(report.levers);
    const parsed = JSON.parse(JSON.stringify(report)) as { levers: unknown[] };
    expect(Array.isArray(parsed.levers)).toBe(true);
  });

  it("动作里的命令不得出现 npm / npx 形态（仓库口径：只用 pnpm）", () => {
    const report = makeReport({
      pnpm: {
        storePath: "C:\\store\\v11",
        sameVolume: false,
        importMethod: null,
      },
    });
    const commands = buildLevers(report)
      .flatMap((lever) => lever.actions.map((action) => action.command))
      .join("\n");
    expect(commands).not.toMatch(/\bnpm\s+run\b/);
    expect(commands).not.toMatch(/\bnpx\b/);
  });
});
