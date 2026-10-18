/**
 * 「让一台裸节点**一次装齐**」的那一份可执行计划（ISSUE #1993 的续：用 docker 提速）。
 *
 * ## 它要回答的那一格
 *
 * 自托管节点上没有 docker daemon，`.cnb.yml` 里没有、也不该有 `image:` —— 任务级
 * `image:` 同样会红在 `Runner does not enable Docker` 上（70ms，§13.5.3.4.1.3）。
 * 于是「节点上该有什么」这件事只剩一条路：**把节点预装成一张镜像**，代价逐条量过
 * （§13.5.3.5 与 §13.5.3.10 的读数）：
 *
 *   · Python 三条装通道挨个试，而**唯一真跑通过的那条**（官方 embed 包）是
 *     `downloadFile()` → 解压 → 复验，每次首跑都重走一遍；
 *   · Playwright 的浏览器 ~120 MiB，**这台节点的链路一次取不完一个大响应**
 *     （七跑的读数：0 字节 + 120s 超时），仓库侧为此写了分片续传那条通道；
 *   · `pnpm install` 冷装约 8 分钟（AGENTS 硬规则 26），`node_modules` 又**不能跟着
 *     检出走**（`.gitignore` 里，且原生模块与平台绑定）。
 *
 * **这三件都是「换台机器就要重来一遍」的东西，而且每次重来的结果都依赖那台机器的
 * 网络。** 把它们预先装进一张镜像，就是本 ISS usue 要的那条提速路径。
 *
 * ## 边界：本文件**不碰 docker**
 *
 * 它只**算出**三条命令（人复制粘贴执行）：镜像是人装机的产物，不是仓库的产物 ——
 * 与 `ci-image-identity.mjs` 同一条分工（那边读「这台机长自哪一版」，这边给「怎么造出
 * 那一版」）。三个理由，每条都能独立成立：
 *
 * 1. **构建容器里没有 docker**（规范 §13.5.3.4.1 已写死）：本文件跑在流水线里时
 *    起不了任何容器，写 `spawn("docker", …)` 只会得到一条看不懂的红；
 * 2. **造镜像需要网络**，而本仓的判据一律**不出网**（`pnpm test` 在离线容器里也要绿）：
 *    所以这里量的是「镜子照见的清单对不对」，不是「那台机通不通」；
 * 3. **判据要能在本机跑**：三条命令的形状（层序、版本现读、逐件核对）与磁盘上四处的
 *    真相（根目录 `package.json` / `pyproject.toml` / `npm-shrinkwrap.json`）在本地
 *    全部可判 —— 那才是这一层能长判据的部分。
 *
 * ## 「提速」提速在哪，以及**它不能**提速什么
 *
 * 进镜像的是三层：系统包（Python + curl/tar/xz）→ 固定的 Node 与 pnpm → **依赖与
 * 浏览器**。第 1、2 层是秒级的 `apt-get install` / 解包，而第 3 层是那 8 分钟 +
 * 120 MiB + 三条 Python 通道 —— **省下来的是第 3 层**，不是「所有东西」。
 *
 * 能拿到的是「一次装齐」；**拿不到**的是 `next build`、`vitest`、Playwright 跑用例与
 * `cargo build` 的墙钟 —— 它们依赖当次源码，任何预装都替不掉。这一点必须先说清：
 * 把一个仓库**检出**烤进镜像，只会让「这一跑跑的是哪份源码」变得不可追（`镜像身份`
 * 那一档之所以存在，正是为了让环境**可见**）。
 *
 * ## 为什么提交点和这四件必须成对
 *
 * 层序 `系统 → Node/pnpm → 四件 → playwright install` 不是风格：Docker 的层缓存是
 * 「某一层没变，它和它之前的层全部复用」。**提交点写偏一层**（比如放在 `pnpm install`
 * 之前）会让 `COPY` 一改就重跑安装 —— 那正是这个文件要买的东西被悄悄退回去的形态，
 * 而它不会报错、只会慢。
 *
 * ## 版本号一律**现读**，不在这里写死
 *
 * `engines.node` 的下限、`packageManager` 的 pnpm 版本、那四件的 npm 包名与版本，全从
 * 磁盘上的真相取；Node 的精确补丁号与它的 SHA256SUMS 由**镜像构建的那一步**从
 * `cdn.npmmirror.com` 现取（`fetchNodePlan()`）。写死两份的形态是「上游一升，这里还
 * 指着一个已经不存在（或更糟：还存在但已过时）的版本」—— 而那两种在日志里长得一样。
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** 仓库根 —— 本脚本住在 `scripts/` 下。 */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** 镜像标签的**版本**部分。它不是「本仓的版本号」，是「这份声明长自哪一版源码」的锚。 */
export const IMAGE_TAG = "ci-node-v1";

