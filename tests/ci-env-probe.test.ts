/**
 * 「环境前提」那一步的判据（ISSUE #1959）：别等到执行几十分钟后才发现环境装不上。缺件已由 `ci-toolchain-selfcheck.test.ts` 答了。
 * 这里答「在但版本不对」（解释器低于 Python 3.10 时那些用例走 `env` 档跳过，与「装好了」日志同形）与「配置配错」：host PowerShell 5.1
 * 认不了 `?.` / `??`，不在解析期报错、跑到那段整段炸。判据不重写（`findPython()` / `ps7OnlySyntaxIn` 各一处）；`.ts` 在装依赖前 import 不到，故留文本副本、第一组用例对账。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  envProbe,
  BROWSER_INSTALL_STAGE,
  parseVersionTriple,
  ps7OnlySyntaxIn as ps7OnlySyntaxInProbe,
  PYTHON_MIN_TEXT,
  pythonVersionMeetsFloor,
  readPipelineConfig,
  stageBlockIn,
  stageEnvValue,
  stagesWithImage,
} from "../scripts/ci-env-probe.mjs";
/* 每个 stage 现在都以 `node scripts/ci-cp936-exit.mjs -- <真命令>` 起（ISSUE #1977），
 * 而下面那条「环境前提点名的入口在不在盘上」判据抓的是 `scripts/…` —— 不剥外壳就会
 * 抓到外壳自己（它当然在盘上），判据从「接线对不对」退化成「外壳在不在」。 */
import { unwrapCp936 } from "../scripts/ci-cp936-exit.mjs";
import {
  commentedStageBlock,
  ps7OnlySyntaxIn as ps7OnlySyntaxInGate,
  registeredGateOrder,
  stageBlock as stageBlockGate,
} from "./no-platform-ci-config.test";
import {
  isReachableVerdict,
  playwrightReachability,
  playwrightReachabilityVerdicts,
} from "../scripts/ci-toolchain-browser.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 一份「什么都没有」的假注入面（用例只关心它自己造的那一格）。 */
function silentPorts() {
  return { log: String, logError: String };
}

describe("环境前提：两处判据不许各写一份答案", () => {
  it("`?.` / `??` 那一份表：脚本里的副本与门禁判据逐项同一份答案", () => {
    /* 两份实现的**形状**必然不同（一个给行号、一个给结论），能也**必须**对账的是
     * 「哪些写法算命中」与「替代写法怎么说」。这里按文本造一组现场喂进两边。 */
    const fixture = [
      "a:",
      "  stages:",
      "  - name: x",
      "    script: |",
      "      # 注释里的 ?. 不算（配置里正当地会写出这个形状）",
      "      $a = (Get-Command w) ?.Source",
      "      $b = $c ?? 1",
      "      $d = [List[string]]::new()",
      "      $e = $f | ConvertFrom-Json -AsHashtable",
      "  - name: y",
      "    script: cmd /c ver",
      "",
    ].join("\n");
    const gate = ps7OnlySyntaxInGate(fixture);
    const probe = ps7OnlySyntaxInProbe(fixture);
    /* 两个方向都判：少了 = 扫描面漂了；两边都得**真的命中**（不然这条用例是空转）。 */
    expect(gate.length, "门禁那一份没命中 —— 夹具本身写坏了").toBe(4);
    expect(probe.length, "脚本那一份没命中 —— 副本漂了").toBe(gate.length);
    /* 行号必须指到同一行（差一行就等于有一边扫错了块边界）。 */
    const lineOf = (s: string) => Number(/第 (?<line>\d+) 行/.exec(s)?.groups?.line ?? -1);
    expect(probe.map(lineOf)).toEqual(gate.map(lineOf));
  });

  it("注释与块外的同形文本都放过（不然这条判据会逼人删说明注释）", () => {
    const commented =
      "x:\n  - name: a\n    script: |\n      # 这里正当地写着 ?. 这个形状\n      ok\n";
    expect(ps7OnlySyntaxInProbe(commented)).toEqual([]);
    expect(ps7OnlySyntaxInGate(commented)).toEqual([]);
    expect(ps7OnlySyntaxInProbe("name: ?.\nscript: cmd /c ver\n")).toEqual([]);
  });

  it("现役 `.cnb.yml` 自己就是干净的（这条判据必须真判过那份文件）", () => {
    const text = readPipelineConfig(ROOT);
    expect(text, "读不到仓库根的 .cnb.yml —— 扫描面指错了地方").not.toBeNull();
    expect(ps7OnlySyntaxInProbe(text ?? "")).toEqual([]);
  });
});

