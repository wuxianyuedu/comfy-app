/**
 * 「节点镜像」那一份计划与打包的判据（ISSUE #1993 的续：用 docker 提速）。
 *
 * 被测的是 `scripts/ci-image-plan.mjs` —— 它**不碰 docker**（构建容器里没有 daemon），
 * 只算命令与打包。所以这一组判据全部落在能在本机判的形状上：版本**现读**（不写死）、
 * 层序（提交点写偏一层是这一层唯一不报错的错误）、tarball 的三种字节语义、
 * 以及「四件的清单只有一处出处」。
 *
 * 每条判据都配了**反向复算**：把缺陷形态放回去，对应的断言当场点名。
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildTarStream,
  checkCommands,
  diskFacts,
  dockerfileHint,
  fetchNodePlan,
  imagePlan,
  imagePlanLayersAreOrdered,
  IMAGE_CHECKS,
  main,
  nodeFloor,
  pickNodeVersion,
  selfCheckRunLines,
  tarballDigest,
  toolingVersionsFromLock,
} from "../scripts/ci-image-plan.mjs";

const ROOT = path.resolve(__dirname, "..");
const TMP = mkdtempSync(path.join(tmpdir(), "ci-image-plan-"));

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("engines.node 的下限与版本挑选", () => {
  it("取三段范围里最小的那一个下限", () => {
    expect(nodeFloor("^22.22.2 || ^24.15.0 || >=26.0.0")).toEqual({
      major: 22,
      minor: 22,
      patch: 2,
    });
    expect(nodeFloor(">=26.0.0")).toEqual({ major: 26, minor: 0, patch: 0 });
    expect(nodeFloor("^24.15.0")).toEqual({ major: 24, minor: 15, patch: 0 });
  });

  it("认不出的范围当场抛，不退回猜出来的版本", () => {
    /* 反向复算：这一档退回 `{major: 24}` 之类的缺省值时，镜像与 `engines.node`
     * 各走各的，而两者都在盘上、谁也没报错。 */
    expect(() => nodeFloor("~24.0.0")).toThrow(/认不出下限/);
    expect(() => nodeFloor("")).toThrow(/认不出下限/);
  });

  it("只挑 linux-x64 有产物的那一版，且必须满足下限", () => {
    const index = [
      { version: "v24.1.0", files: ["linux-x64"] },
      { version: "v24.20.0", files: ["linux-x64"] },
      { version: "v26.0.0", files: ["linux-arm64"] },
      { version: "v22.23.3", files: ["linux-x64"] },
    ];
    expect(pickNodeVersion(index, { major: 24, minor: 15, patch: 0 })).toBe("v24.20.0");
    /* 有更新的 major、但它没有 `linux-x64` 产物 ⇒ 不许被挑中：镜像里下不下来取决于
     * `files`，不取决于版本号；一个都没有满足下限时如实抛，而不是挑个「最接近」的。 */
    expect(() => pickNodeVersion(index, { major: 26, minor: 0, patch: 0 })).toThrow(/没有满足下限/);
    /* 下限再抬一点点就一个都不满足了 —— 同一份清单，结论跟着下限走。 */
    expect(() => pickNodeVersion(index, { major: 24, minor: 21, patch: 0 })).toThrow(
      /没有满足下限/,
    );
    expect(pickNodeVersion(index, { major: 22, minor: 0, patch: 0 })).toBe("v24.20.0");
  });

  it("清单里一个都不满足时抛（而不是挑个最近的）", () => {
    expect(() =>
      pickNodeVersion([{ version: "v20.0.0", files: ["linux-x64"] }], {
        major: 24,
        minor: 0,
        patch: 0,
      }),
    ).toThrow(/没有满足下限/);
  });
});

