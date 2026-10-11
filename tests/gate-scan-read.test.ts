/**
 * 门禁扫描面的共用读取器 `scripts/gate-scan-read.cjs` —— 它自己的用例 + 一条防回潮判据
 * （规范 §11.14 / §13.5.12；为什么要有这一层，见那份文件的文件头）。
 *
 * 分成两半，缺一半都会留下没人守的格子：
 *
 *   **① 读取器本身的行为**（前几组）：`null` 只在 `ENOENT` 时出现、非 `ENOENT` 照冒、
 *   目录级降级、点开头**文件**不许被当成隐藏项跳掉、计数行的形状。
 *   这几条不是「跑一下没崩」——每一条都带一份**真的会失败**的对照：拿目录当文件读必须抛，
 *   拿隐藏目录当隐藏文件必须收，反之亦然。
 *
 *   **② 回潮判据**（最后两组）：收之前，全仓有 **15 份**判据在枚举 `tests/`，
 *   其中 **5 份各写了一份私有容错**（`check-test-sleep` / `check-test-waitfor` /
 *   `check-test-it-each` / `check-test-todo` / `check-annotate-consumer`），
 *   **剩下 10 份要么裸读、要么 `catch { continue }` 把所有错误一起吞掉**。
 *   私有副本的后果不是「难看」，是**「改一处漏三处」**，而且四份的语义本来就不齐 ——
 *   `annotate` 那一份是**静默 `continue`**（不计数 ⇒ 判据在它其实没读过的文件上报绿）。
 *   所以这里钉两条形状：
 *     · **A** 凡枚举 `tests/` 的 `scripts/check-*.cjs` 必须引用这份共用读取器；
 *     · **B** 吞 `ENOENT` 的那一句在全仓**只许出现在共用件里**（第二份私有实现 = 红）。
 *   两条都带**负控制**（合成的坏样本必须被抓到）—— 探测器写漂了会静默全绿，
 *   那比没有判据更坏（§11.18.3.1 那一族）。
 *
 * ⚠️ **这一层管不到的格子**：它判的是「读不到时怎么办」，不判「有没有漏读一整张面」。
 * 一份新判据若把扫描面写成 `["src"]`，A 条不会报红（它压根没枚举 `tests`）。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const requireCjs = createRequire(import.meta.url);

const READER_PATH = fileURLToPath(
  new URL("../scripts/gate-scan-read.cjs", import.meta.url),
);
const SCRIPTS_DIR = fileURLToPath(new URL("../scripts", import.meta.url));

type ScanReader = {
  readForScan: (abs: string) => string | null;
  readdirForScan: (dir: string) => Dirent[] | null;
  walkForScan: (
    dir: string,
    fileRe: RegExp,
    opts?: { skipDirs?: Set<string>; skipHiddenDirs?: boolean },
  ) => string[];
  vanishedNote: (count: number) => string;
};

const reader = requireCjs(READER_PATH) as ScanReader;

/** 每格自己建、自己拆：这些用例只在临时目录里活动，不碰工作树。 */
const made: string[] = [];

function tempDir(prefix = "gate-scan-read-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  }
});

describe("readForScan —— 文件级消失窗口", () => {
  it("列到名字、读时已没 ⇒ null，而不是把宿主进程带崩", () => {
    /* 真实形态是 `tests/.setup-cleanup-probe-*.test.tsx` 被并发用例删掉；这里直接
     * 拿一个「从来没存在过」的路径判同一件事（`ENOENT` 就是那一步的读数）。
     * ⚠️ 不造「删文件的时机」—— 那是一次概率窗口，判据不许长在上面。 */
    const gone = path.join(tempDir(), "never-there.test.tsx");
    expect(reader.readForScan(gone)).toBeNull();
  });

  it("存在就读得到：返回值是正文本身", () => {
    const dir = tempDir();
    const file = path.join(dir, "there.test.ts");
    writeFileSync(file, 'it("x", () => {});\n', "utf8");
    expect(reader.readForScan(file)).toContain('it("x"');
  });

  it("非 ENOENT 一律照冒：把目录当文件读必须抛，不许吞成 null", () => {
    /* 这一条是那条「只降级 ENOENT」的唯一负控制。吞掉权限错 / 形状错的后果是
     * 「判据读不到输入」变成静默放行 —— §13.5.12 那一族的反面。 */
    const dir = tempDir();
    let thrown: unknown;
    try {
      reader.readForScan(dir);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "读目录必须抛（吞成 null 就等于静默放行）").toBeTruthy();
    expect((thrown as NodeJS.ErrnoException).code).not.toBe("ENOENT");
  });
});

