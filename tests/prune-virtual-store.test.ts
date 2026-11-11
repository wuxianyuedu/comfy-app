/**
 * `scripts/prune-virtual-store.mjs` 的自测（ISSUE #3545）：把「清虚拟 store 残留」从
 * 手工删目录收成 `pnpm deps:prune` 之后，最容易坏的不是「删不掉」，而是**删错**：
 * 把还在依赖图里的条目、`.pnpm/node_modules` 或身份判不准的目录一起收走。所以这里
 * 每一条都同时判退出码、正文与**盘上的事实**（§13.6.4：效应不许只转述自己的 stdout）。
 *
 * 夹具走 `createGateRepo()`：脚本按自身位置定位仓库根，临时工作区就是被测仓库，
 * 不会碰到真仓的 `node_modules`（与 `client-bundle-node-builtins.test.ts` 同形）。
 * `copyGateDeps()` 会按 import 把 `scripts/lockfile/lock-diff.mjs` 一并带进沙箱。
 */
import { describe, expect, it } from "vitest";

import {
  createGateRepo,
  expectGateRan,
  type GateRepo,
  type GateRepoHandle,
} from "./helpers/gate-repo";

const SCRIPT = "prune-virtual-store.mjs";
/** pnpm 的 hoisted 虚拟目录，必须原样留着（造一个文件让「在不在」判得到）。 */
const HOISTED_MARKER = "node_modules/.pnpm/node_modules/.keep";

/** 造一份最小 `pnpm-lock.yaml`：判据只要 `packages` 段的一级键。 */
function lockfile(packages: Array<string>): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies: {}",
    "",
    "packages:",
    "",
    ...packages.map((id) => `  '${id}':\n    resolution: {integrity: sha512-probe}`),
    "",
  ].join("\n");
}

/* 字段按 `perfectionist/sort-object-types` 的字母序摆（41 条已清零规则集之一）。 */
type Entry = {
  /** 覆盖 `package.json` 正文；不给就按 `{name, version}` 造一份。 */
  body?: string;
  /** `.pnpm` 下的条目目录名（可以带 peer 后缀、可以是 pnpm 12 的截断形态）。 */
  dir: string;
  /** 条目自己的包名（作用域包写成 `@scope/name`）。 */
  name: string;
  version?: string;
};

type Fixture = {
  entries?: Array<Entry>;
  /** 额外文件（例如造「目录在、package.json 不在」）。 */
  extra?: Record<string, string>;
  /** 不写 `pnpm-lock.yaml`（造「图读不到」）。 */
  noLock?: boolean;
  /** 不建 `.pnpm`（造「前置不成立」）。 */
  noStore?: boolean;
  /** 当前依赖图里的 `name@version` 身份。 */
  packages?: Array<string>;
};

/** 按夹具摆一份临时仓库，返回句柄；调用点在 `finally` 里 `dispose()`。 */
function repo(files: Record<string, string>): GateRepoHandle {
  return createGateRepo({
    script: SCRIPT,
    workdir: "prune-virtual-store",
    files,
  });
}

function fixture(options: Fixture = {}): Record<string, string> {
  const files: Record<string, string> = {};
  if (!options.noLock) {
    files["pnpm-lock.yaml"] = lockfile(options.packages ?? ["kept@1.0.0"]);
  }
  if (!options.noStore) {
    files[HOISTED_MARKER] = "hoisted\n";
  }
  for (const entry of options.entries ?? []) {
    const pkg = `node_modules/.pnpm/${entry.dir}/node_modules/${entry.name}/package.json`;
    files[pkg] =
      entry.body ?? JSON.stringify({ name: entry.name, version: entry.version ?? "1.0.0" });
  }
  Object.assign(files, options.extra ?? {});
  return files;
}

/** 跑一次，先把「根本没跑起来」单独判掉，再交出结果给断言。 */
function run(r: GateRepo, args: Array<string> = []) {
  const result = r.run(args);
  expectGateRan(result);
  return result;
}

