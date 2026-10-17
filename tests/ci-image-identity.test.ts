/**
 * 流水线上「镜像身份」那一步的判据（ISSUE #1993）。
 *
 * ## 它守的是哪一格
 *
 * 用户问的是「宿主级怎么用镜像」。自托管这条路上镜像**没有**被声明的地方
 * （`pipeline.docker.image` 不生效），所以它只剩一种用法：宿主侧 `docker pull`
 * 一张钉了版本标签的节点镜像、按它装好 —— 而那一刻产出的**唯一可追的东西**是
 * 「这台机长自哪一版」。缺了它，环境是隐形的：工具链清单反复红，每次都要靠翻上一次
 * 的红色日志反推「这台机到底有什么」（§13.5.3.5 那张表的由来）。
 *
 * ## 为什么这一格**只记录、不判红**
 *
 * 三条理由都写进了 `scripts/ci-image-identity.mjs` 的文件头，判据侧只守其中两条：
 *
 *   · 没有声明**不等于**这台机不对（裸装机是历史形态，第一次接进节点的一跑不该被
 *     一条与新事实无关的红拦住）⇒ `exitCode` 恒 0，三档都是；
 *   · 「标签 / digest 对不对得上镜像库」本进程**判不了**（构建容器里没有 docker）⇒
 *     判据只覆盖形态那一层（标签是不是钉死的、digest 拼得像不像）。
 *
 * ## 判据的形状：把「哪一档 ⇒ 说什么」钉住
 *
 * 三条判据各自堵一种失效形态：**恒绿的空转**（脚本跑了但什么都没判）、
 * **读数与事实相反**（标签写着 `latest` 却说「已钉版本」）、**下一动作缺失**
 * （说了「没有身份」却不说怎么补 —— 那正是这一格存在的理由）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIGEST_ENV,
  digestVerdict,
  imageIdentity,
  IMAGE_ENV,
  imageTagVerdict,
  osRelease,
  platformImageStages,
  ROOT,
} from "../scripts/ci-image-identity.mjs";
import { registeredGateOrder } from "./no-platform-ci-config.test";
import { unwrapCp936 } from "../scripts/ci-cp936-exit.mjs";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 跑一次读数，把打印出来的行收起来（不出网、不读真环境）。 */
function run(env: Record<string, string | undefined> = {}) {
  const lines: string[] = [];
  const result = imageIdentity({
    env,
    osReleaseImpl: () => "测试用发行版 / linux x64",
    kernelImpl: () => "Linux 0.0.0-test",
    log: (l: string) => lines.push(l),
  });
  return { ...result, said: lines.join("\n") };
}

/** 一个形态合法的 sha256 digest（只判**形态**，见文件头第二条）。 */
const SHA = `sha256:${"a".repeat(64)}`;

describe("镜像身份：标签判读的三档（「钉版本」与「latest」不能混着说）", () => {
  it("没有标签 ⇒ floating（能拉，但「哪一版」不可追）", () => {
    /* 与下文 `latest` 同档：两者都**没有**版本信息，处置也一样（钉一个版本标签）。
     * 分两档只会让话术多一条，而下一动作一字不差。 */
    expect(imageTagVerdict("cnb.cool/ns/node-base")).toEqual({
      verdict: "floating",
      tag: null,
    });
  });

  it("`latest` ⇒ floating；别的一律 pinned（含 registry 端口那种形态）", () => {
    expect(imageTagVerdict("cnb.cool/ns/node-base:latest").verdict).toBe(
      "floating",
    );
    expect(imageTagVerdict("cnb.cool/ns/node-base:v24.4")).toEqual({
      verdict: "pinned",
      tag: "v24.4",
    });
    /* ⚠️ 这条是**按最后一个 `:`** 切的回归判据：按第一个切会把 `5000` 当标签，
     * 于是 `host:5000/x:latest` 会被判成「已钉版本」—— 一个恰好反过来的读数。 */
    expect(imageTagVerdict("registry.local:5000/ns/node-base:latest")).toEqual({
      verdict: "floating",
      tag: "latest",
    });
    expect(
      imageTagVerdict("registry.local:5000/ns/node-base:2026-10").verdict,
    ).toBe("pinned");
  });

  it("`@sha256:` 形态算 pinned（digest 比标签更硬）", () => {
    expect(imageTagVerdict(`cnb.cool/ns/node-base@${SHA}`)).toEqual({
      verdict: "pinned",
      tag: null,
    });
  });

  it("空串与 undefined 都是 missing（「没声明」不是「声明了一个坏标签」）", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(imageTagVerdict(v).verdict).toBe("missing");
    }
  });
});

