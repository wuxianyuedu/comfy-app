/** `.next/types` / `.next/dev/types` 清理的回归（ISSUE #4109 / #5025）。
 * 现场：源码删掉 `src/app/login/page.tsx` 后，重装依赖没动 `.next`，`tsc --noEmit`
 * 仍拿旧的 `validator.ts` 报 TS2307。判据只管生成物那一层 —— 编译缓存必须留下，
 * 否则每次同步依赖都付一次全量重编译的代价。dev 侧（#5025）按需清理：清单里出现
 * 「指向已删路由」的引用才动手。 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanStaleNextTypes,
  DEV_TYPES_REL,
  findMissingRouteRefs,
  NEXT_TYPES_REL,
  pruneStaleDevRouteTypes,
} from "../scripts/next-types-clean.mjs";

const roots: Array<string> = [];
function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "comfy-next-types-"));
  roots.push(root);
  return root;
}
function write(root: string, rel: string, content = "x") {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() ?? "", { recursive: true, force: true });
  }
});

describe("cleanStaleNextTypes", () => {
  it("没有生成物时是空操作（干净检出 / 已清过）", () => {
    const root = tempRoot();
    expect(cleanStaleNextTypes(root)).toEqual({
      removed: false,
      path: path.join(root, NEXT_TYPES_REL),
    });
  });

  it("只删 .next/types，编译缓存原样保留", () => {
    const root = tempRoot();
    const validator = write(root, path.join(NEXT_TYPES_REL, "validator.ts"), "stale import");
    const cache = write(root, path.join(".next", "cache", "webpack", "keep.bin"), "cache");

    expect(cleanStaleNextTypes(root)).toEqual({
      removed: true,
      path: path.join(root, NEXT_TYPES_REL),
    });
    expect(existsSync(validator)).toBe(false);
    expect(existsSync(cache)).toBe(true);
    /* 再跑一次是空操作：deps:sync 可能被连着跑（ship 失败后重试），不该报错。 */
    expect(cleanStaleNextTypes(root).removed).toBe(false);
  });
});

/** 造一份 Next 形态的 dev validator：`typeof import("<相对说明符>")` 逐条指向路由文件。 */
function writeDevValidator(root: string, specs: Array<string>): string {
  const body = specs
    .map((spec, i) => `// Validate ${spec}\nconst handler${i} = {} as typeof import("${spec}");`)
    .join("\n");
  return write(root, path.join(DEV_TYPES_REL, "validator.ts"), body);
}

describe("pruneStaleDevRouteTypes —— .next/dev/types 按需清理（ISSUE #5025）", () => {
  it("没有 dev 生成物时是空操作（干净检出 / 已清过）", () => {
    const root = tempRoot();
    expect(pruneStaleDevRouteTypes(root)).toEqual({ status: "noop", missing: [] });
  });

  it("清单与磁盘一致（.js 说明符对上 .tsx 路由文件）时不清理", () => {
    const root = tempRoot();
    write(root, path.join("src", "app", "(main)", "models", "page.tsx"), "export default {}");
    writeDevValidator(root, ["../../../src/app/(main)/models/page.js"]);
    expect(pruneStaleDevRouteTypes(root)).toEqual({ status: "clean", missing: [] });
    expect(existsSync(path.join(root, DEV_TYPES_REL, "validator.ts"))).toBe(true);
  });

  it("清单里出现已删路由时整目录清掉 .next/dev/types，其它缓存保留", () => {
    const root = tempRoot();
    write(root, path.join("src", "app", "page.tsx"), "export default {}");
    writeDevValidator(root, [
      "../../../src/app/page.js",
      "../../../src/app/api/size-presets/project-default/route.js",
    ]);
    const cache = write(root, path.join(".next", "cache", "turbopack", "keep.bin"), "cache");

    expect(pruneStaleDevRouteTypes(root)).toEqual({
      status: "pruned",
      missing: ["../../../src/app/api/size-presets/project-default/route.js"],
    });
    expect(existsSync(path.join(root, DEV_TYPES_REL))).toBe(false);
    expect(existsSync(cache)).toBe(true);
  });

  it("清单内部引用（./routes.js）与 node_modules 不参与判缺失", () => {
    const root = tempRoot();
    writeDevValidator(root, ["./routes.js", "next/server.js"]);
    expect(pruneStaleDevRouteTypes(root)).toEqual({ status: "clean", missing: [] });
  });

  it("validator 读不出来时跳过（不挡 typecheck）", () => {
    const root = tempRoot();
    /* validator.ts 位置放一个目录：readFileSync 必然 EISDIR。 */
    mkdirSync(path.join(root, DEV_TYPES_REL, "validator.ts"), { recursive: true });
    expect(pruneStaleDevRouteTypes(root)).toEqual({ status: "skip", missing: [] });
  });
});

describe("findMissingRouteRefs —— 说明符解析判据", () => {
  it("只报 src/ 下确实找不到目标的路由引用，顺序保持、同一说明符去重", () => {
    const root = tempRoot();
    const typesDir = path.join(root, DEV_TYPES_REL);
    write(root, path.join("src", "app", "page.tsx"), "export default {}");
    const text = [
      `const a = {} as typeof import("../../../src/app/page.js");`,
      `const b = {} as typeof import("../../../src/app/gone/route.js");`,
      `const c = {} as typeof import('../../../src/app/gone/route.js');`,
      `const d = {} as typeof import("../../../src/app/page.js");`,
    ].join("\n");
    expect(findMissingRouteRefs(text, typesDir, root)).toEqual(["../../../src/app/gone/route.js"]);
  });
});