/**
 * Node 补丁号的来源（`index.json` 列出每个版本与它有哪些产物）。
 *
 * 用 npmmirror 与 `.cnb.yml` 的 `PLAYWRIGHT_DOWNLOAD_HOST` 同一个理由：这台节点的链路
 * 对 `cdn.playwright.dev` 那一族取不回大 body（七跑读数），而 `binaries/node` 这段路径
 * 在这台节点上是好的（实测 `index.json` 与 tar.xz 都取得到）。
 */
export const NODE_INDEX_URL = "https://cdn.npmmirror.com/binaries/node/index.json";

/** 镜像里的工作目录（`COPY` 的目标，也是 `pnpm install` 的 cwd）。 */
export const APP_DIR = "/app";

/**
 * 镜像里**必须存在**的四件（缺一件，流水线就会在某个看不懂的位置红）。
 *
 * 这四条不是「我们装了什么」的复述 —— 它们各自对应一条已经红过的判据：
 * `python3` ↔ `ci-toolchain-selfcheck` 的 `findPython`（缺件时假 comfy-cli 起不来）、
 * `node` ↔ `engines.node`、`pnpm` ↔ `check-pnpm-available.mjs`（三种落盘形态里只有
 * 一种 Node 起得来，见 §2.1.1）、浏览器 ↔ `browserExecutableExists()` 的落点。
 *
 * `kind` 决定「怎么验」：`command` 走 PATH，`file` 走绝对路径（Playwright 的浏览器
 * 不在 PATH 上，它按落点找）。
 */
export const IMAGE_CHECKS = [
  {
    name: "python3",
    kind: "command",
    /* 打印版本：它是「装上了」与「装了假的」之间唯一读得出来的差别（Store 占位别名
     * 在盘上、`--version` 非零退出，与「压根没装」逐字同形，见 §13.5.3.5.1）。 */
    arg: "--version",
    why: "假 comfy-cli 是 Python 包；缺件时 e2e 的 @critical 会以「执行器收口失败」红",
  },
  {
    name: "node",
    kind: "command",
    arg: "--version",
    why: "engines.node 的上下限都靠它答，缺件时后面每一步都跑不起来",
  },
  {
    name: "pnpm",
    kind: "command",
    arg: "--version",
    why: "corepack 摆在盘上的 pnpm 有三个形态、Node 只起得来其中一个（§2.1.1）",
  },
  {
    name: "chrome-headless-shell",
    kind: "file",
    arg: "/root/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
    why: "E2E 真启动的就是它；它只可能来自 playwright install 这一条命令",
  },
];

/**
 * 「哪四件进依赖层」—— 由**仓库自己的清单**决定，不在这里另开一张。
 *
 * npm 那两件是 devDependencies 里的**直接依赖**（`@playwright/test` 供 CLI，
 * `drizzle-kit` 供 `pnpm db:push`，而 `同步数据库表结构` 是流水线上的一步）；
 * Python 那两件是假 comfy-cli 那个包的依赖（E2E `@critical` 起执行器要用）。
 */
export const NPM_TOOLING = ["@playwright/test", "drizzle-kit"];
/** Python 侧那两件（`pyproject.toml` 与 e2e 夹具是这么写的）。 */
export const PYTHON_TOOLING = ["comfy-cli", "aiohttp"];

/**
 * `engines.node` 的**下限**（`^24.15.0 || >=26.0.0` 里最小的那一个）。
 *
 * 只取 caret / `>=` 两档的下限：它们就是这个字段表达的全部意思（「不低于」）。
 * 认不出的形态直接给出那句原文，而不是退回一个缺省值 —— 一个悄悄生效的缺省版本
 * 会让镜像与 `engines.node` 各走各的，而两者都在盘上、谁也没报错。
 *
 * @param {string} range
 * @returns {{major: number, minor: number, patch: number}}
 */