describe("版本号现读：锁文件里只认根 importer", () => {
  const lock = [
    "---",
    "lockfileVersion: '9.0'",
    "importers:",
    "",
    "  .:",
    "    configDependencies: {}",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.4.1",
    "        version: 12.4.1",
    "",
    "packages:",
    "",
    "  playwright@9.9.9:",
    "    resolution: {integrity: sha512-x}",
    "",
    "importers:",
    "",
    "  .:",
    "    devDependencies:",
    "      '@playwright/test':",
    "        specifier: ^1.63.0",
    "        version: 1.63.0",
    "      drizzle-kit:",
    "        specifier: ^0.31.11",
    "        version: 0.31.11(esbuild@0.28.2)",
    "",
  ].join("\n");

  it("带 scope 的包名与带 peer 后缀的版本都读得对", () => {
    expect(toolingVersionsFromLock(lock, ["@playwright/test", "drizzle-kit"])).toEqual({
      "@playwright/test": "1.63.0",
      "drizzle-kit": "0.31.11",
    });
  });

  it("取的是**最后**那一段 importers（本仓锁文件里它出现两次）", () => {
    /* 反向复算：改成「第一段」会得到「找不到这两件」—— 而那句话与
     * 「本仓真的没有这两个依赖」逐字同形。 */
    const onlyFirst = lock.slice(0, lock.indexOf("packages:"));
    expect(toolingVersionsFromLock(onlyFirst, ["@playwright/test"])).toEqual({});
  });

  it("不会串到 packages: 那一段里的同名包", () => {
    const text = toolingVersionsFromLock(lock, ["playwright", "@playwright/test"]);
    expect(text.playwright).toBeUndefined();
  });

  it("本仓真锁文件里那两件都读得到（判据别只在假数据上绿）", () => {
    const facts = diskFacts({ root: ROOT });
    expect(facts.missingNpm).toEqual([]);
    expect(facts.pnpmVersion).toMatch(/^\d+\.\d+\.\d+/);
    // 与 package.json 的 engines.node（>=26.12.1，#2531/#2552 钉死）同源；别写死旧值
    expect(facts.enginesRange).toContain(">=26.12.1");
  });
});