describe("环境前提：解释器版本下限（低于下限时没有任何一步会红）", () => {
  it("下限只有一处定义，且与它的话术对得上", () => {
    expect(PYTHON_MIN_TEXT).toBe("3.10");
    /* ISSUE #2197 起，下限的**唯一定义**就是本文件 import 的 PYTHON_MIN_VERSION；
     * setup-comfy-cli-venv.mjs 必须引用它（不许另抄一份数字），.ps1 薄壳不再写数字。 */
    const venv = read("scripts/setup-comfy-cli-venv.mjs");
    expect(
      venv.includes("PYTHON_MIN_VERSION"),
      "setup-comfy-cli-venv.mjs 必须引用 PYTHON_MIN_VERSION（下限唯一出处）",
    ).toBe(true);
    expect(
      venv.includes("3.10"),
      "setup-comfy-cli-venv.mjs 里不应另抄下限数字（引用 PYTHON_MIN_VERSION 即可）",
    ).toBe(false);
    const ps1 = read("scripts/setup-comfy-cli-venv.ps1");
    expect(ps1.includes("3.10"), "薄壳 .ps1 里也不许另抄下限数字").toBe(false);
  });

  it("三档取值分得开：达标 / 不达标 / 解析不出（「不知道」不是「不达标」）", () => {
    expect(pythonVersionMeetsFloor("Python 3.12.2")).toEqual({
      ok: true,
      triple: [3, 12, 2],
    });
    expect(pythonVersionMeetsFloor("Python 3.10.0").ok).toBe(true);
    expect(pythonVersionMeetsFloor("Python 3.9.13")).toEqual({
      ok: false,
      triple: [3, 9, 13],
    });
    expect(pythonVersionMeetsFloor("Python 2.7.18").ok).toBe(false);
    /* 解析不出时 `triple: null`，调用方据此**只记读数**（与 §13.6.4.1
     * 「拿不到测量 ≠ 测量结果是红的」同一口径）。 */
    expect(pythonVersionMeetsFloor("(没有输出)")).toEqual({
      ok: false,
      triple: null,
    });
    expect(parseVersionTriple("3")).toEqual([3, 0, 0]);
  });
});