export function nodeFloor(range) {
  const floors = [
    ...String(range ?? "").matchAll(/\^(\d+)\.(\d+)\.(\d+)|>=(\d+)\.(\d+)\.(\d+)/g),
  ].map((m) => ({
    major: Number(m[1] ?? m[4]),
    minor: Number(m[2] ?? m[5]),
    patch: Number(m[3] ?? m[6]),
  }));
  if (floors.length === 0) {
    throw new Error(
      `engines.node 认不出下限（原文：${JSON.stringify(range)}）——` +
        "本脚本只认 ^X.Y.Z 与 >=X.Y.Z 两档，别让它退回一个猜出来的版本",
    );
  }
  return /** @type {{major: number, minor: number, patch: number}} */ (
    floors.sort(
      (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch,
    )[0]
  );
}

/**
 * 在 `index.json` 那份清单里挑**满足下限的最新一版**。
 *
 * 只看 `linux-x64` 这个产物：镜像是 Linux 的，而「这个版本有没有我们下得下来的产物」
 * 在别的平台上没有意义（`browsers.json` 与小版本号那一族教训同源）。
 *
 * @param {{version: string, files?: string[]}[]} index
 * @param {{major: number, minor: number, patch: number}} floor
 * @returns {string}
 */
export function pickNodeVersion(index, floor) {
  /** @type {{version: string, parts: [number, number, number]}[]} */
  const parsed = [];
  for (const entry of index ?? []) {
    if (!(entry.files ?? []).includes("linux-x64")) continue;
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(entry.version);
    if (!m) continue;
    parsed.push({
      version: entry.version,
      parts: [Number(m[1]), Number(m[2]), Number(m[3])],
    });
  }
  const ok = parsed
    .filter(({ parts }) => {
      const [maj, min, pat] = parts;
      return (
        maj > floor.major ||
        (maj === floor.major && min > floor.minor) ||
        (maj === floor.major && min === floor.minor && pat >= floor.patch)
      );
    })
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  if (ok.length === 0) {
    throw new Error(
      `清单里没有满足下限 v${floor.major}.${floor.minor}.${floor.patch} 的 linux-x64 版本` +
        "（要么清单变了形状，要么这台机器取到的是别人的 index）",
    );
  }
  return /** @type {{version: string}} */ (ok[0]).version;
}

/** 把一段字面量转成「按字面匹配」的正则片段（`.cjs`/`.mjs` 里同名实现的同一手法）。 */
export function escapedRegExp(/** @type {string} */ name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 那两件 npm 工具**实际会落到镜像里的版本**（`pnpm-lock.yaml` 里**根 importer** 的那一段）。
 *
 * 为什么读锁文件而不是 `package.json`：`package.json` 写的是范围（`^1.63.0`），
 * 而镜像里装出来的是锁文件钉的那一版。用范围去核对镜像里装的是什么，会在上游发新版
 * 之后与镜像里的实际内容悄悄分叉 —— 两份都「对」，但它们说的不是同一件事。
 *
 * 两条边界都是实测咬出来的（不是风格）：
 *
 *   · **取最后一个 `importers:` 段**。本仓的锁文件里它出现两次（第一段只带
 *     `packageManagerDependencies`、第二段才是真正的 importer 表），取第一个会得到
 *     「找不到这两件」—— 而那句话与「本仓真的没有这两个依赖」逐字同形。
 *   · **按缩进认段落名**。包名那一行比 `specifier` / `version` 浅一层，用「全文件搜
 *     `version:`」会在 `packages:` 那一段先命中别的包 —— 于是版本读成了别人的，
 *     而日志两边都像成功（这是 `drizzle-kit` 与 `drizzle-orm` 那一对最容易长出来的形态）。
 *
 * @param {string} lockText
 * @param {string[]} names
 * @returns {Record<string, string>}
 */
export function toolingVersionsFromLock(lockText, names) {
  const out = /** @type {Record<string, string>} */ ({});
  const lines = String(lockText ?? "").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "importers:") starts.push(i);
  }
  if (starts.length === 0) return out;
  const from = /** @type {number} */ (starts[starts.length - 1]);
  const block = [];
  for (let i = from + 1; i < lines.length; i++) {
    /* 顶格的行 = 又一个顶层键（`packages:` / `settings:` / `snapshots:`）。 */
    const line = String(lines[i] ?? "");
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  const text = block.join("\n");
  for (const name of names) {
    /* ⚠️ 不要用 `new RegExp` 拼这一条：`escaped` 里的反斜杠会在字符串层面被再吃一层，
     * 拼出来的 `( +)` 变成 `( ?)`、捕获组随之错位 —— 那一档的表现是「有的包读得到、
     * 有的读不到」，而两种在日志里都像「本仓没有这个依赖」（实测踩过）。 */
    const re = new RegExp(
      "^( +)['\"]?" +
        escapedRegExp(name) +
        "['\"]?:\\s*\\n(?:\\1\\s+.*\\n)*?\\1\\s+version:\\s*([^\\s(]+)",
      "m",
    );
    const m = re.exec(text);
    if (m) out[name] = /** @type {string} */ (m[2]);
  }
  return out;
}

/**
 * 组装**那三条命令**（人复制粘贴执行，本文件不碰 docker）。
 *
 * @param {{
 *   nodeVersion: string,
 *   pnpmVersion: string,
 *   tag?: string,
 *   appDir?: string,
 * }} input
 * @returns {{tag: string, dockerfile: string, build: string, cp: string, verify: string}}
 */
export function imagePlan({
  nodeVersion,
  pnpmVersion,
  tag = IMAGE_TAG,
  appDir = APP_DIR,
}) {
  if (!/^v\d+\.\d+\.\d+$/.test(nodeVersion ?? "")) {
    throw new Error(
      `node 版本要带 v 的精确号（拿到的是 ${JSON.stringify(nodeVersion)}）`,
    );
  }
  if (!/^\d+\.\d+\.\d+/.test(pnpmVersion ?? "")) {
    throw new Error(
      `pnpm 版本形状不认（拿到的是 ${JSON.stringify(pnpmVersion)}）`,
    );
  }
  const image = `comfyapp-ci:${tag}`;
  const header = [
    `# 由 node scripts/ci-image-plan.mjs 生成 —— 别手改这份文件：`,
    `# 版本号全部现读（engines.node / packageManager / pnpm-lock.yaml），改哪一件都回这里重跑。`,
    `# 文档：docs/guides/ci-node-image.md（口径见规范 §13.5.3.4.1.2）`,
    ...[...dockerfileHint(), ""],
  ];
  const lines = [
    ...header,
    "FROM node:24-bookworm",
    "",
    /* 第 1 层：系统包。`python3` 是那四件之一（假 comfy-cli 要它）；`curl`/`xz` 是
     * 拉 Node 就需要的；`tar` 自带但显式写上 —— 这一层将来有人改成 alpine 时，
     * 少一件的形态是「构建到一半 bash: curl: not found」，而那报错指不到这里。 */
    "RUN apt-get update \\",
    " && apt-get install -y --no-install-recommends python3 curl ca-certificates xz-utils \\",
    " && rm -rf /var/lib/apt/lists/*",
    "",
    /* 第 2 层：固定的 Node（**不用 `node:24` 镜像自带的那一个**）与 pnpm。
     * 自带那个的版本随 `node:24` 标签漂移，而 `工具链自证` 判的是 `engines.node` ——
     * 让镜像自己去满足它，比「等标签挪到合规版本」可靠。
     * SHA256SUMS 与官方安装脚本同源（同一次下载里核对），不在这里抄一份哈希。 */
    `ARG NODE_VERSION=${nodeVersion}`,
    "RUN cd /tmp \\",
    " && curl -fsSLO https://cdn.npmmirror.com/binaries/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz \\",
    " && curl -fsSLO https://cdn.npmmirror.com/binaries/node/${NODE_VERSION}/SHASUMS256.txt \\",
    " && grep \" node-${NODE_VERSION}-linux-x64.tar.xz$\" SHASUMS256.txt | sha256sum -c - \\",
    " && tar -xJf node-${NODE_VERSION}-linux-x64.tar.xz -C /usr/local --strip-components=1 \\",
    " && rm -f node-${NODE_VERSION}-linux-x64.tar.xz SHASUMS256.txt",
    `RUN npm install -g pnpm@${pnpmVersion} && pnpm --version`,
    "",
    /* 第 3 层：**依赖与浏览器** —— 这一层才是「省下来的那 8 分钟 + 120 MiB」。
     *
     * 层序的判据：`COPY` 两个清单 → 安装 → 再 `COPY` 源码。这样改一行业务代码**不会**
     * 让安装层失效（判据见 `imagePlanLayersAreOrdered()`）。 */
    `WORKDIR ${appDir}`,
    "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./",
    "RUN pnpm install --frozen-lockfile --ignore-scripts \\",
    " && pnpm store prune",
    `RUN pnpm exec playwright install --with-deps chromium-headless-shell`,
    "COPY . .",
    "",
    /* 构建期自证：镜像自己是**能起来**的，不是「装的时候看起来装上了」。
     * 这一句与流水线的 `工具链自证` 判的是同一件事（四件），只是提前到了构建时 ——
     * 不等于第二条判据源，它是同一件事的更早发现点（与「装完必须复验」同口径）。
     * 四件的清单只有一处出处（`IMAGE_CHECKS`）：**构建期自证**与**装之后逐件核对**
     * （`--checks`）读的是同一份，漂了就是两处各说各话。 */
    ...selfCheckRunLines(),
    "",
    `ENV COMFYAPP_NODE_IMAGE=${image}`,
    `LABEL org.opencontainers.image.title=${image}`,
  ];
  return {
    tag: image,
    dockerfile: lines.join("\n") + "\n",
    /* `-f -` 而不是 `-f <(...)`：进程替换是 POSIX shell 的语法，PowerShell 里
     * `-f <(...)` 会被当成一个叫 `<` 的文件、报「The system cannot find the file
     * specified」—— 那条红读起来像「脚本没产出文件」，实际是这两句根本不是同一件事。
     * 管道喂 stdin 在 POSIX shell 与 PowerShell 7 里同一个写法，而 Windows 上的
     * `docker build … .` 照抄就能跑（本仓三台构建节点里 Windows 是主战场）。 */
    build: `node scripts/ci-image-plan.mjs --dockerfile --node-version ${nodeVersion} | docker build --build-arg NODE_VERSION=${nodeVersion} -t ${image} -f - .`,
    cp: cpCommand(tag),
    verify: `node scripts/ci-image-plan.mjs --verify`,
  };
}

/**
 * 构建期那一条**自证**（四件的清单见 `IMAGE_CHECKS`）。
 *
 * 三件 `command` 走 PATH、浏览器那一件走绝对路径 —— 后者**不在 PATH 上**，按名字
 * `command -v` 找它永远找不到，而那种红读起来像「镜像里没装浏览器」。
 *
 * @returns {string[]}
 */
export function selfCheckRunLines() {
  const parts = IMAGE_CHECKS.map((c) =>
    c.kind === "command" ? `${c.name} ${c.arg}` : `test -x ${c.arg}`,
  );
  return ["RUN " + parts.join(" \\\n && ")];
}

/**
 * 「装完之后逐件核对」的那几条命令（`--checks` 打出来、人复制到宿主上跑）。
 *
 * 与 {@link selfCheckRunLines} 是**同一份清单的两个出口**：镜像里自证「装的时候装上了」，
 * 装上宿主之后还要回答「**这台机器**上现在有没有」—— 后者不成立时，前者的绿一点意义
 * 都没有（`playwright install` 退 0 而东西没落地那一档就是这么来的）。
 *
 * @returns {string[]}
 */
export function checkCommands() {
  return IMAGE_CHECKS.map((c) =>
    c.kind === "command"
      ? `${c.name} ${c.arg}`
      : `test -x ${c.arg.split("*")[0]}*`.replace("*", ""),
  );
}

/**
 * 「装进宿主机」那一条命令。
 *
 * `docker cp` 比 `docker run --volume` 安全一档：它**不挂载宿主机目录**，容器里那份
 * 只读副本被拷出来，四件落点由 `--checks` 报出的绝对路径决定（见下）。
 *
 * @param {string} tag
 */
export function cpCommand(tag) {
  return `docker create --name comfyapp-ci-${tag} comfyapp-ci:${tag} true \\
 && docker cp comfyapp-ci-${tag}:/ — > /tmp/comfyapp-ci-rootfs.tar \\
 && docker rm -f comfyapp-ci-${tag}`;
}

/**
 * 人手动敲 `--dockerfile` 时**往 stdout 的注释行**里提一句「落盘版是另一个 flag」。
 *
 * 为什么是 stdout 的 `#` 注释而不是 stderr：Dockerfile 自己的注释语法就是 `# 一行`，
 * 所以**两种消费方式都不受伤** —— `| docker build -f -` 把它当注释忽略、`> docker/
 * ci-node.Dockerfile` 让它成为文件头的一条说明。而 stderr 有两个坑：不重定向时
 * 它会和 `|` 那半个管道抢终端（PowerShell 5.1 的表现是人的输出变乱），
 * 而 `2>` 了它的人什么也看不到 —— 提示跑去看 who 的 stderr，等于换了个地方继续缺。
 *
 * 它补的那一格：`--dockerfile` 只把正文打到 stdout（给管道用），不写文件。而「只看
 * 一眼」与「想要一份文件」在人脑子里是同一件事 —— 照文档敲完 `ls docker` 的人会得到
 * 一句「没有这个文件」，然后怀疑脚本坏了（这条弯路已经有人走过一次）。
 *
 * 两个边界都是刻意的：
 *
 *   · **只用 `#` 注释、只排在第一条指令之前**：`FROM` 之前出现一行非注释，Dockerfile
 *     就废了 —— 而那份红会指到 `docker build`，不会指到这里（`tests/ci-image-plan.test.ts`
 *     有一条专门判这个形状）。
 *   · **它不改变任何行为**：提示不是判据，也不替代 `--write`。
 *
 * @returns {string[]}
 */
export function dockerfileHint() {
  return [
    "# ── 这份正文只打到 stdout、**不写文件** ──",
    "# 想落盘：node scripts/ci-image-plan.mjs --write --node-version <vX.Y.Z>",
    "#   （写出 docker/ci-node.Dockerfile；它是一次性构建输入，别提交进仓库）",
    "# 想造镜像：本命令加 --dockerfile 后整条喂给 docker 的 stdin 构建（指南 §2 有整行）",
    "#   （别写 -f <(...)：进程替换是 POSIX shell 的语法，Windows 上会报「找不到文件」）",
  ];
}

/**
 * 层序判据：`COPY` 两个清单必须排在 `pnpm install` **之前**，源码的 `COPY . .`
 * 必须排在它**之后**。
 *
 * 为什么要有这条：提交点写偏一层是这个文件里**唯一不会报错**的错误 —— 它只让构建变慢，
 * 而慢的那部分恰好是「人以为已经省掉」的那部分。判据只能看**文本里的顺序**（本文件
 * 不跑 docker），但那就是这件事的全部形状。
 *
 * @param {string} dockerfile
 * @returns {{ok: boolean, problems: string[]}}
 */
export function imagePlanLayersAreOrdered(dockerfile) {
  const text = String(dockerfile ?? "");
  const at = (/** @type {RegExp} */ re) => text.search(re);
  const problems = [];
  /* `(?!\.)` 不是装饰：`COPY . .` 也满足「以 `COPY ` 开头、第 2 个词不以点开头」这类
   * 松散的写法，于是「清单那一行在哪」会被源码那一行顶掉 —— 判据在原地**恒绿**
   * （实测：反向复算里删掉清单 COPY，它照旧报「层序没问题」）。 */
  const copyManifests = at(/^COPY (?!\.)package\.json\b.*$/m);
  const install = at(/^RUN pnpm install/m);
  const copyAll = at(/^COPY \. \./m);
  const playwright = at(/^RUN .*playwright install/m);
  if (copyManifests < 0) problems.push("没有 `COPY package.json …` 那一行（依赖层没有输入）");
  if (install < 0) problems.push("没有 `RUN pnpm install --frozen-lockfile` 那一行");
  if (copyAll < 0) problems.push("没有 `COPY . .` 那一行（源码进不去）");
  if (copyManifests >= 0 && install >= 0 && copyManifests > install) {
    problems.push(
      "`COPY package.json …` 排在 `pnpm install` 之后 —— 依赖层因此永远拿不到输入，" +
        "每次构建都要重装（这正是这个文件要买的东西被退回去的形态，而它不报错）",
    );
  }
  if (install >= 0 && copyAll >= 0 && copyAll < install) {
    problems.push(
      "`COPY . .` 排在 `pnpm install` 之前 —— 改一行业务代码就会让依赖层失效（丢掉层缓存）",
    );
  }
  if (install >= 0 && playwright >= 0 && playwright < install) {
    problems.push("`playwright install` 排在 `pnpm install` 之前 —— 它要的那个 CLI 还没装");
  }
  return { ok: problems.length === 0, problems };
}

/* ────────────────────────── Node 版本：现取 ────────────────────────── */

/**
 * 从镜像源取 `index.json`，挑出满足 `engines.node` 下限的最新 linux-x64 一版。
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   enginesRange: string,
 *   indexUrl?: string,
 * }} input
 * @returns {Promise<{version: string, floor: {major: number, minor: number, patch: number}}>}
 */
export async function fetchNodePlan({
  fetchImpl = globalThis.fetch,
  enginesRange,
  indexUrl = NODE_INDEX_URL,
}) {
  const floor = nodeFloor(enginesRange);
  const res = await fetchImpl(indexUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `取不到 Node 版本清单（${indexUrl} → HTTP ${res.status}）—— ` +
        "这一步要在构建那台机器上跑，链路的读数见 docs/guides/ci-node-image.md",
    );
  }
  const index = await res.json();
  return { version: pickNodeVersion(index, floor), floor };
}