describe("Dockerfile 的形状", () => {
  const plan = imagePlan({ nodeVersion: "v24.22.0", pnpmVersion: "12.4.1" });

  it("版本号来自入参，不写死", () => {
    expect(plan.dockerfile).toContain("ARG NODE_VERSION=v24.22.0");
    expect(plan.dockerfile).toContain("pnpm@12.4.1");
    const other = imagePlan({ nodeVersion: "v26.12.0", pnpmVersion: "12.5.0" });
    expect(other.dockerfile).toContain("ARG NODE_VERSION=v26.12.0");
    expect(other.dockerfile).toContain("pnpm@12.5.0");
  });

  it("拒绝形状不对的版本（别让 git tag 那种东西混进去）", () => {
    expect(() => imagePlan({ nodeVersion: "24.22.0", pnpmVersion: "12.4.1" })).toThrow(/精确号/);
    expect(() => imagePlan({ nodeVersion: "v24.22.0", pnpmVersion: "latest" })).toThrow(
      /pnpm 版本形状/,
    );
  });

  it("层序：清单 COPY → 安装 → 源码 COPY", () => {
    expect(imagePlanLayersAreOrdered(plan.dockerfile).ok).toBe(true);
  });

  it("层序写偏一层时判据当场点名（反向复算）", () => {
    /* 把 `COPY . .` 提到安装之前 —— 改一行业务代码就会让依赖层失效（丢掉层缓存）。
     * 注意**不能**用「先删后插」那种改写：`COPY package.json …` 那一行同时满足
     * `^COPY package\.json` 与 `^COPY \.`，删一行会连带把清单 COPY 一起吃掉，
     * 于是变异体其实「合规」了 —— 判据在原地照旧绿，而那是变异写错了。 */
    const insertBefore = (text: string, before: RegExp, line: string) =>
      text.replace(before, (m) => `${line}\n${m}`);

    const copyAllEarly = imagePlanLayersAreOrdered(
      insertBefore(plan.dockerfile, /^RUN pnpm install/m, "COPY . ."),
    );
    expect(copyAllEarly.ok).toBe(false);
    expect(copyAllEarly.problems.join("\n")).toMatch(/`COPY \. \.` 排在 `pnpm install` 之前/);

    /* 把清单 COPY 挪到安装之后再插入 —— 依赖层于是永远拿不到输入（缓存恒失效），
     * 而这份 Dockerfile 仍然能构建成功：这正是它要靠判据发现的原因。
     *
     * 落点是 `COPY . .` 的**前**一行（后一行会把两行融成 `COPY . .COPY …`，那既不是
     * 合法的 Dockerfile，也不是这条判据要判的形态 —— 变异要长得像人真会写错的样子）。 */
    const manifestLine = /^COPY package\.json[^\n]*$/m.exec(plan.dockerfile)?.[0] ?? "";
    const withoutManifest = plan.dockerfile.replace(`${manifestLine}\n`, "");
    expect(withoutManifest).not.toBe(plan.dockerfile);
    const late = imagePlanLayersAreOrdered(
      withoutManifest.replace(/^COPY \. \.$/m, (m) => `${manifestLine}\n${m}`),
    );
    expect(late.ok).toBe(false);
    expect(late.problems.join("\n")).toMatch(/排在 `pnpm install` 之后/);
  });

  it("构建期自证与安装后核对读的是**同一份**四件清单", () => {
    const selfCheck = selfCheckRunLines().join("\n");
    const checks = checkCommands().join("\n");
    for (const item of IMAGE_CHECKS) {
      expect(selfCheck).toContain(item.name === "chrome-headless-shell" ? "test -x" : item.name);
      expect(checks).toContain(item.name === "chrome-headless-shell" ? "test -x" : item.name);
    }
    /* 浏览器那一件**不在 PATH 上**：写成 `command -v` 会永远找不到，而那种红
     * 读起来像「镜像里没装浏览器」。 */
    expect(selfCheck).not.toMatch(/command -v chrome-headless-shell/);
    expect(selfCheck).toContain("test -x /root/.cache/ms-playwright/");
  });

  it("镜像自己带上身份标识（与 `镜像身份` 那一档读的是同一个变量名）", () => {
    expect(plan.dockerfile).toContain("ENV COMFYAPP_NODE_IMAGE=comfyapp-ci:");
  });
});

