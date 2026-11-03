/**
 * 覆盖率配置里的每一条都要落到真实文件（规范 §11.7 / §18.6）。
 *
 * 为什么值得单独一条判据：`coverage.include` 与 `coverage.thresholds` 的键都是
 * **路径 glob**，而 vitest 只对「出现在报告里的文件」判门槛 —— 指向不存在文件的条目
 * 不报错、不告警、不进报告，表现就是一扇写着有、其实没人判的门。这件事本仓库
 * 已经撞过两次，第二次撞完只留下注释提醒（`vitest.config.ts` 里那几段「两处同批改」），
 * 而注释拦不住下一次删模块：
 *   · 删 `src/server/api/routers/train.ts`（功能废弃）时，它的 `include` 条目与
 *     一条 100/100/100/100 的门槛都留在原地；
 *   · 把两条派发循环收成一条 pull、删 `src/lib/comfyui/executor-scheduler.ts` 时，
 *     它的门槛同样原地不动 —— 而接住那部分逻辑的 `executor-dispatch.ts` 从来没有档。
 * 两次都没有任何一条现有判据变红：68 份判据扫的是 `src/**`，配置文件本身不在任何
 * 一份的作用域里（同族先例：`tests/rest-endpoint-targets.test.ts` 管的是客户端写的
 * `/api/` 地址必须有落点，那一格在 `src/**` 里）。
 *
 * 判的是「键 ⇄ 磁盘」，不是「键 ⇄ 报告」：拿报告比会把上一次跑绿的那一轮当事实源，
 * 而增量档跑出来的报告本来就只含部分文件（实测那份只有 380 个文件），会把
 * 「本次没跑到」误报成「配置悬空」。
 *
 * ⚠️ 转义口径（§11.7 那条坑）：配置里的键是 gitignore 风格转义（`src/app/\(main\)/…`），
 * 磁盘路径是原样圆括号。直接字符串比会造出假红，所以先脱转义再交给 glob 匹配。
 *
 * ⚠️ **门槛从「登记处」那份具名导出取，不从默认导出的 `test.coverage.thresholds` 取**
 * （ISSUE #2669：业主口径把整体 / 目录级覆盖率改成「只上报，不拦 CI」，默认档下交给
 * vitest 的那一份被开关摘空）。这是本文件唯一能成立的读法 —— 读那份被摘空的，
 * 判据会在「没人动过任何门槛」的那一天静默变成空转，而它治的正是静默失效。
 * 「判定 ⇄ 登记是两件事」本身由下面那条档位用例钉住（两侧都判）。
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import vitestConfig, { COVERAGE_THRESHOLDS } from "../vitest.config";

/* SAFETY: 类型断言已复核 */
// oxlint-disable-next-line typescript/no-require-imports
const { globToRegExp } = require("../scripts/check-format.cjs") as {
  globToRegExp: (glob: string) => RegExp;
};

const ROOT = path.resolve(import.meta.dirname, "..");

/** 配置里的 glob 是转义形态，磁盘路径不是 —— 比之前先脱转义。 */
const unescapeGlob = (glob: string) => glob.replaceAll("\\", "");