describe("pnpm deps:prune（虚拟 store 残留收口）", () => {
  it("只删不在图里的条目；图内条目与 .pnpm/node_modules 一个都不碰", () => {
    const handle = repo(
      fixture({
        packages: ["kept@1.0.0"],
        entries: [
          { dir: "kept@1.0.0", name: "kept" },
          { dir: "gone@0.9.0", name: "gone", version: "0.9.0" },
        ],
      }),
    );
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(0);
      expect(output).toContain("已收干净：删掉 1 个残留条目，图内 1 个条目一个没动");
      expect(handle.repo.exists("node_modules/.pnpm/gone@0.9.0")).toBe(false);
      expect(handle.repo.exists("node_modules/.pnpm/kept@1.0.0")).toBe(true);
      expect(handle.repo.exists(HOISTED_MARKER)).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("--dry-run 只念清单，一个都不删", () => {
    const handle = repo(
      fixture({
        packages: ["kept@1.0.0"],
        entries: [{ dir: "gone@0.9.0", name: "gone", version: "0.9.0" }],
      }),
    );
    try {
      const { code, output } = run(handle.repo, ["--dry-run"]);
      expect(code, output).toBe(0);
      expect(output).toContain("残留 1");
      expect(output).toContain("--dry-run 结束：会删 1 个条目（实际一个都没删）");
      expect(handle.repo.exists("node_modules/.pnpm/gone@0.9.0")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("pnpm 12 截断成 …_<hash> 的目录靠自己的 package.json 分类：残留删、图内留", () => {
    const hashedStale = "@babel+helper-create-regexp_055bc6f28bc6f1322ef7c9174c4b48cd";
    const hashedKept = "@babel+helper-create-class-_90945c06c714199cba5e9497418c18aa";
    const handle = repo(
      fixture({
        packages: ["@babel/helper-create-class-features-plugin@7.29.7"],
        entries: [
          {
            dir: hashedStale,
            name: "@babel/helper-create-regexp-features-plugin",
            version: "7.29.10",
          },
          {
            dir: hashedKept,
            name: "@babel/helper-create-class-features-plugin",
            version: "7.29.7",
          },
        ],
      }),
    );
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(0);
      expect(output).toContain("判不准 0");
      expect(handle.repo.exists(`node_modules/.pnpm/${hashedStale}`)).toBe(false);
      expect(handle.repo.exists(`node_modules/.pnpm/${hashedKept}`)).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("peer 后缀与包名里的下划线都不误判：还在图里的条目不删", () => {
    const handle = repo(
      fixture({
        packages: ["@babel/core@7.29.7", "@types/babel__core@7.20.5"],
        entries: [
          {
            dir: "@babel+core@7.29.7_supports-color@8.1.1",
            name: "@babel/core",
            version: "7.29.7",
          },
          {
            dir: "@types+babel__core@7.20.5",
            name: "@types/babel__core",
            version: "7.20.5",
          },
        ],
      }),
    );
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(0);
      expect(output).toContain("已收干净：删掉 0 个残留条目，图内 2 个条目一个没动");
      expect(handle.repo.exists("node_modules/.pnpm/@babel+core@7.29.7_supports-color@8.1.1")).toBe(
        true,
      );
      expect(handle.repo.exists("node_modules/.pnpm/@types+babel__core@7.20.5")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("目录名归一出的身份与 package.json 对不上 ⇒ 判不准、不删、退 1", () => {
    const handle = repo(
      fixture({
        packages: ["kept@1.0.0"],
        entries: [{ dir: "wrong@1.0.0", name: "other", version: "2.0.0" }],
      }),
    );
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(1);
      expect(output).toContain("判不准 1");
      expect(output).toContain("目录名是 wrong@1.0.0，条目自己的 package.json 是 other@2.0.0");
      expect(output).toContain("没量到不等于可以删");
      expect(handle.repo.exists("node_modules/.pnpm/wrong@1.0.0")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  const unreadable: Array<{
    body: string | undefined;
    dir: string;
    extra: Record<string, string> | undefined;
    label: string;
    why: string;
  }> = [
    {
      label: "package.json 不在了",
      dir: "half@1.0.0",
      body: undefined,
      extra: { "node_modules/.pnpm/half@1.0.0/node_modules/half/README.md": "半截安装\n" },
      why: "读不到 package.json",
    },
    {
      label: "package.json 不是合法 JSON",
      dir: "broken@1.0.0",
      body: "{ not json",
      extra: undefined,
      why: "package.json 不是合法 JSON",
    },
    {
      label: "package.json 没有 name / version",
      dir: "nameless@1.0.0",
      body: JSON.stringify({ description: "缺身份" }),
      extra: undefined,
      why: "package.json 里没有可用的 name / version",
    },
  ];

  it.for(unreadable)("判不准不删（$label）⇒ 退 1", ({ dir, body, extra, why }) => {
    const entries: Array<Entry> = body ? [{ dir, name: dir.split("@")[0] ?? "pkg", body }] : [];
    const handle = repo(fixture({ packages: ["kept@1.0.0"], entries, extra }));
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(1);
      expect(output).toContain("判不准 1");
      expect(output).toContain(why);
      expect(handle.repo.exists(`node_modules/.pnpm/${dir}`)).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("一个条目里出现两个不同包身份 ⇒ 判不准、不删、退 1", () => {
    const handle = repo(
      fixture({
        packages: ["kept@1.0.0"],
        entries: [
          { dir: "mixed@1.0.0", name: "one", version: "1.0.0" },
          { dir: "mixed@1.0.0", name: "two", version: "2.0.0" },
        ],
      }),
    );
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(1);
      expect(output).toContain("条目里有 2 个不同包身份");
      expect(handle.repo.exists("node_modules/.pnpm/mixed@1.0.0")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it.for([
    {
      label: "pnpm-lock.yaml 不在",
      lock: undefined,
      noLock: true,
      why: "当前依赖图读不出来",
    },
    {
      label: "packages 段是空的",
      lock: lockfile([]),
      noLock: false,
      why: "pnpm-lock.yaml 里没有非空的 packages 段",
    },
  ] as const)("依赖图读不出来（$label）⇒ 退 1，一个条目都不删", ({ noLock, lock, why }) => {
    const base = fixture({
      noLock,
      packages: ["kept@1.0.0"],
      entries: [{ dir: "gone@0.9.0", name: "gone", version: "0.9.0" }],
    });
    if (lock !== undefined) {
      base["pnpm-lock.yaml"] = lock;
    }
    const handle = repo(base);
    try {
      const { code, output } = run(handle.repo);
      expect(code, output).toBe(1);
      expect(output).toContain(why);
      expect(output).toContain("图没读到，一个条目都不删");
      expect(handle.repo.exists("node_modules/.pnpm/gone@0.9.0")).toBe(true);
    } finally {
      handle.dispose();
    }
  });

  it("前置不成立 / 用法错退 2，--help 退 0", () => {
    const handle = repo(fixture({ noStore: true, entries: [] }));
    try {
      const missing = run(handle.repo);
      expect(missing.code, missing.output).toBe(2);
      /* `path.relative()` 在 Windows 上是反斜杠，断言只钉语义不钉分隔符。 */
      expect(missing.output).toContain("前置不成立：读不到");
      expect(missing.output).toContain("依赖还没装");

      const unknown = run(handle.repo, ["--delete-everything"]);
      expect(unknown.code, unknown.output).toBe(2);
      expect(unknown.output).toContain("未知参数：--delete-everything");

      const help = run(handle.repo, ["--help"]);
      expect(help.code, help.output).toBe(0);
      expect(help.output).toContain("用法：pnpm deps:prune [--dry-run]");
      expect(help.output).toContain("--dry-run   只列出会删什么，一个都不删");
    } finally {
      handle.dispose();
    }
  });
});