/* ────────────────────────── tarball：换台机器装进去 ────────────────────────── */

/**
 * 把一棵目录打成 tar（**不押宿主 `tar` 的行为**）。
 *
 * 三件事决定了它不能是 `tar -cf`：
 *
 * 1. **权限位**：宿主上拷下来的可执行文件（`chrome-headless-shell`）必须带着 `0755`
 *    落进去。少了它，容器里 `EACCES`、报错指不到这一层（`ci-toolchain-browser-seed`
 *    那一格的姊妹形态）。
 * 2. **符号链接**：`node_modules/.bin` 全是符号链接。递归**不穿**它们（穿链接会把
 *    同一份内容打很多遍、并在 POSIX 上把链指向的目标内容当真），链接本身按
 *    `symlink` 条目写进去。
 * 3. **可复现**：`mtime` / uid / gid 一律归零 —— 同一份输入打出来的字节**逐字节相同**，
 *    于是它自己也能被 sha256 钉住（`tarballDigest()`）。
 *
 * ustar 形状（前缀 + 名字两段各 <256 字节）对本档够用：最深的路径是
 * `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/...`，远小于那个界。
 *
 * @param {{
 *   root: string,
 *   list?: (dir: string) => {name: string, isFile: () => boolean, isDirectory: () => boolean, isSymbolicLink: () => boolean}[],
 *   readlink?: (p: string) => string,
 *   stat?: (p: string) => {mode: number, size: number},
 *   readFile?: (p: string) => Buffer,
 * }} input
 * @returns {Buffer}
 */