describe("镜像身份：digest 只判形态（不判真伪 —— 那要镜像库）", () => {
  it("`sha256:` + 64 位十六进制 ⇒ ok（大小写都认）", () => {
    expect(digestVerdict(SHA)).toBe("ok");
    expect(digestVerdict(`sha256:${"A".repeat(64)}`)).toBe("ok");
  });

  it("拼错的 digest 报 malformed —— 拼错的比没有更容易骗人", () => {
    expect(digestVerdict("sha256:abc")).toBe("malformed");
    expect(digestVerdict(`${"a".repeat(64)}`)).toBe("malformed");
    expect(digestVerdict("sha246:" + "a".repeat(64))).toBe("malformed");
  });

  it("没给 ⇒ missing", () => {
    for (const v of [undefined, null, "", "  "]) {
      expect(digestVerdict(v)).toBe("missing");
    }
  });
});

describe("镜像身份：三档读数各自说什么（读数与事实不许相反）", () => {
  it("已钉版本 + digest 形态对 ⇒ 说「可追」，且**不提下一动作**", () => {
    const r = run({
      [IMAGE_ENV]: "cnb.cool/ns/node-base:v24.4",
      [DIGEST_ENV]: SHA,
    });
    expect(r.verdict).toBe("pinned");
    expect(r.digest).toBe("ok");
    expect(r.said).toContain("cnb.cool/ns/node-base:v24.4");
    expect(r.said).toContain("可追");
    /* 「一方说对齐、一方叫人去改」是话术自相矛盾的典型（`ci-env-probe.mjs` 的
     * 编码那一格记过同一形态）—— 这一档**不给**下一动作。 */
    expect(r.said).not.toContain("docker image inspect");
  });

  it("`latest` ⇒ 说清「不可追」并给出取 digest 的命令", () => {
    const r = run({
      [IMAGE_ENV]: "cnb.cool/ns/node-base:latest",
      [DIGEST_ENV]: SHA,
    });
    expect(r.verdict).toBe("floating");
    expect(r.said).toContain("不可追");
    expect(r.said).toContain("docker image inspect");
  });

  it("没有声明 ⇒ 指向两个环境变量、点名「别用 latest」、并给出口文档", () => {
    const r = run({});
    expect(r.verdict).toBe("missing");
    expect(r.said).toContain(IMAGE_ENV);
    expect(r.said).toContain(DIGEST_ENV);
    expect(r.said).toContain("别用 latest");
    /* 这一格存在的全部理由是「让人知道怎么补」—— 出口必须可点。 */
    expect(r.said).toContain("§13.5.3.4.1");
  });

  it("声明了引用却没给 digest ⇒ 多一条读数（标签会被移动，digest 不会）", () => {
    const r = run({ [IMAGE_ENV]: "cnb.cool/ns/node-base:v24.4" });
    expect(r.said).toContain("标签会被移动");
  });

  it("digest 拼错 ⇒ 点名形态要求", () => {
    const r = run({
      [IMAGE_ENV]: "cnb.cool/ns/node-base:v24.4",
      [DIGEST_ENV]: "sha256:xyz",
    });
    expect(r.digest).toBe("malformed");
    expect(r.said).toContain("64 位十六进制");
  });
});

describe("镜像身份：它是**读数**不是判据（三档都不许退非零）", () => {
  it("三档的 exitCode 都是 0 —— 这是决定，不是漏写", () => {
    /* 本仓的工具链靠**断言**守（`工具链自证` 判四件、`环境前提` 判版本下限）：
     * 那些是实际能力，镜像是期望身份。两者不一致时以能力为准，所以这里不判红 ——
     * 判红等于加第二个判据源（§12.18），也等于把「第一次接进节点的一跑」拦住。 */
    for (const env of [
      {},
      { [IMAGE_ENV]: "cnb.cool/ns/node-base:latest" },
      { [IMAGE_ENV]: "cnb.cool/ns/node-base:v24.4", [DIGEST_ENV]: "坏" },
      { [IMAGE_ENV]: "cnb.cool/ns/node-base:v24.4", [DIGEST_ENV]: SHA },
    ]) {
      expect(run(env).exitCode).toBe(0);
    }
  });

  it("磁盘那一格答的是发行版，不是一句 `linux`", () => {
    /* 只说 `linux` 答不出「长自哪张镜像」—— 那正是这一步要回答的问题。
     * 真机上的读数（本仓的构建容器）：`Debian GNU/Linux 12 (bookworm) / linux x64`。 */
    const real = osRelease();
    expect(real).toContain(process.platform);
    expect(real.length).toBeGreaterThan(process.platform.length);
    /* 读不到时如实说「读不到」，而不是把一个 IO 失败写成「环境不对」。 */
    const missing = osRelease({
      exists: () => false,
      readFile: () => "",
    });
    expect(missing).toContain("没有 /etc/os-release");
    const broken = osRelease({
      exists: () => true,
      readFile: () => {
        throw new Error("读不动");
      },
    });
    expect(broken).toContain("读不动");
  });
});