describe("fetchNodePlan：现取而不是猜", () => {
  it("从 index.json 里挑出满足下限的那一版", async () => {
    const res = await fetchNodePlan({
      enginesRange: "^24.15.0",
      /* 只喂这一层真正会读的两格（`ok` / `json()`）：造一个完整的 `Response`
       * 会让这条判据测到 `fetch` 的形状而不是本层的解析。 */
      fetchImpl: /* SAFETY: 类型断言已复核 */ (async () => ({
        ok: true,
        json: async () => [
          { version: "v24.22.0", files: ["linux-x64"] },
          { version: "v24.1.0", files: ["linux-x64"] },
        ],
      })) as unknown as typeof fetch,
    });
    expect(res.version).toBe("v24.22.0");
    expect(res.floor).toEqual({ major: 24, minor: 15, patch: 0 });
  });

  it("取不到清单时说清是哪里、什么状态（别丢一句 undefined）", async () => {
    await expect(
      fetchNodePlan({
        enginesRange: "^24.15.0",
        fetchImpl: /* SAFETY: 类型断言已复核 */ (async () => ({
          ok: false,
          status: 404,
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("tarball：权限位、符号链接、可复现", () => {
  const src = path.join(TMP, "src");
  mkdirSync(path.join(src, "bin"), { recursive: true });
  mkdirSync(path.join(src, "sub"), { recursive: true });
  writeFileSync(path.join(src, "a.txt"), "hello");
  writeFileSync(path.join(src, "bin", "run.sh"), "#!/bin/sh\n");
  spawnSync("chmod", ["755", path.join(src, "bin", "run.sh")]);
  symlinkSync("../a.txt", path.join(src, "sub", "link"));

  const buf = buildTarStream({ root: src });
  const tarFile = path.join(TMP, "out.tar");
  writeFileSync(tarFile, buf);

  it("512 字节对齐，且两份输入打出来的字节完全相同", () => {
    expect(buf.length % 512).toBe(0);
    expect(tarballDigest(buildTarStream({ root: src }))).toBe(tarballDigest(buf));
  });

  /** mode 低 9 位 → tar 列里那 9 个字符（`0o755` → `rwxr-xr-x`）。 */
  const rwxField = (mode: number) =>
    [6, 3, 0]
      .map((s) => {
        const t = (mode >> s) & 7;
        return `${t & 4 ? "r" : "-"}${t & 2 ? "w" : "-"}${t & 1 ? "x" : "-"}`;
      })
      .join("");
  /* `tar -tvf` 的每行只按**第一格**与**行尾**取信息，不按列序号：GNU tar 把 uid/gid
   * 合成 `0/0`、Windows 自带的 bsdtar 分成两格，日期在中文 locale 下又是「1月 01 1970」
   * 三格 —— 原来那句 `split(/\s+/).slice(5)` 在 bsdtar 上整体错位，于是 `sub/link`
   * 明明在清单里（实测那行是 `lrwxrwxrwx … sub/link -> ..\a.txt`）却被数成 **0 条**
   * （CI `cnb-vue-1k59blt4c`：`expected +0 to be 1`）。第一格（类型 + mode）两种实现都在
   * 位置 0，名字在最后一个空格之后（链接条目再砍掉 ` -> 目标`），这两条跨实现都成立。 */
  const firstField = (line: string) => line.trim().split(/\s+/)[0] ?? "";
  const nameOf = (line: string) => {
    const head = (line.split(" -> ")[0] ?? "").trim();
    const parts = head.split(/\s+/);
    return parts.at(-1) ?? "";
  };
  const lineFor = (text: string, name: string) =>
    text.split(/\r?\n/).find((l) => nameOf(l) === name);

  /** 读这份 tarball 的清单：**相对路径 + `cwd`**，并且把「这台机器没有 tar」与
   *  「tar 在，却读不了这个包」分开。
   *
   * 两件都是实测撞出来的：
   *   · 传绝对路径时，Git 自带那份 GNU tar 会把 `C:\Users\…` 的冒号读成
   *     **远程语法**（`host:path`），直接 `tar: Cannot connect to C: resolve failed`
   *     退 **128**（本机现测）。而下面曾经只有一句 `if (status !== 0) return;` ——
   *     于是这一格在这台开发机上**从来没有判过任何东西**，绿与「判过了」逐字同形
   *     （§13.5.16 那条「红也 ≠ 跑过」的反面：**没跑也不红**）。CI 那台节点上是
   *     bsdtar、没有这个语法，所以同一条判据在两台机器上**一台判、一台不判**。
   *   · 「没有 tar」的证据是 `spawnSync` 的 `error`（ENOENT），不是退出码。
   *     拿退出码当「环境没有」的判据，就会把真故障一起吞掉。 */
  const listTar = () => {
    const list = spawnSync("tar", ["-tvf", path.basename(tarFile)], {
      cwd: TMP,
      encoding: "utf8",
    });
    if (list.error) {
      return null;
    } // 这台机器上确实没有 tar（极简容器）—— 那一档不在这里红
    expect(
      list.status,
      `tar 在盘上，却读不了这份包（退出码 ${list.status}）：` +
        String(list.stderr).trim().slice(0, 200),
    ).toBe(0);
    return list.stdout;
  };

  it("宿主 tar 认得它（权限位与符号链接都在）", () => {
    const text = listTar();
    if (text === null) {
      return;
    }
    /* 期望的 mode 来自**盘上那个文件本身**，不是写死的 `rwxr-xr-x`。
     * 这一格判的是「`buildTarStream` 有没有把 stat 里的 mode 原样带进 header」，
     * 而 Windows 上那句 `spawnSync("chmod", ["755", …])` 是一条不存在的命令 ——
     * 盘上就是 `0666`，于是写死的字面量把「宿主没有 exec 位」判成「打包丢了权限」
     * （CI 实测：`expected '-rw-rw-rw- …' to match /^-rwxr-xr-x .*bin\/run\.sh$/`）。
     * 换成按盘上事实比，两端判的是同一件事，而且比原来更严：header 与盘上不一致就红
     * （原来那句只认 755，把「在 Windows 上根本没法保权限」这件事一起误报进来了）。 */
    const onDisk = rwxField(statSync(path.join(src, "bin", "run.sh")).mode & 0o777);
    const runLine = lineFor(text, "bin/run.sh");
    expect(runLine, "tar 清单里没有 `bin/run.sh` 这一条").toBeDefined();
    expect(firstField(runLine ?? "")).toBe(`-${onDisk}`);
    const linkLine = lineFor(text, "sub/link");
    expect(linkLine, "tar 清单里没有 `sub/link` 这一条（链接被打成了普通文件？）").toBeDefined();
    /* 类型位必须是 `l`，目标必须是那个**相对**路径。分隔符与重复斜杠都归一再比 ——
     * 三种宿主给的字面量实测不一样：bsdtar 给 `..\a.txt`、Git 的 GNU tar 给
     * `..//a.txt`、POSIX 的 tar 给 `../a.txt`，而这一格要判的从来是
     * 「链的是同目录上层的 `a.txt`」，不是某一种转写形状。 */
    expect(firstField(linkLine ?? "")).toMatch(/^l/);
    const target = (linkLine ?? "").split(" -> ")[1] ?? "";
    expect(target.replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/")).toBe("../a.txt");
  });

  it("不穿符号链接（链接的目标不被打成第二份内容）", () => {
    const text = listTar();
    if (text === null) {
      return;
    }
    const names = text.trim().split(/\r?\n/).map(nameOf);
    expect(names.filter((n) => n === "sub/link").length).toBe(1);
    expect(names).toContain("a.txt");
  });
});

describe("main：缺版本时不猜", () => {
  it("没给 node 版本就抛（而不是退回一个缺省值）", () => {
    const silent = () => undefined;
    expect(() => main({ log: silent })).toThrow(/没有拿到精确的 Node 补丁号/);
  });

  it("给了版本时把三条命令都打出来（造镜像 / 装机 / 钉身份）", () => {
    const lines: Array<string> = [];
    const out = main({
      log: (l) => lines.push(l),
      nodeVersion: "v24.22.0",
      facts: {
        enginesRange: "^24.15.0",
        pnpmVersion: "12.4.1",
        npmVersions: {},
        missingNpm: [],
        pythonTooling: [],
      },
    });
    const text = lines.join("\n");
    expect(text).toContain("docker build");
    expect(text).toContain("docker save");
    expect(text).toContain("docker cp");
    expect(text).toContain("COMFYAPP_NODE_IMAGE");
    expect(out.dockerfile).toContain("FROM node:24-bookworm");
  });
});

describe("造镜像那条命令：`-f -` 而不是 `-f <(...)`", () => {
  /* 进程替换是 POSIX shell 的语法：PowerShell / cmd 上 `-f <(...)` 会被当成一个叫
   * `<` 的文件，报「The system cannot find the file specified」—— 那条红读起来像
   * 「脚本没产出文件」，于是人回头去查脚本。判断据只看命令的**形状**。 */
  const plan = imagePlan({ nodeVersion: "v24.22.0", pnpmVersion: "12.4.1" });

  it("不吃进程替换（`<(` 在 Windows 的两个 shell 里都不是语法）", () => {
    expect(plan.build).not.toContain("<(");
    expect(plan.build).not.toContain(">(");
  });

  it("用管道把 stdin 交给 `-f -`（POSIX shell 与 PowerShell 7 同一个写法）", () => {
    expect(plan.build).toMatch(/-f - /);
    expect(plan.build).toContain("ci-image-plan.mjs --dockerfile");
  });

  it("正文与管道给的必须是同一份（口径别在命令里漂）", () => {
    /* 命令里现读的 Node 版本要出现两次：给生成器一次、给 `--build-arg` 一次 ——
     * 少一处就会出现「镜像里是 A、声明是 B」而日志两边都像成功。 */
    expect(plan.build.match(/v24\.22\.0/g)).toHaveLength(2);
  });
});

describe("`--dockerfile` 的正文里自带一条「落盘版是 --write」", () => {
  /* 那一格是人真撞上过的：敲完 `--dockerfile` 去 `ls docker`，得到「没有这个文件」，
   * 然后怀疑脚本坏了。提示放在**正文的 `#` 注释**里 —— Dockerfile 自己的注释语法，
   * 于是 `| docker build -f -` 当注释忽略它、`> docker/ci-node.Dockerfile` 让它成为
   * 文件头的一条说明，两种消费方式都不受伤。 */
  const plan = imagePlan({ nodeVersion: "v24.22.0", pnpmVersion: "12.4.1" });

  it("点得出 `--write` 与「管道别用 <(...)」两条出路", () => {
    const hint = dockerfileHint().join("\n");
    expect(hint).toContain("--write");
    expect(hint).toContain("stdin");
    expect(hint).toContain("<(");
  });

  it("明说它只打 stdout、不写文件（这是人撞上的那一格）", () => {
    expect(plan.dockerfile).toContain("不写文件");
  });

  it("提示是 `#` 注释行，`docker build -f -` 吃下去不会当成指令", () => {
    const lines = plan.dockerfile.split("\n");
    const hintAt = lines.findIndex((l) => l.includes("不写文件"));
    expect(hintAt).toBeGreaterThan(-1);
    for (const line of lines.slice(0, hintAt + 4)) {
      if (line === "") {
        continue;
      }
      expect(line.startsWith("#")).toBe(true);
    }
  });

  it("提示排在第一条指令之前（`FROM` 之前不许有非注释行）", () => {
    const lines = plan.dockerfile.split("\n");
    const fromAt = lines.findIndex((l) => l.startsWith("FROM "));
    const hintAt = lines.findIndex((l) => l.includes("不写文件"));
    expect(fromAt).toBeGreaterThan(hintAt);
  });

  it("`--dockerfile` 的 stdout 就是这份正文（提示别跑去看 stderr）", () => {
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts", "ci-image-plan.mjs"),
        "--dockerfile",
        "--node-version",
        "v24.22.0",
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith("#")).toBe(true);
    expect(r.stdout).toContain("FROM node:24-bookworm");
    expect(r.stdout).toContain("--write");
    expect(r.stderr).toBe("");
  });
});

describe("接线：入口在盘上、被直接执行时退非零会传出去", () => {
  it("缺 node 版本时 CLI 退非零并说得出原因", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "ci-image-plan.mjs")], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    });
    /* 不带 `--node-version` 且不联网时，它必须**红**：一声不吭地猜一个版本，
     * 会让镜像与 `engines.node` 各走各的而谁也没报错。 */
    if (r.status === 0) {
      /* 例外只有一条：能联网时它现取了一版（那是设计内的另一条路）。 */
      expect(r.stdout).toContain("docker build");
      return;
    }
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/ci-image-plan/);
  });

  it("`--dockerfile --node-version` 只打正文（供 `docker build -f -`）", () => {
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts", "ci-image-plan.mjs"),
        "--dockerfile",
        "--node-version",
        "v24.22.0",
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith("#")).toBe(true);
    expect(r.stdout).toContain("FROM node:24-bookworm");
    expect(r.stdout).not.toContain("docker build");
  });

  it("本文件不在 `src/**` 里，也不该 import 任何仓库内模块（构建期第一步要能跑）", () => {
    const text = readFileSync(path.join(ROOT, "scripts", "ci-image-plan.mjs"), "utf8");
    const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) =>
      String(m[1] ?? ""),
    );
    expect(imports.every((s) => s.startsWith("node:"))).toBe(true);
  });
});