export function buildTarStream({
  root,
  list = (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isFile: () => e.isFile(),
      isDirectory: () => e.isDirectory(),
      isSymbolicLink: () => e.isSymbolicLink(),
    })),
  readlink = (p) => readlinkSync(p),
  stat = (p) => statSync(p),
  readFile = (p) => readFileSync(p),
}) {
  const blocks = [];
  const walk = (/** @type {string} */ dir, /** @type {string} */ rel) => {
    for (const entry of list(dir)) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        blocks.push(tarHeader(`${relPath}/`, "5", 0o755, 0, ""));
        walk(abs, relPath);
      } else if (entry.isSymbolicLink()) {
        const target = readlink(abs);
        blocks.push(tarHeader(relPath, "2", 0o777, 0, target));
      } else if (entry.isFile()) {
        const content = /** @type {Buffer} */ (readFile(abs));
        const mode = (stat(abs).mode & 0o777) | 0o600;
        blocks.push(tarHeader(relPath, "0", mode, content.length, ""));
        blocks.push(pad512(content));
      }
    }
  };
  walk(root, "");
  /* 两段全零块收尾（POSIX 的归档结束标记）—— 少了它 GNU tar 会报
   * `A lone zero block at …`，而那条警告在很多脚本里被当成失败。 */
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** 一个 ustar 头部块（512 字节）。数值字段用八进制、尾随 NUL + 空格。 */
export function tarHeader(/** @type {string} */ name, /** @type {string} */ type, /** @type {number} */ mode, /** @type {number} */ size, /** @type {string} */ linkname) {
  const head = Buffer.alloc(512);
  const put = (/** @type {string} */ text, /** @type {number} */ offset, /** @type {number} */ length) => {
    Buffer.from(text, "utf8").copy(head, offset, 0, length);
  };
  const num = (/** @type {number} */ value, /** @type {number} */ offset, /** @type {number} */ length) => {
    /* `length - 1` 位八进制 + 尾随 NUL：ustar 的数值字段是「定宽、右补零、以 NUL 收尾」。 */
    put(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
  };
  put(name.slice(0, 100), 0, 100);
  num(mode, 100, 8);
  num(0, 108, 8); // uid
  num(0, 116, 8); // gid
  num(size, 124, 12);
  num(0, 136, 12); // mtime —— 归零是可复现性的前提
  put("        ", 148, 8); // 校验和占位（8 个空格），下面重算
  put(type, 156, 1);
  put(linkname.slice(0, 100), 157, 100);
  put("ustar\0" + "00", 257, 8);
  /* 校验和 = 头部全部字节（校验和字段按 8 个空格算）之和。 */
  let sum = 0;
  for (const byte of head) sum += byte;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return head;
}

/** 把内容补到 512 的整数倍。 */
function pad512(/** @type {Buffer} */ content) {
  const rem = content.length % 512;
  if (rem === 0) return content;
  return Buffer.concat([content, Buffer.alloc(512 - rem)]);
}

/**
 * 一份 tar 的 sha256 —— 它把「这一份装进去的东西」变成一句可核对的话。
 *
 * 与 `镜像身份` 那条口径同源：标签会被移动，digest 不会。打出来的 tar 带
 * `mtime/uid/gid = 0`，所以同一份输入两次打包**逐字节相同**（`buildTarStream` 的头注）。
 *
 * @param {Buffer} buf
 */
export function tarballDigest(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

/* ────────────────────────── 生成与打印 ────────────────────────── */

/**
 * 磁盘上那四件版本声明（`engines.node` / `packageManager` / npm 工具 / Python 工具）。
 *
 * 五个入口全是注入面：用例不该读本仓的真文件（那会让一条判据随仓库版本漂）。
 *
 * @param {{root?: string, readFile?: (p: string) => string, exists?: (p: string) => boolean}} [options]
 */
export function diskFacts({
  root = ROOT,
  readFile = (p) => readFileSync(p, "utf8"),
  exists = existsSync,
} = {}) {
  const pkg = JSON.parse(readFile(path.join(root, "package.json")));
  const lockFile = path.join(root, "pnpm-lock.yaml");
  const lockText = exists(lockFile) ? readFile(lockFile) : "";
  const npmVersions = toolingVersionsFromLock(lockText, NPM_TOOLING);
  const missingNpm = NPM_TOOLING.filter((n) => !(n in npmVersions));
  return {
    enginesRange: pkg.engines?.node ?? "",
    pnpmVersion: String(pkg.packageManager ?? "").replace(/^pnpm@/, ""),
    npmVersions,
    missingNpm,
    pythonTooling: [...PYTHON_TOOLING],
  };
}

/**
 * 「那一份东西打出来有多大」的读数（`file:` 跑法用，`--tar` 打出来时同步打印）。
 *
 * 人问的第一个问题永远是「这包多大、我要传多久」—— 而答案是**量出来的**，不是估的。
 *
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let n = Number(bytes ?? 0);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 打印 / 写出这份计划（`--dockerfile` 只打 Dockerfile，`--tar` 顺手打一份 tar）。
 *
 * `nodeVersion` 缺省**不猜**：要么调用方给，要么先用 `fetchNodePlan()` 现取（`--online`）。
 * 一个悄悄生效的缺省版本会让镜像与 `engines.node` 各走各的，而两者都在盘上、谁也没报错。
 *
 * @param {{
 *   write?: boolean,
 *   tar?: boolean,
 *   root?: string,
 *   log?: (line: string) => void,
 *   nodeVersion?: string,
 *   facts?: ReturnType<typeof diskFacts>,
 * }} [options]
 * @returns {{dockerfile: string, plan: ReturnType<typeof imagePlan>, tarDigest?: string}}
 */
export function main({
  write = false,
  tar = false,
  root = ROOT,
  log = console.log,
  nodeVersion,
  facts = diskFacts({ root }),
} = {}) {
  if (!nodeVersion) {
    throw new Error(
      "没有拿到精确的 Node 补丁号 —— 用 --node-version vX.Y.Z 给一个，" +
        "或加 --online 让它从 " +
        NODE_INDEX_URL +
        " 现取（fetchNodePlan）。别让这里退回一个猜出来的版本。",
    );
  }
  const plan = imagePlan({ nodeVersion, pnpmVersion: facts.pnpmVersion });
  if (facts.missingNpm.length > 0) {
    log(
      `[ci-image-plan] ⚠️ pnpm-lock.yaml 里读不到这几件的版本：${facts.missingNpm.join(", ")} ` +
        "—— 镜像里会装成别的版本，而日志两边都像成功",
    );
  }
  const layers = imagePlanLayersAreOrdered(plan.dockerfile);
  if (!layers.ok) {
    throw new Error(
      "生成的 Dockerfile 层序不对（那是这个文件要买的东西被退回去的形态，它不会报错、只会慢）：\n  - " +
        layers.problems.join("\n  - "),
    );
  }
  /** @type {{dockerfile: string, plan: ReturnType<typeof imagePlan>, tarDigest?: string}} */
  const out = { dockerfile: plan.dockerfile, plan };
  if (write) {
    mkdirSync(path.join(root, "docker"), { recursive: true });
    writeFileSync(
      path.join(root, "docker", "ci-node.Dockerfile"),
      plan.dockerfile,
      "utf8",
    );
    log(`[ci-image-plan] 已写出 docker/ci-node.Dockerfile（${plan.tag}）`);
  }
  if (tar) {
    const buf = buildTarStream({ root });
    const file = path.join(root, `comfyapp-ci-${plan.tag.replace(/[:/]/g, "-")}.tar`);
    writeFileSync(file, buf);
    out.tarDigest = tarballDigest(buf);
    log(
      `[ci-image-plan] 已打出 ${path.basename(file)}（${formatBytes(buf.length)}，${out.tarDigest}）`,
    );
  }
  log("\n# ── 1) 造镜像 ──");
  log(plan.build);
  log("\n# ── 2) 导成 tar 拿到那台机器上（本机直接用就不用倒）──");
  log(`docker save ${plan.tag} -o comfyapp-ci.tar`);
  log("\n# ── 3) 装进宿主机（拷出来，不挂载宿主目录）──");
  log(plan.cp);
  log("\n# ── 4) 逐件核对（与本文件构建期自证同一份清单）──");
  for (const line of checkCommands()) log(`  ${line}`);
  log("\n# ── 5) 钉成机器级标识（`镜像身份` 那一档读的两个变量）──");
  log(
    `docker image inspect --format "{{index .RepoDigests 0}}" ${plan.tag}` +
      "   # → COMFYAPP_NODE_IMAGE / COMFYAPP_NODE_IMAGE_DIGEST",
  );
  return out;
}

/* 只在被直接执行时跑（`tests/script-main-guard.test.ts` 守着这一形态：
 * 两侧都过 `path.resolve` 比较，别拼 `file://${argv[1]}` —— 它在 Windows 上恒不相等）。 */
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    const args = new Set(process.argv.slice(2));
    if (args.has("--dockerfile")) {
      /* 只打 Dockerfile 正文：`docker build -f -` 与「人先看一眼」两个用法都要它干净。 */
      const nodeVersion = argValue("--node-version");
      process.stdout.write(
        imagePlan({
          nodeVersion: nodeVersion ?? (await onlineNodeVersion()),
          pnpmVersion: diskFacts().pnpmVersion,
        }).dockerfile,
      );
    } else {
      main({
        write: args.has("--write"),
        tar: args.has("--tar"),
        nodeVersion: argValue("--node-version") ?? (await onlineNodeVersion()),
      });
    }
  } catch (error) {
    console.error(`[ci-image-plan] ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}

/** 取 `--flag value` 形态的值（没有就 `undefined`）。 */
function argValue(/** @type {string} */ flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  const value = argv[i + 1];
  return i >= 0 && value && !value.startsWith("--") ? value : undefined;
}

/** 联网取一版本（`--dockerfile` 没给 `--node-version` 时唯一的来路）。 */
async function onlineNodeVersion() {
  const { version } = await fetchNodePlan({ enginesRange: diskFacts().enginesRange });
  return version;
}