function sourceFiles(): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        out.push(path.relative(ROOT, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/* 门槛读的是**登记处**那份具名导出，不是默认导出里的 `test.coverage.thresholds`
 * （ISSUE #2669：默认档下那份被开关摘空了 —— 拿它当输入，本判据就会在没人改任何门槛
 * 的那一天静默变成空转，而这正是本文件立单要治的「写着有、其实没人判」）。
 * `include` 没有开关，仍读默认导出。 */
/* SAFETY: 类型断言已复核 */
const coverage = (
  vitestConfig as unknown as {
    test?: {
      coverage?: { include?: Array<string> };
    };
  }
).test?.coverage;

const includeEntries = coverage?.include ?? [];
const thresholdKeys = Object.keys(COVERAGE_THRESHOLDS).filter(
  (key) => typeof COVERAGE_THRESHOLDS[key] === "object",
);

const files = sourceFiles();

function matchedCount(glob: string): number {
  const re = globToRegExp(unescapeGlob(glob));
  return files.filter((f) => re.test(f)).length;
}

describe("覆盖率配置的每一条都要落到真实文件", () => {
  it("配置真的解析出了两份清单（解析失效时本条要红，不要静默绿）", () => {
    expect(coverage, "vitest.config.ts 的 test.coverage 解析不到了").toBeTruthy();
    expect(includeEntries.length).toBeGreaterThan(0);
    expect(thresholdKeys.length).toBeGreaterThan(0);
  });

  it("判定是开关、登记是账：默认档摘空的是「交给 vitest 的那一份」，不是登记处", () => {
    /* ISSUE #2669 带进来的那条形状，所以两侧都要判，只判一侧就退回本次要修的状态：
     *   · **登记处**在任何档位都必须满 —— 本文件的清单从它取；
     *   · **交给 vitest 的那一份**才随开关走 —— 它决定退码。
     * 期望由当前环境自己推（不写死档位），所以 `COMFY_COVERAGE_ENFORCE=1` 那一档下
     * 这一条不假红；而「开关没接上」（默认档仍带着门槛）会被那一支 `toBe(0)` 当场抓到。 */
    const enforce = process.env.COMFY_COVERAGE_ENFORCE === "1";
    const registered = Object.keys(COVERAGE_THRESHOLDS).length;
    expect(registered, "登记处空了 —— 门槛被连账一起摘掉，本判据从此没有对象").toBeGreaterThan(100);
    const applied = Object.keys(
      (
        vitestConfig as unknown as {
          test?: { coverage?: { thresholds?: Record<string, unknown> } };
        }
      ).test?.coverage?.thresholds ?? {},
    ).length;
    expect(
      applied,
      enforce
        ? "硬档下该把登记处整份交给 vitest（读到不等 ⇒ 开关接反）"
        : "默认档该摘空的是**判定**而不是账（读到非 0 ⇒ 开关没接上，CI 仍会因整体覆盖率红）",
    ).toBe(enforce ? registered : 0);
  });

  it("匹配器本身不是空转：include 合起来要覆盖到成规模的源文件", () => {
    const reached = files.filter((f) =>
      includeEntries.some((glob) => globToRegExp(unescapeGlob(glob)).test(f)),
    );
    expect(
      reached.length,
      `include 共 ${includeEntries.length} 条却只命中 ${reached.length} 个文件 —— 先怀疑匹配口径`,
    ).toBeGreaterThan(100);
  });

  it("每一条 glob 都按 `src/` 开头（不承认仓库外的条目）", () => {
    const offRoot = [...includeEntries, ...thresholdKeys].filter(
      (entry) => !unescapeGlob(entry).startsWith("src/"),
    );
    expect(offRoot, `这些覆盖率条目不在 src/ 面里：\n${offRoot.join("\n")}`).toEqual([]);
  });

  it("coverage.include 的每一项都匹配到至少一个真实文件", () => {
    const dangling = includeEntries.filter((glob) => matchedCount(glob) === 0);
    expect(
      dangling,
      `这些 include 条目指向不存在的文件（门槛挂在判据不认识的路径上）：\n${dangling.join("\n")}`,
    ).toEqual([]);
  });

  it("coverage.thresholds 的每一个键都匹配到至少一个真实文件", () => {
    const dangling = thresholdKeys.filter((glob) => matchedCount(glob) === 0);
    expect(
      dangling,
      `这些门槛条目指向不存在的文件，等于一扇没人判的门：\n${dangling.join("\n")}`,
    ).toEqual([]);
  });

  it("删掉一条真实档会让本判据变红（判据真的有牙）", () => {
    /* 反向自证：拿一个磁盘上确定存在的文件构造断言，确认 matchedCount>0 ——
     * 若匹配口径哪天坏掉，这一条会先红，而不是让上面两条一起变成恒绿。 */
    const probe = "src/lib/endpoints.ts";
    expect(statSync(path.join(ROOT, probe)).isFile(), `${probe} 不在了？`).toBe(true);
    expect(matchedCount(probe), `${probe} 匹配不上，说明匹配口径坏了`).toBeGreaterThan(0);
  });
});