describe("readdirForScan / walkForScan —— 目录级消失窗口", () => {
  it("目录列不到 ⇒ readdir 给 null、walk 给空数组", () => {
    const missing = path.join(tempDir(), "gone");
    expect(existsSync(missing), "前提：这个路径不存在").toBe(false);
    expect(reader.readdirForScan(missing)).toBeNull();
    expect(reader.walkForScan(missing, /\.test\.tsx?$/)).toEqual([]);
  });

  it("点开头的**文件**照收，点开头的**目录**不收", () => {
    /* 这条形状是本层最容易写错的一格：并发探针的名字是 `.setup-cleanup-probe-….test.tsx`
     * —— 点开头、但**是文件**。把「跳过隐藏项」写成对两者都生效，判据就会在最该看着
     * 探针的那一刻转身不看（扫描面在没人察觉的情况下收窄 = 静默漏报）。 */
    const dir = tempDir();
    writeFileSync(path.join(dir, ".probe.test.tsx"), "x", "utf8");
    writeFileSync(path.join(dir, "plain.test.ts"), "y", "utf8");
    mkdirSync(path.join(dir, ".generated"));
    writeFileSync(path.join(dir, ".generated", "inside.test.ts"), "z", "utf8");

    const got = reader
      .walkForScan(dir, /\.test\.tsx?$/, { skipHiddenDirs: true })
      .map((abs) => path.basename(abs))
      .sort();
    expect(got).toEqual([".probe.test.tsx", "plain.test.ts"]);
  });

  it("默认不跳点开头的目录（`skipDirs` 才管名字白名单）", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, ".cache"));
    writeFileSync(path.join(dir, ".cache", "x.test.ts"), "z", "utf8");
    expect(
      reader.walkForScan(dir, /\.test\.ts$/).map((abs) => path.basename(abs)),
    ).toEqual(["x.test.ts"]);
  });

  it("`node_modules` 默认不收，自定义 `skipDirs` 叠加", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "node_modules"));
    mkdirSync(path.join(dir, "fixtures"));
    writeFileSync(path.join(dir, "node_modules", "dep.test.ts"), "a", "utf8");
    writeFileSync(path.join(dir, "fixtures", "keep.test.ts"), "b", "utf8");
    expect(
      reader
        .walkForScan(dir, /\.test\.ts$/, {
          skipDirs: new Set(["node_modules", "fixtures"]),
        })
        .map((abs) => path.basename(abs)),
    ).toEqual([]);
    /* 反向对照：只用默认白名单时 `fixtures` 必须在 —— 否则上面那条会因为
       「两条都跳了」而空绿（`node_modules` 本来就在默认白名单里，两份读数
       之间的差就是 `skipDirs` 传进来的那一项）。 */
    expect(
      reader.walkForScan(dir, /\.test\.ts$/).map((abs) => path.basename(abs)),
    ).toEqual(["keep.test.ts"]);
  });

  it("列出来的目录数与真实条目一致（量具自证：过滤器写漂会静默少收）", () => {
    const dir = tempDir();
    for (const name of ["a.test.ts", "b.test.tsx", "c.ts"]) {
      writeFileSync(path.join(dir, name), "x", "utf8");
    }
    const listed = reader.walkForScan(dir, /\.test\.tsx?$/);
    expect(listed).toHaveLength(2);
    expect(readdirSync(dir)).toHaveLength(3);
  });
});

