/**
 * 流水线「镜像身份」判据（ISSUE #1993）。自托管这条路上镜像没有声明处（`pipeline.docker.image` 不生效），唯一用法是宿主 `docker pull` 钉标签的节点镜像，故唯一可追的是「这台机长自哪一版」——缺了环境即隐形。
 * **只记录、不判红**：没有声明不等于这台机不对（裸装机是历史形态，首跑不该被无关的红拦住）⇒ `exitCode` 恒 0；「标签/digest 对不对得上镜像库」本进程判不了（构建容器无 docker）⇒ 只覆盖形态层。
 * 判据把「哪一档 ⇒ 说什么」钉住，三条各堵一种失效：恒绿空转（脚本跑了但没判）、读数与事实相反（写着 `latest` 却说已钉版本）、下一动作缺失（说「没有身份」却不说怎么补）。
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
    expect(digestVerdict("a".repeat(64))).toBe("malformed");
    expect(digestVerdict(`sha246:${"a".repeat(64)}`)).toBe("malformed");
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

describe("镜像身份：已随 CNB 主列瘦身退役（ISSUE #3378）", () => {
  it("不再挂在 `COMFYAPP_CI_GATES` 上，脚本仍留盘", () => {
    /* 这一格是自托管节点的镜像身份读数（恒退 0）。CNB `pull_request` build 现在
     * 只做站内回读 GA 结论，没有节点事实的消费者 ⇒ 退役。脚本留盘，供每日档
     * 环境读数与「下一台机器从哪张镜像长出来」那一问按需复用。 */
    const order = registeredGateOrder(read(".cnb.yml"));
    expect(
      order.indexOf("镜像身份"),
      "`镜像身份` 又回到 PR 清单了 —— 它已随 #3378 退役；要加回请先给出它在这条 build 上的消费者",
    ).toBe(-1);
    expect(
      order.indexOf("GA 回调结论回读"),
      "承重回读格不在清单里 —— §13.6 的锚不能丢",
    ).toBeGreaterThan(-1);
    expect(read("scripts/ci-image-identity.mjs").length, "脚本留盘").toBeGreaterThan(0);
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
 * 「哪几格换了环境」须是**一份读得出来的名单**（ISSUE #1993 续 → 2026-10-17 订正）：现役答案是**零格**，本条守那个「零」。上一版钉「进容器的正好是两格」，据官方「指定 `image` 的脚本在独立容器执行」——那讲的是平台池，自托管节点**没有 docker daemon**。
 * 两跑各红一次（`cnb-cqk-1k550gpp2`，PR #2003 首跑）：`浏览器安装 error [70ms] → Runner does not enable Docker.`，脚本一行没跑、前三十三步全绿。故撤掉那两行 `image:`，允许名单钉成**空**，仍逐格点名。
 * 名单空 ⇒「不空转」由夹具那两条担着（Job 级认得出来 / stage 级进另一出口），证明解析器还活着、绿的只是配置本身；要改回去须与 `.cnb.yml` 那段注释**同批**改。
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
    /* 官方 Playwright 镜像把浏览器装在 `/ms-playwright`，那一行当初是给容器配的：带 `image:` 的 stage 在这台节点必然红（见上），留着它只剩一个效果 —— 把落点判据指到宿主上不存在的目录，而「装过」与「一件都没有」在日志里逐字同形。
     * 判据收窄过但没收掉：流水线级 `PLAYWRIGHT_BROWSERS_PATH` 指向开发盘真实落点属正当覆盖，仍要拦容器那个路径（Windows 宿主上不存在）。形状那一半（三行在流水线级 env、`TEMP`/`TMP` 成对、三者同卷）由 `tests/ci-dev-drive-root.test.ts` 判。
     * 按**行首的键**判，不按「文件里出现过」：`.cnb.yml` 注释里正当会写它（那几段正是在解释为什么这里不写）。
     */
    const text = read(".cnb.yml");
    const override = /^[ \t]*PLAYWRIGHT_BROWSERS_PATH:[ \t]*(?<value>.*)$/m.exec(text);
    const value = (override?.groups?.value ?? "").trim().replaceAll(/^["']|["']$/g, "");
    expect(
      value,
      "`.cnb.yml` 里 `PLAYWRIGHT_BROWSERS_PATH` 指向了容器那个路径 —— " +
        "它在 Windows 宿主上不存在，会把落点判据指到一个空目录" +
        "（`浏览器安装` 因此永远重新下载，而日志与「一件都没有」逐字同形）",
    ).not.toBe("/ms-playwright");
  });
});