describe("镜像身份：流水线上真的在跑它（脚本存在而配置没接上 = 这一步白写）", () => {
  it("`COMFYAPP_CI_GATES` 里登记了它，且排在 `Python 可用性` 之前", () => {
    const order = registeredGateOrder(read(".cnb.yml"));
    const at = order.indexOf("镜像身份");
    /* 位置：紧跟 `工具链自证`（它读的正是那一步自证出来的那台机器），
     * 且早于一切依赖安装 —— 与 `环境前提` 同一类「便宜且早」的步骤。 */
    expect(
      at,
      "`镜像身份` 不在清单里 —— 那一步因此没有任何执行者",
    ).toBeGreaterThan(-1);
    expect(at).toBe(order.indexOf("工具链自证") + 1);
    expect(at).toBeLessThan(order.indexOf("Install dependencies"));
  });

  it("那一步点名的入口真的在盘上，且还包着 CP936 出口外壳", () => {
    const block = /^\s*-\s*name:\s*镜像身份\s*$\r?\n\s*script:\s*(\S.*)$/m.exec(
      read(".cnb.yml"),
    )?.[1];
    expect(block, "解析不出「镜像身份」那一步的 script").toBeTruthy();
    const command = String(block).trim();
    /* 平台的 stage shell 是 PowerShell，它默认按 CP936 解子进程的 UTF-8 输出 ——
     * 这一步打的**全是中文**（判读那几行），少了这句它在平台日志里就是花屏。 */
    expect(
      command,
      "「镜像身份」的脚本里没有给 PowerShell 设 UTF-8 输出编码 —— 平台日志会是乱码",
    ).toContain("[Console]::OutputEncoding");
    expect(unwrapCp936(command)).toContain(
      "node scripts/ci-image-identity.mjs",
    );
    expect(read("scripts/ci-image-identity.mjs").length).toBeGreaterThan(0);
  });

  it("两个变量名在**给人读的那一面**确实被点名（规范与下一步的操作说明）", () => {
    /* `IMAGE_ENV` / `DIGEST_ENV` 是脚本里定义的常量。人要知道「钉什么」只能从**文档**
     * 得知 —— `.cnb.yml` 里刻意不写它们：那份配置不声明环境（自托管上写了也不生效），
     * 而这一段判据此前正是把 `.cnb.yml` 当成「说出来」的地方，于是一份正确的配置
     * 会判红（这次实现当场撞上）。规范那一头是唯一该点名的地方。 */
    const doc = read("docs/standards/13-提交与-code-review.md");
    expect(
      doc.includes(IMAGE_ENV) && doc.includes(DIGEST_ENV),
      "规范里没有这两个变量的口径 —— 那一步给出下一动作时指的是一片空白",
    ).toBe(true);
    /* 反向：字面量不许在 `scripts/**` 里再写第二份（常量才是唯一出处）。 */
    expect(read("scripts/ci-image-identity.mjs")).toContain(`"${IMAGE_ENV}"`);
  });
});

/**
 * 「哪几格换了环境」必须是**一份读得出来的名单**（ISSUE #1993 续）。
 *
 * 这条守的是一句很容易被读反的话：自托管上「没有 docker」不等于「没有容器」——
 * 失效的只是 `pipeline.docker.image` / `volumes`（声明构建环境那两把旋钮），
 * 而**任务级 `image:`** 与插件任务仍在独立容器里跑（官方 `script-vs-plugin.md`
 * 「执行环境」）。于是本仓的真实形态是「宿主机直跑 + 少数几格进容器」。
 *
 * 为什么要有判据而不是只留注释：**多一格少一格都不会报错**。有人顺手给「类型检查」
 * 也加个 `image:`，配置照跑、日志照绿 —— 而那一格要拉镜像、要重装依赖，正是这份
 * 配置当初把「装一次」放在宿主机上的理由。名单在这里逐格点名，加一格就得先过这一条。
 */