describe("环境前提：判定面的两个方向（红了要红在「几秒就能问出来」的位置）", () => {
  /**
   * 一份「解释器达标、pnpm 起得来、配置干净、浏览器落点已就位」的注入面。
   * ⚠️ 浏览器那两格必须显式注入：缺省实现会读真落点、真发 HEAD —— 那样结论取决于这台机器出不出得去外网，
   * 成了一条看着绿、实际什么都没判的判据（本仓最反对的那一类）。
   */
  function greenPorts(overrides: Record<string, unknown> = {}) {
    return {
      root: ROOT,
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      browserPresentImpl: () => ({
        ok: true,
        out: "/落点/.../chrome-headless-shell",
      }),
      reachabilityImpl: () => [],
      ...silentPorts(),
      ...overrides,
    };
  }

  it("绿侧：前提齐 ⇒ 退 0", () => {
    expect(envProbe(greenPorts())).toBe(0);
  });

  it("红侧：解释器低于下限 ⇒ 非零退出", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      greenPorts({
        findPythonImpl: () => ({
          command: "python",
          path: null,
          version: "Python 3.9.13",
        }),
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("3.9.13");
    /* 话术里必须给**下一动作**（与 §13.5.3.5.1「红了要红在能指路的位置」同口径）。 */
    expect(lines.join("\n")).toContain("PATH");
  });

  it("红侧：`.cnb.yml` 里出现 host 认不了的语法 ⇒ 非零退出（且能指到那一行）", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      greenPorts({
        config: [
          "a:",
          "  - name: x",
          "    script: |",
          "      $a = (Get-Command w) ?.Source",
          "",
        ].join("\n"),
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    const said = lines.join("\n");
    expect(said).toContain("第 4 行");
    expect(said).toContain("?.`");
    /* 话术要指路（宿主是 5.1，替代写法是显式 `if`）—— 只说「语法错误」等于把
     * 下一动作又留给人猜。 */
    expect(said).toContain("if ($x)");
  });

  it("红侧：读不到配置也红（它判的就是那份配置，读不到 = 一条都没判）", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      greenPorts({
        config: null,
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(".cnb.yml");
  });

  it("读数：控制台输出编码非 UTF-8 时**只记读数**、点出下一动作，不退非零", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      greenPorts({
        readEncodingImpl: () => ({ codePage: 936, chcpRaw: "活动代码页: 936" }),
        log: (l: string) => lines.push(l),
      }),
    );
    expect(code, "编码不对只是日志难读，不是这一步的判据").toBe(0);
    const said = lines.join("\n");
    expect(said, "读数里没有代码页本身").toContain("936");
    /* 话术里必须给**下一动作**（与 §13.5.3.5.1「红了要红在能指路的位置」同口径）：
     * 只说「有乱码」等于把下一动作又留给人猜。 */
    expect(said).toContain("--apply");
  });

  it("读数：量不到代码页时也**不**退非零，且不当成「不合格」", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      greenPorts({
        readEncodingImpl: () => ({ codePage: null, chcpRaw: null }),
        log: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("没量到");
  });

  it("读数：已经是 UTF-8 时说的是「对齐」，不给下一动作（免得话术自相矛盾）", () => {
    const lines: Array<string> = [];
    envProbe(
      greenPorts({
        readEncodingImpl: () => ({
          codePage: 65_001,
          chcpRaw: "Active code page: 65001",
        }),
        log: (l: string) => lines.push(l),
      }),
    );
    const said = lines.join("\n");
    expect(said).toContain("65001");
    expect(said).not.toContain("--apply");
  });

  it("读数与判据分得开：探测失败 / 版本解析不出 / pnpm 探不到都**不**退非零", () => {
    expect(
      envProbe(greenPorts({ findPythonImpl: () => null })),
      "「没有解释器」归 Python 可用性 —— 本步不重复判它",
    ).toBe(0);
    expect(
      envProbe(
        greenPorts({
          findPythonImpl: () => ({
            command: "python",
            path: null,
            version: "(没有输出)",
          }),
        }),
      ),
      "版本解析不出 = 不知道，不是不达标",
    ).toBe(0);
    expect(
      envProbe(greenPorts({ runImpl: () => ({ ok: false, out: "" }) })),
      "裸名字起不来 pnpm 是「读数」（形态解析那一份归工具链自证）",
    ).toBe(0);
  });
});

describe("环境前提：浏览器那一格的前提（晚红的最后一格要提前问）", () => {
  /** 上面那一份的语义别名（浏览器落点已就位）。 */
  function basePorts(overrides: Record<string, unknown> = {}) {
    return {
      root: ROOT,
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      ...silentPorts(),
      ...overrides,
    };
  }

  it("落点上已经有那一件 ⇒ 退 0，且**一次网络探测都不发**", () => {
    let probed = 0;
    const code = envProbe(
      basePorts({
        browserPresentImpl: () => ({
          ok: true,
          out: "/pw/.../chrome-headless-shell",
        }),
        reachabilityImpl: () => {
          probed += 1;
          return [];
        },
      }),
    );
    expect(code).toBe(0);
    /* 这一条不是「省流量」——它是**这一格在断网时仍然绿**的依据：长期存在的机器上，
     * 浏览器一旦落地就一直在那儿，而这一趟根本不需要网络。 */
    expect(probed, "已有落点时不该去碰网（那会让它白红在一条本来不缺的链路上）").toBe(0);
  });

  it("落点空 + 全部下载根不可达 ⇒ 非零退出（这就是「别等三十分钟」那一格）", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      basePorts({
        browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
        /* 三态的形状是 `{url, root, verdict, ok}`：`root` 是**配置面**（人会照着它配
         * `PLAYWRIGHT_DOWNLOAD_HOST`），`url` 是**实测面**（拼了真资源路径的那个）——
         * 话术里点的是 `root`，因为「改哪一行」只有它答得出（ISSUE #1966）。 */
        reachabilityImpl: () => [
          {
            root: "https://cdn.playwright.dev",
            url: "https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
            verdict: "超时（8000ms 内没有响应）",
            ok: false,
          },
          {
            root: "https://cdn.npmmirror.com/binaries/playwright",
            url: "https://cdn.npmmirror.com/binaries/playwright/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
            verdict: "超时（8000ms 内没有响应）",
            ok: false,
          },
        ],
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    const said = lines.join("\n");
    /* 话术要带上**实测读数**（哪个根、什么结论），而不是又一句「网络不通」。 */
    expect(said).toContain("cdn.playwright.dev");
    expect(said).toContain("超时");
    /* 三条下一动作必须都在（前两条在人不在仓，第三条最省事）。 */
    expect(said).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(said).toContain("代理");
    expect(said).toContain("chromium-headless-shell");
  });

  it("落点空 + 至少一条根到得了 ⇒ 退 0（装得成就不该拦）", () => {
    const code = envProbe(
      basePorts({
        browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
        reachabilityImpl: () => [
          {
            root: "https://cdn.playwright.dev",
            url: "https://cdn.playwright.dev/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
            verdict: "超时（8000ms 内没有响应）",
            ok: false,
          },
          {
            root: "https://registry.npmmirror.com/-/binary/playwright",
            url: "https://registry.npmmirror.com/-/binary/playwright/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip",
            verdict: "HTTP 200",
            ok: true,
          },
        ],
      }),
    );
    expect(code).toBe(0);
  });

  it("给了 `PLAYWRIGHT_DOWNLOAD_HOST` 就**只量它**（与 `浏览器安装` 同一条语义）", () => {
    const seen: Array<Array<string> | undefined> = [];
    envProbe(
      basePorts({
        env: {
          PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright",
        },
        browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
        reachabilityImpl: ({ candidates }: { candidates?: Array<string> } = {}) => {
          seen.push(candidates);
          return [
            {
              root: "x",
              url: "x/builds/cft/T/win64/p.zip",
              verdict: "HTTP 200",
              ok: true,
            },
          ];
        },
      }),
    );
    expect(seen).toHaveLength(1);
    /* 给上了还去铺开四个候选 = 把 `playwrightDownloadRoots()` 那条判据降级成
     * 「多试一个根」，实测那会让读数撒谎（`cnb-g9d-1k515kvrq`）。 */
    expect(seen[0]).toEqual(["https://cdn.npmmirror.com/binaries/playwright"]);
  });

  it("探测本身出错 ⇒ **不**退非零（「不知道」不是「不达标」）", () => {
    const lines: Array<string> = [];
    const code = envProbe(
      basePorts({
        browserPresentImpl: () => {
          throw new Error("读落点炸了");
        },
        log: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("读落点炸了");
  });
});

describe("环境前提：浏览器那一格的两个消费者不许各写一份答案", () => {
  it("`ok` 的判据只认 HTTP 2xx/3xx（超时与 ENOTFOUND 都不算通）", () => {
    /* 这两档在打印里刻意分开（「连上了但不说话」vs「域名都解析不了」），
     * 但在**判**这一层它们同属「这一次到不了」—— 混进 `ok` 只会让判据骗人。 */
    expect(isReachableVerdict("HTTP 200")).toBe(true);
    expect(isReachableVerdict("HTTP 302")).toBe(true);
    expect(isReachableVerdict("HTTP 404")).toBe(false);
    expect(isReachableVerdict("HTTP 403")).toBe(false);
    expect(isReachableVerdict("超时（8000ms 内没有响应）")).toBe(false);
    expect(isReachableVerdict("ENOTFOUND：getaddrinfo ENOTFOUND x")).toBe(false);
    expect(isReachableVerdict("（子进程没有输出）")).toBe(false);
  });

  it("打印那一份与三态那一份**同源**（同一次探测的两种形态）", () => {
    /* 一次注入的探测喂进两边，断言「打印出来的行」与「三态的 url/结论」逐项对得上
     * —— 这条是防「两份实现会漂」的那一天（§12.12）。 */
    const probe = (url: string) => (url.includes("ok") ? "HTTP 200" : "超时（1ms）");
    const probeUrlOf = (root: string) => `${root}/builds/cft/T/win64/p.zip`;
    const candidates = ["https://a/ok", "https://b/dead"];
    const verdicts = playwrightReachabilityVerdicts({
      candidates,
      probe,
      probeUrlOf,
    });
    const lines = playwrightReachability({ candidates, probe, probeUrlOf });
    expect(verdicts.map((v) => v.ok)).toEqual([true, false]);
    for (const v of verdicts) {
      expect(lines.join("\n")).toContain(`${v.url} → ${v.verdict}`);
    }
    expect(playwrightReachabilityVerdicts({ candidates, probe, probeUrlOf })).toEqual(verdicts);
  });

  it("量的是**真资源**不是裸根：根回 4xx 而资源 2xx/3xx ⇒ 判通（ISSUE #1966）", () => {
    /* 那次误报的**回归判据**：`环境前提` 在 41 秒处红说「一个下载根都到不了」，而 `.cnb.yml` 配的根好着 ——
     * 根因是探测拿**裸根**去 HEAD（`cdn.npmmirror.com/binaries/playwright` 裸根 404、真资源 200；
     * `cdn.playwright.dev` 裸根 400、真资源 307）。所以钉两件事：探测打的是**带资源路径**的 URL，根自己的结论不参与 `ok`。 */
    const asked: Array<string> = [];
    const root = "https://cdn.npmmirror.com/binaries/playwright";
    const verdicts = playwrightReachabilityVerdicts({
      candidates: [root],
      probeUrlOf: (r) => `${r}/builds/cft/153.0.8010.12/win64/chrome-headless-shell-win64.zip`,
      probe: (url) => {
        asked.push(url);
        /* 裸根 404（现场读数），带资源路径 200 —— 判据只看后者。 */
        return url === root ? "HTTP 404" : "HTTP 200";
      },
    });
    expect(asked, "探测必须打到真资源 URL 上，不能打裸根").toHaveLength(1);
    const askedUrl = asked[0] ?? "";
    expect(askedUrl).not.toBe(root);
    expect(askedUrl.startsWith(root), "真资源 URL 必须建在这个根上").toBe(true);
    expect(
      askedUrl.includes("builds/cft/"),
      "真资源 URL 里要有 Playwright 的 CDN 路径形状（builds/cft/<版本>/<档>/<包>）",
    ).toBe(true);
    const first = verdicts[0];
    expect(first, "三态里必须有一条").toBeDefined();
    expect(first?.ok, "真资源通 ⇒ 这一格必须判通（这正是那次误报反过来的一格）").toBe(true);
    /* 两个面都要留：`root` 是配置面（人会照着配 PLAYWRIGHT_DOWNLOAD_HOST），
     * `url` 是实测面 —— 缺了 `root`，人对着一个资源路径不知道该改哪一行。 */
    expect(first?.root).toBe(root);
  });
});

describe("环境前提：流水线上真的在跑它，且排在最长的等待之前", () => {
  it("`COMFYAPP_CI_GATES` 里登记了它，且它排在 `GitHub 判决回读` 之前", () => {
    /* 2026-11-05 薄化后 PR 档不再装依赖（GA 的 `安装依赖` step 接管），原先「排在
     * `Install dependencies` 之前」的对象随之消失。仍然成立的语义是：这一格答的是
     * 「这台节点此刻能力够不够」，而 `GitHub 判决回读` 要等 45m —— 排在那后面等于把
     * 结论推到最后一刻，红了也没人来得及看。 */
    const order = registeredGateOrder(read(".cnb.yml"));
    expect(order.length, "解析不出 COMFYAPP_CI_GATES —— 键被删了？").toBeGreaterThan(0);
    const at = order.indexOf("环境前提");
    const waitAt = order.indexOf("GitHub 判决回读");
    expect(at, "`环境前提` 不在清单里 —— 那一步因此没有任何执行者").toBeGreaterThan(-1);
    expect(waitAt).toBeGreaterThan(-1);
    expect(
      at,
      "`环境前提` 必须排在 `GitHub 判决回读` 之前：前提结论要在 45m 的等待开始前给出",
    ).toBeLessThan(waitAt);
  });

  it("那一步点名的入口真的在盘上（脚本存在而配置没接上 = 这一步白写）", () => {
    const block = /^\s*-\s*name:\s*环境前提\s*$\r?\n\s*script:\s*(?<script>\S.*)$/m.exec(
      read(".cnb.yml"),
    )?.groups?.script;
    expect(block, "解析不出「环境前提」那一步的 script").toBeTruthy();
    const command = String(block).trim();
    /* ⚠️ 脚本那一行的开头**已经不一定**是 `node …`（2026-10-16 起每个 stage 前面挂 `[Console]::OutputEncoding=…`，
     * 外面还包着 `ci-cp936-exit.mjs`，`unwrapCp936()` 剥掉最后那一层 —— ISSUE #1977 的 CP936 出口：PowerShell 默认按
     * CP936 解 UTF-8 输出，中文日志在平台侧全是乱码）。所以判「这段命令点到哪个入口」，不是「是否从第一个字符起」。 */
    expect(
      command,
      "「环境前提」的脚本里没有给 PowerShell 设 UTF-8 输出编码 —— 平台日志会全是乱码",
    ).toContain("[Console]::OutputEncoding");
    const entry = /(?:^|;)\s*(?:node\s+)?(?<script>scripts\/[^\s;]+)/.exec(unwrapCp936(command))
      ?.groups?.script;
    expect(entry, `解析不出「环境前提」点名的入口：${command}`).toBe("scripts/ci-env-probe.mjs");
    expect(read(entry ?? "").length, "「环境前提」点名的入口不在盘上").toBeGreaterThan(0);
  });
});

/**
 * 「量的是**这一步会真用的那个根**」（ISSUE #1966，`cnb-ald-1k51g8dt9`）：旧判据问「某个根通不通」，而 `浏览器安装` 从同一个根下载却 120s 超时（0 字节）。
 * `PLAYWRIGHT_DOWNLOAD_HOST` 设在别步 `env` 上、本步看不到，但读得到配置，所以判配置里那一个根。摘 stage 块的解析是
 * `no-platform-ci-config.test.ts` 的 `stageBlock()` 的文本副本（那份 `.ts` 在装依赖前 import 不到）；这一组第一条对账它。
 */
describe("环境前提：浏览器那一格量的是「配置里那个根」（ISSUE #1966）", () => {
  /* 形状按**现役 `.cnb.yml`**：stage 项是**顶格锚点列表的直接子项**（恰好两空格），
   * 再由 `stages: *gates` 引用过去 —— 两份 `stageBlock` 都是按这个口径收口的，
   * 夹具换个缩进就变成在判另一件事（那已经不是这份配置的形状了）。 */
  const YML = [
    ".gates: &gates",
    "  - name: 环境前提",
    "    script: node scripts/ci-env-probe.mjs",
    `  - name: ${BROWSER_INSTALL_STAGE}`,
    "    script: node scripts/ci-toolchain-selfcheck.mjs --playwright-only",
    "    env:",
    '      PLAYWRIGHT_DOWNLOAD_HOST: "https://m/root"',
    '      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"',
    "    timeout: 20m",
    "",
  ].join("\n");

  it("摘 stage 块那一段与门禁判据**逐项同一份答案**", () => {
    for (const name of ["环境前提", BROWSER_INSTALL_STAGE]) {
      expect(stageBlockIn(YML, name), `两份 stageBlock 的文本副本漂了（${name}）`).toBe(
        stageBlockGate(YML, name),
      );
    }
    /* 两边都得**真的命中**（不然这条用例是空转）。 */
    expect(stageBlockIn(YML, BROWSER_INSTALL_STAGE)).not.toBeNull();
    expect(stageBlockIn(YML, "不存在的那一步")).toBeNull();
  });

  it("两份解析同一份答案：现役配置按**活的**形态对账，注释态回退拿夹具对账", () => {
    /* `stageBlockIn()` 从 ISSUE #1966 起活的不见就看注释态，那一支与 `.ts` 侧 `commentedStageBlock()` 必须同口径
     * （两份文本副本 + 一条对账判据）。现役 `.cnb.yml` 在 2026-10-16 换了题：两段注释原文被取消失效，所以活的那支
     * （`^ {2}-`）才是要对账的形态；注释态那支改拿夹具，靠现役配置出题会让用例随停用清单一起失效。 */
    const live = readPipelineConfig(ROOT) ?? "";
    /* 两格各代表一种形状：`每日浏览器安装` 带 `env:` 块，`每日安装依赖` 是
     * `script: |` 的多行体（2026-11-05 PR 档的安装格撤到 GA 后，第二个名字从
     * `Install dependencies` 换成每日档这一格。**换格不换判**：判的还是「两份解析同口径」）。 */
    for (const name of [BROWSER_INSTALL_STAGE, "每日安装依赖"]) {
      const active = stageBlockIn(live, name);
      expect(active, `${name} 解析不出内容`).toBeTruthy();
      expect(active, `活的形态下两份解析漂了（${name}）`).toBe(stageBlockGate(live, name));
    }
    const disabledFixture = [
      ".gates: &gates",
      `# - name: ${BROWSER_INSTALL_STAGE}`,
      "# script: node scripts/ci-toolchain-selfcheck.mjs --playwright-only",
      "# env:",
      '# PLAYWRIGHT_DOWNLOAD_HOST: "https://m/root"',
      "",
    ].join("\n");
    expect(
      stageBlockIn(disabledFixture, BROWSER_INSTALL_STAGE),
      "停用形态下两份解析漂了 —— 「配置里那个根」会量错对象",
    ).toBe(commentedStageBlock(disabledFixture, BROWSER_INSTALL_STAGE));
    expect(
      stageBlockIn(disabledFixture, BROWSER_INSTALL_STAGE),
      "停用形态解析不出内容（这一支是「停用期间也答得出配置里那个根」的全部依据）",
    ).toBeTruthy();
  });

  it("`env` 的取值去引号；找不到的键 / stage 回 `null`（那是「不知道」，不判红）", () => {
    expect(stageEnvValue(YML, BROWSER_INSTALL_STAGE, "PLAYWRIGHT_DOWNLOAD_HOST")).toBe(
      "https://m/root",
    );
    expect(
      stageEnvValue(YML, BROWSER_INSTALL_STAGE, "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT"),
    ).toBe("120000");
    expect(stageEnvValue(YML, BROWSER_INSTALL_STAGE, "没有这个键")).toBeNull();
    expect(stageEnvValue(YML, "没有这一步", "PLAYWRIGHT_DOWNLOAD_HOST")).toBeNull();
    /* 现役 `.cnb.yml` 里那一步真的配了它 —— 判据指着的那一行必须是**真的存在**的。
     * 名字取 `BROWSER_INSTALL_STAGE`（与被测实现同一个常量）：2026-10-19 那一格撤到
     * 每日档、名字加了前缀，判据与实现各写一份字符串就会在下次挪档时**同时指错** ——
     * 实现读不到根就退回量候选，判据却还在为「读到了」而绿。 */
    const live = readPipelineConfig(ROOT) ?? "";
    expect(
      stageEnvValue(live, BROWSER_INSTALL_STAGE, "PLAYWRIGHT_DOWNLOAD_HOST"),
      `现役 \`.cnb.yml\` 的 \`${BROWSER_INSTALL_STAGE}\` 没有 \`PLAYWRIGHT_DOWNLOAD_HOST\` —— ` +
        "这一组判据量不到任何东西",
    ).toMatch(/^https:\/\//);
  });

  it("配置里那个根取不回字节 ⇒ **当场红**，并点名该换哪一行", () => {
    const lines: Array<string> = [];
    const asked: Array<Array<string> | undefined> = [];
    const code = envProbe({
      root: ROOT,
      config: YML,
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
      reachabilityImpl: ({ candidates }: { candidates?: Array<string> } = {}) => {
        asked.push(candidates);
        return [
          {
            root: "https://m/root",
            url: "https://m/root/builds/cft/T/win64/p.zip",
            verdict: "超时（连上了但 0 字节，8000ms 内没有响应）",
            ok: false,
          },
        ];
      },
      log: String,
      logError: (l: string) => lines.push(l),
    });
    expect(
      asked[0],
      "量的不是配置里那一个根 —— 那这一步答的就是另一个问题（现场就是它绿的）",
    ).toEqual(["https://m/root"]);
    expect(code, "配置里那个根取不回字节，这一步却没红").toBe(1);
    const said = lines.join("\n");
    /* 话术要能指路：点名那个根、点名要改的那一行、点名剩下的出路。 */
    expect(said).toContain("https://m/root");
    expect(said).toContain("PLAYWRIGHT_DOWNLOAD_HOST");
    expect(said).toContain("chromium-headless-shell");
  });

  it("配置里那个根真取回了字节 ⇒ 退 0（绿要绿得住，不然这一步会天天挡人）", () => {
    const code = envProbe({
      root: ROOT,
      config: YML,
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
      reachabilityImpl: () => [
        {
          root: "https://m/root",
          url: "https://m/root/builds/cft/T/win64/p.zip",
          verdict: "HTTP 206（实收 15425 字节）",
          ok: true,
        },
      ],
      ...silentPorts(),
    });
    expect(code).toBe(0);
  });

  /**
   * 第三格：**配了一条这条路径根本不支持的路**（任务级 `image:`）。实测 `cnb-cqk-1k550gpp2`（PR #2003 首跑）：
   * `.cnb.yml` 给 `浏览器安装` 加了 `image: mcr.microsoft.com/playwright:v1.63.0-noble`，那一格 70 毫秒就红在
   * `Runner does not enable Docker`，脚本一行未执行、前面三十三步全绿。所以这种改动必须红在便宜的位置（装依赖前）。
   */
  describe("环境前提：`.cnb.yml` 里不许有 stage 带 `image:`（自托管起不来容器）", () => {
    const WITH_IMAGE = [
      ".gates: &gates",
      "  - name: 浏览器安装",
      "    image: mcr.microsoft.com/playwright:v1.63.0-noble",
      "    script: node scripts/ci-toolchain-selfcheck.mjs --playwright-only",
      "    env:",
      '      PLAYWRIGHT_DOWNLOAD_HOST: "https://m/root"',
      "    timeout: 20m",
      "  - name: 环境前提",
      "    script: node scripts/ci-env-probe.mjs",
      "",
    ].join("\n");

    it("`stagesWithImage()` 只认 stage 那一层，不把 `env:` 里的同名键算进来", () => {
      const fixture = [
        ".gates: &gates",
        "  - name: A",
        "    image: node:24",
        "    script: echo a",
        "  - name: B",
        "    script: echo b",
        "      env:",
        "        image: not-an-image-key",
        "    timeout: 5m",
        "",
      ].join("\n");
      expect(stagesWithImage(fixture)).toEqual(["A"]);
    });

    it("现役 `.cnb.yml` **一格都没有**（上一次加的两格已在 2026-10-17 撤掉）", () => {
      expect(stagesWithImage(readPipelineConfig(ROOT) ?? "")).toEqual([]);
    });

    it("配了 `image:` ⇒ 当场红，并点名那几格与「删掉那一行」这条下一动作", () => {
      const lines: Array<string> = [];
      const code = envProbe({
        root: ROOT,
        config: WITH_IMAGE,
        findPythonImpl: () => ({
          command: "python",
          path: null,
          version: "Python 3.12.2",
        }),
        runImpl: () => ({ ok: true, out: "12.4.1" }),
        browserPresentImpl: () => ({
          ok: true,
          out: "/pw/chrome-headless-shell",
        }),
        reachabilityImpl: () => [],
        log: String,
        logError: (l: string) => lines.push(l),
      });
      expect(code, "配置里有 stage 带 `image:`，这一步却没红").toBe(1);
      const said = lines.join("\n");
      /* 这里断的是**夹具自己那个 stage 名**被点名出来，不是「浏览器那一格叫什么」——
       * 上面那一处批量改常量时把它一起改了，红的是「期望 `每日浏览器安装`、实际打了
       * 夹具里写的 `浏览器安装`」。判的是「红话里要点名出事的那一格」，名字跟着夹具走。 */
      expect(said).toContain("浏览器安装");
      expect(said).toContain("Runner does not enable Docker");
      expect(said, "红要红在能指路的位置：说清下一动作是把那一行删掉").toContain("删掉");
    });

    it("不带 `image:` 的同一份配置 ⇒ 这一条不拦（绿要绿得住）", () => {
      const code = envProbe({
        root: ROOT,
        config: WITH_IMAGE.replace("    image: mcr.microsoft.com/playwright:v1.63.0-noble\n", ""),
        findPythonImpl: () => ({
          command: "python",
          path: null,
          version: "Python 3.12.2",
        }),
        runImpl: () => ({ ok: true, out: "12.4.1" }),
        browserPresentImpl: () => ({
          ok: true,
          out: "/pw/chrome-headless-shell",
        }),
        reachabilityImpl: () => [],
        ...silentPorts(),
      });
      expect(code).toBe(0);
    });
  });

  it("配置里**没**给根时照旧铺开候选那一族（那时「出得去这类域吗」才是要答的问题）", () => {
    const asked: Array<Array<string> | undefined> = [];
    envProbe({
      root: ROOT,
      config: [
        ".gates: &gates",
        "  - name: 浏览器安装",
        "    script: node scripts/ci-toolchain-selfcheck.mjs --playwright-only",
        "",
      ].join("\n"),
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      browserPresentImpl: () => ({ ok: false, out: "落点根读不到：/pw" }),
      reachabilityImpl: ({ candidates }: { candidates?: Array<string> } = {}) => {
        asked.push(candidates);
        return [
          {
            root: "https://x",
            url: "https://x/builds/cft/T/win64/p.zip",
            verdict: "HTTP 206（实收 1 字节）",
            ok: true,
          },
        ];
      },
      ...silentPorts(),
    });
    expect(asked[0], "没配根时反而把候选面收窄了").toBeUndefined();
  });
});