describe("vanishedNote —— 消失数必须进结论", () => {
  it("零消失不给话", () => {
    expect(reader.vanishedNote(0)).toBe("");
  });

  it("有消失就把数写进那一行，且带「本轮未读」", () => {
    const note = reader.vanishedNote(3);
    expect(note).toContain("3");
    expect(note).toContain("本轮未读");
  });

  it("负控制：消失 1 份与 0 份的读数必须不同", () => {
    /* 「计数型判据的输出只证它数的那一格」—— 这条保证那行话真的是被 `vanished`
       驱动的，而不是一条恒在/恒不在的装饰。 */
    expect(reader.vanishedNote(1)).not.toBe(reader.vanishedNote(0));
  });
});

/* ── 回潮判据 ────────────────────────────────────────────────────────── */

/** 全仓 `scripts/check-*.cjs`（不含共用件本身）。 */
function gateScripts(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((n) => /^check-.*\.cjs$/.test(n))
    .map((n) => path.join(SCRIPTS_DIR, n));
}

/**
 * 探测器 A：这份判据**枚举了 `tests/`** 吗？
 * 认两种写法：`SCAN_DIRS = […, "tests", …]`，或直接把 `path.join(ROOT, "tests")`
 * 交给枚举函数（`check-dead-exports` / `check-gate-repo-boilerplate` 是这种）。
 */
function enumeratesTests(src: string): boolean {
  return (
    /SCAN_DIRS\s*=\s*\[[^\]]*"tests"/.test(src) ||
    /walk\w*\(\s*path\.join\(\s*ROOT\s*,\s*"tests"\s*\)/.test(src)
  );
}

/** 探测器 B：这份文件里有没有**自己吞 `ENOENT`** 的那一句（私有副本的指纹）。 */
function swallowsEnoent(src: string): boolean {
  return /code\s*===\s*"ENOENT"/.test(src);
}

describe("回潮判据 —— 消失容错只许有一处实现", () => {
  const scripts = gateScripts();
  const srcOf = (abs: string) => readFileSync(abs, "utf8");
  const readers = scripts.filter((abs) => enumeratesTests(srcOf(abs)));

  it("真仓库上确实枚举得到这批判据（正则写漂会静默全绿，那比红更坏）", () => {
    expect(
      readers.length,
      "探测器 A 一份都没抓到 —— 多半是它自己的正则漂了",
    ).toBeGreaterThanOrEqual(15);
    expect(readers.map((abs) => path.basename(abs))).toContain(
      "check-test-sleep.cjs",
    );
  });

  it("A：枚举 tests 的判据必须引用共用读取器", () => {
    const missing = readers
      .filter(
        (abs) => !/require\(\s*"\.\/gate-scan-read\.cjs"\s*\)/.test(srcOf(abs)),
      )
      .map((abs) => path.basename(abs));
    expect(
      missing,
      `这些判据枚举 tests/ 却不走共用读取器（读到消失的文件会带着 D 组一起崩）：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("B：吞 ENOENT 的那一句只许出现在共用件里", () => {
    const privateCopies = scripts
      .filter((abs) => swallowsEnoent(srcOf(abs)))
      .map((abs) => path.basename(abs));
    expect(
      privateCopies,
      `这些判据自己写了一份消失容错（私有副本的后果是改一处漏三处）：${privateCopies.join(", ")}`,
    ).toEqual([]);
    /* 反向：共用件本身必须**有**那一句 —— 没有它，上面那条会因为「谁都没有」而空绿。 */
    expect(swallowsEnoent(readFileSync(READER_PATH, "utf8"))).toBe(true);
  });

  it("负控制：合成一份坏判据，两条探测器都必须抓到", () => {
    const bad = [
      'const SCAN_DIRS = ["src", "tests"];',
      "const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));",
      'const raw = fs.readFileSync(abs, "utf8");',
      'if (error && error.code === "ENOENT") return null;',
    ].join("\n");
    expect(
      enumeratesTests(bad),
      "A 探测器对合成样本失配 = 它抓不到真回潮",
    ).toBe(true);
    expect(swallowsEnoent(bad), "B 探测器对合成样本失配 = 同上").toBe(true);

    /* 另一侧：不枚举 tests 的判据不许被 A 误伤（`check-rust-function-length` 扫的是壳）。 */
    expect(
      enumeratesTests(
        'const SCAN_DIRS = ["src-tauri/src"];\nconst t = "tests" in name;',
      ),
    ).toBe(false);
  });
});