describe("容器格：哪几格进容器是**决定**，不是随手写的（ISSUE #1993 续）", () => {
  /** 本仓**允许**换环境的两格（理由逐条写在 `.cnb.yml` 它们的注释里）。 */
  const CONTAINER_STAGES = ["浏览器安装", "E2E 关键流程"];

  it("解析器认得 stage 级 `image:`，且不把 `env:` 里的同名键算进来", () => {
    const fixture = [
      "master:",
      "  pull_request:",
      "    - stages:",
      "    - name: A",
      "      script: echo a",
      "      env:",
      "        image: not-an-image-key",
      "    - name: B",
      "      image: node:24",
      "      script: echo b",
      "    # - name: C",
      "    #   image: node:24",
      "",
    ].join("\n");
    expect(platformImageStages(fixture)).toEqual([
      { name: "B", image: "node:24" },
    ]);
  });

  it("现役 `.cnb.yml`：进容器的正好是那两格（多一格少一格都红）", () => {
    const got = platformImageStages(read(".cnb.yml")).map((s) => s.name);
    expect(
      got,
      "进容器的 stage 与决定不一致 —— 改名单要同批改这条判据，并写成「为什么」",
    ).toEqual(CONTAINER_STAGES);
  });

  it("两格用同一张镜像，且标签钉到版本（不是 `latest`）", () => {
    const stages = platformImageStages(read(".cnb.yml"));
    const refs = stages.map((s) => s.image);
    expect(
      new Set(refs).size,
      "两格的镜像不是同一张 —— 浏览器落点会分成两处",
    ).toBe(1);
    /* `latest` 会让「这份日志是哪一版环境跑出来的」不可追（与 `imageTagVerdict`
     * 对 `COMFYAPP_NODE_IMAGE` 的口径同源）。 */
    expect(imageTagVerdict(refs[0]).verdict).toBe("pinned");
    expect(refs[0], "Playwright 镜像要带官方的那套浏览器").toMatch(
      /playwright:v\d+\.\d+\.\d+-(jammy|noble)$/,
    );
  });

  it("镜像标签里的 Playwright 版本 == 仓库依赖解析到的版本（升级只改一半 = 装错版本的浏览器）", () => {
    /* 官方镜像按**它自己那一版** Playwright 的 `browsers.json` 装浏览器：跨版本时
     * 它要的 browser revision 与仓库里跑的 Playwright 不同，等价于「装了一份错版本的
     * 浏览器」—— 而症状是 `Executable doesn't exist at …`，读起来像缺件。 */
    const ref = platformImageStages(read(".cnb.yml"))[0]?.image ?? "";
    const inImage = /playwright:v(\d+\.\d+\.\d+)-/.exec(ref)?.[1];
    const declared = (
      JSON.parse(read("package.json")) as {
        devDependencies?: Record<string, string>;
      }
    ).devDependencies?.["@playwright/test"];
    expect(inImage, `镜像标签里读不出 Playwright 版本：${ref}`).toBeTruthy();
    expect(declared, "package.json 里没有 @playwright/test").toBeTruthy();
    expect(
      String(declared).replace(/^[^0-9]*/, ""),
      "镜像标签的 Playwright 版本与 package.json 声明的不是同一个 —— 升级要同批改 .cnb.yml 这一行",
    ).toBe(inImage);
  });

  it("镜像把浏览器装在哪，就告诉判据装在哪（`PLAYWRIGHT_BROWSERS_PATH` 与镜像同源）", () => {
    /* 官方 Playwright 镜像的落点是 `/ms-playwright`。不给这一行，落点判据在 Windows
     * 宿主上按 `%LOCALAPPDATA%` 推 —— 于是「镜像里明明有」与「一件都没有」在日志里
     * 逐字同形（本仓最贵的那类红）。这一行只写**一处**（流水线的 `env`），两格共享。 */
    const text = read(".cnb.yml");
    const path = /PLAYWRIGHT_BROWSERS_PATH:\s*(\S+)/.exec(text)?.[1];
    expect(path, "`浏览器安装` 没有指定浏览器落点").toBe("/ms-playwright");
  });
});
