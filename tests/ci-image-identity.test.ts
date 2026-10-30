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
  readImageDeclarations,
  ROOT,
} from "../scripts/ci-image-identity.mjs";
import { registeredGateOrder } from "./no-platform-ci-config.test";
import { unwrapCp936 } from "../scripts/ci-cp936-exit.mjs";

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 跑一次读数，把打印出来的行收起来（不出网、不读真环境）。 */
function run(env: Record<string, string | undefined> = {}) {
  const lines: Array<string> = [];
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
    expect(imageTagVerdict("cnb.cool/ns/node-base:latest").verdict).toBe("floating");
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
    expect(imageTagVerdict("registry.local:5000/ns/node-base:2026-10").verdict).toBe("pinned");
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
    expect(at, "`镜像身份` 不在清单里 —— 那一步因此没有任何执行者").toBeGreaterThan(-1);
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
    expect(unwrapCp936(command)).toContain("node scripts/ci-image-identity.mjs");
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
 * 「哪几格换了环境」必须是**一份读得出来的名单**（ISSUE #1993 续 → 2026-10-17 订正）。
 *
 * ## 现役答案是**零格**，而这条判据守的是那个「零」
 *
 * 上一版这条判据钉的是「进容器的正好是 `浏览器安装` / `E2E 关键流程` 两格」，依据是
 * 官方 `script-vs-plugin.md` 的一句「指定 `image` 的脚本任务在独立容器中执行」。那句话
 * 本身没错，但它讲的是**平台池**那种形态；自托管节点上**没有 docker daemon**，平台连
 * 「起容器」都做不到 —— 而且这与「写在 stage 上还是 Job 上」无关，两跑各用一种写法，
 * 各红一次，答案都是同一句（`cnb-cqk-1k550gpp2`，PR #2003 首跑）：
 *
 *     浏览器安装  error [70ms]  →  Runner does not enable Docker.
 *
 * 70 毫秒、脚本一行都没执行、前面三十三步全绿。所以 `.cnb.yml` 里那两行 `image:` 撤了，
 * 这条判据把允许的名单钉成**空** —— 与上一版是同一条判据、只换了答案：名单仍在这里
 * **逐格点名**，加一格就必须先过这一条，而它会指着上面这段读数说话。
 *
 * ## 名单是空的，所以「不空转」由下面另几条担着
 *
 * `toEqual([])` 与「解析器永远返回空」在结果上无法区分 —— 那是本文件头注列为要堵的
 * 失效形态之一。喂夹具的那两条（Job 级认得出来 / stage 级进另一个出口）就是这一档的
 * 非空转证明：解析器还活着，绿的只是配置本身。要改回去的前提写在 `.cnb.yml` 那一段
 * 注释里，且必须与这里的判据**同批**改。
 */
describe("容器格：哪几格进容器是**决定**，不是随手写的（ISSUE #1993 续）", () => {
  /** 本仓**允许**带 `image:` 的 stage —— **空**：这台节点上没有 docker daemon。 */
  const CONTAINER_STAGES: Array<string> = [];

  it("解析器只认 Job 级 `image:`，且不把 `env:` 里的同名键算进来", () => {
    const fixture = [
      "master:",
      "  pull_request:",
      "    - stages:",
      "    - name: A",
      "      script: echo a",
      "      env:",
      "        image: not-an-image-key",
      "    - name: B",
      "      jobs:",
      "        - name: B",
      "          image: node:24",
      "          script: echo b",
      "    # - name: C",
      "    #   image: node:24",
      "",
    ].join("\n");
    expect(platformImageStages(fixture)).toEqual([{ name: "B", image: "node:24" }]);
    /* 写错层的那一格**不进**这份名单，而进另一个出口 —— 它压根跑不起来，
     * 与「某一格进了容器」是两件事（`readImageDeclarations()` 两个出口）。 */
    const wrongLevel = [
      "master:",
      "  pull_request:",
      "    - stages:",
      "    - name: D",
      "      image: node:24",
      "      script: echo d",
      "",
    ].join("\n");
    expect(platformImageStages(wrongLevel)).toEqual([]);
    expect(readImageDeclarations(wrongLevel).stageLevelImages).toEqual([
      { name: "D", image: "node:24" },
    ]);
  });

  it("现役 `.cnb.yml`：**一格都不带** `image:`（带一格就是 70ms 的 `Runner does not enable Docker`）", () => {
    const got = platformImageStages(read(".cnb.yml")).map((s) => s.name);
    expect(
      got,
      "有 stage 带了 `image:` —— 自托管节点上没有 docker daemon，这一格会在 70ms 内红在 " +
        "`Runner does not enable Docker` 上（实测 cnb-cqk-1k550gpp2，脚本一行都没执行）。" +
        "真要换环境，先解决「这台节点起不起得来容器」这件事，别只加一行 image:；" +
        "改这份名单要同批改这条判据，并写成「为什么」",
    ).toEqual(CONTAINER_STAGES);
  });

  it("这条判据不是空转：喂一份真带 `image:` 的配置，它认得出来且与空名单不等", () => {
    /* 名单是空数组时，上面那条的绿与「解析器瞎了」在结果上无法区分 —— 那正是「恒绿的
     * 空转」。所以这里给解析器喂一份**真的带 image** 的配置，断言它认得出来。 */
    const withImage = [
      "master:",
      "  pull_request:",
      "    - stages:",
      "    - name: 浏览器安装",
      "      jobs:",
      "        - name: 浏览器安装",
      "          image: mcr.microsoft.com/playwright:v1.63.0-noble",
      "          script: node scripts/ci-toolchain-selfcheck.mjs --playwright-only",
      "",
    ].join("\n");
    const names = platformImageStages(withImage).map((s) => s.name);
    expect(names).toEqual(["浏览器安装"]);
    expect(names).not.toEqual(CONTAINER_STAGES);
  });

  it("浏览器落点：覆盖只能指向宿主上真实存在的落点（不许是容器那个 `/ms-playwright`）", () => {
    /* 官方 Playwright 镜像把浏览器装在 `/ms-playwright`，那一行当初是**给容器**配的：
     * 判据得去镜像里那个目录找。带 `image:` 的 stage 在这台节点上必然红（见上），
     * 于是这一行剩下的唯一效果是**把落点判据指到一个宿主上不存在的目录** ——
     * 「明明装过」与「一件都没有」在日志里逐字同形（本仓最贵的那类红）。
     *
     * ⚠️ **判据收窄过，但没收掉**：现在 `.cnb.yml` 的**流水线级** env 里有一行
     * `PLAYWRIGHT_BROWSERS_PATH`，它指的是开发盘上那个**真实存在**的落点 ——
     * 覆盖本身是正当的（自托管节点把浏览器与其余开发盘实体放在一起，见 `.cnb.yml`
     * 那段「落点」）。**仍然要拦的是容器那个路径**：它在 Windows 宿主上不存在，
     * 留着它依旧是「把落点判据指到一个空目录」。
     *
     * 形状那一半（三行必须在**流水线级** env、`TEMP` 与 `TMP` 成对、三者同卷）由
     * `tests/ci-dev-drive-root.test.ts` 判 —— 那一组守的是「每一格都看到它们」。
     *
     * 按**行首的键**判，不按「文件里出现过这个词」：`.cnb.yml` 的注释里正当会写它
     * （那几段注释正是在解释「为什么这里不写它」）。 */
    const text = read(".cnb.yml");
    const override = /^[ \t]*PLAYWRIGHT_BROWSERS_PATH:[ \t]*(.*)$/m.exec(text);
    const value = (override?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    expect(
      value,
      "`.cnb.yml` 里 `PLAYWRIGHT_BROWSERS_PATH` 指向了容器那个路径 —— " +
        "它在 Windows 宿主上不存在，会把落点判据指到一个空目录" +
        "（`浏览器安装` 因此永远重新下载，而日志与「一件都没有」逐字同形）",
    ).not.toBe("/ms-playwright");
  });
});
