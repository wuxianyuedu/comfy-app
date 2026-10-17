/**
 * 「永远不用平台池，只用自托管节点上的容器」这条决定的判据（ISSUE #1993）。
 *
 * ## 它守的是哪一格
 *
 * 用户在 ISSUE 里把话说死了：**平台池永远不用，容器用自托管节点上的**。这句话在
 * 配置里不是**一个键**，而是三件的合取 —— 而三件里任一件写错，症状都是「看起来对、
 * 其实跑在别处」：
 *
 * 1. `runner.namespace: group`（自托管）—— 漏掉会**静默回落计费的平台池**；
 * 2. `runner.tags` 非空、且**不含平台池标签** —— 自托管节点离线/满载时平台会自动改派，
 *    而「其他可用节点」就是平台池（`.cnb.yml` 头注第 5 条）；
 * 3. 「用容器」落在 **Job 级 `image:`**（`pipeline.docker.image` 在自托管上不生效；
 *    而 **stage 级 `image:`** 不是「被忽略」，是整格 99ms 就答
 *    `Runner does not enable Docker.` —— 见下面「写错层」那一组用例）。
 *
 * ## 还有一件比上面三件更容易漏的：桥
 *
 * Job 级 `image:` 每一格都是**一个新容器**。不挂卷，「上一格下的 120 MiB」到下一格
 * 就不存在了 ⇒ 每跑一遍重取一遍。那是**不报错、只是慢**的形态 —— 与本仓最贵的那类
 * 红同族（环境是隐形的）。所以本文件判的第二件事是：**每一格容器格都挂着同一份
 * 浏览器落点**。
 *
 * ## 判据的形状：正向 + 反向
 *
 * 每条正向判据都配一条**改坏夹具**的复算（摘掉 `namespace`、换回平台池标签、删卷），
 * 否则「清单对不对」会退化成「文档读了两遍」（本仓 §12.18 那条口径）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BROWSERS_VOLUME,
  containerStages,
  describePlan,
  parseVolume,
  plan,
  PLATFORM_POOL_TAG_PREFIX,
  runnerShape,
  SELF_HOSTED_TAG,
  stageLevelImages,
  stripYamlComments,
} from "../scripts/ci-container-plan.mjs";
import { platformImageStages, ROOT } from "../scripts/ci-image-identity.mjs";
import { stageBlock } from "./no-platform-ci-config.test";

const CNB = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");

/** 一份最小的、形态合法的流水线夹具（用来做「改坏了会红」的反向复算）。 */
const fixture = (over: { namespace?: string; tags?: string[] } = {}) =>
  [
    "master:",
    "  pull_request:",
    "    - runner:",
    `        namespace: ${over.namespace ?? "group"}`,
    "        tags:",
    ...(over.tags ?? [SELF_HOSTED_TAG]).map((t) => `          - ${t}`),
    "      stages:",
    "        - name: A",
    "          script: echo a",
    /* B 那一格是**容器格的标准形态**：stage 项只留 `name` + `jobs:`，`image:` /
     * `volumes:` / `timeout` 全在 Job 那一层（ISSUE #1993 的实测形态，见
     * `.cnb.yml` 里那两格的注释）。 */
    "        - name: B",
    "          jobs:",
    "            - name: B",
    "              image: node:24",
    "              script: echo b",
    "",
  ].join("\n");

describe("runner 形态：自托管与平台池只差一行，而那一行会静默花钱", () => {
  it("现役 `.cnb.yml` 是自托管（`namespace: group` + 非空 tags + 不含平台池标签）", () => {
    expect(runnerShape(CNB)).toEqual({
      namespace: "group",
      tags: [SELF_HOSTED_TAG],
      verdict: "self-hosted",
    });
  });

  it("漏掉 `namespace: group` ⇒ 平台池（那正是静默回落的那一形态）", () => {
    expect(runnerShape(fixture({ namespace: "public" })).verdict).toBe(
      "platform-pool",
    );
  });

  it("`runner:` 整块缺掉 ⇒ missing（「没写」与「写明平台池」是两件事）", () => {
    /* 两档分开的理由：`missing` 是**配置里没有这一格**（下一动作 = 补上），
     * `platform-pool` 是**写明去了池子**（下一动作 = 这是用户的禁止项，要改回来）。
     * 判据对两者的处置不同（见下一条「现役配置」），混成一档就分不出该改哪边。 */
    expect(runnerShape("master:\n  push:\n    - stages: []\n")).toEqual({
      namespace: null,
      tags: [],
      verdict: "missing",
    });
  });

  it("带上平台池标签 ⇒ 平台池，哪怕 namespace 还写着 group", () => {
    /* 自托管节点离线/满载时平台会自动改派，而「其他可用节点」就是平台池 ——
     * 所以只写 namespace 不够，标签必须**排除**池子那一族。 */
    expect(
      runnerShape(
        fixture({
          tags: [SELF_HOSTED_TAG, `${PLATFORM_POOL_TAG_PREFIX}amd64`],
        }),
      ).verdict,
    ).toBe("platform-pool");
  });

  it("注释里的 `namespace:` 不算（本仓注释量极大，一段注释里出现这个键是常态）", () => {
    const text = [
      "# 以下是反例，别照抄：",
      "#        namespace: public",
      fixture(),
    ].join("\n");
    expect(runnerShape(text).verdict).toBe("self-hosted");
  });
});

/**
 * 两格**容器格**的夹具（`- name:` + `jobs:` + 同名 Job，Job 那一层挂 `image:`）。
 *
 * 它替的是「现役 `.cnb.yml` 里那两格」这个角色：现役配置此刻**没有**容器格
 * （节点没开 Docker，写 `image:` 会在起格之前被平台答 `Runner does not enable
 * Docker.`，见 §13.5.3.4.1.5），而「桥通不通」这条判据仍然要有执行对象 —— 否则
 * 它会在配置变得没有容器格那天，悄悄变成一条恒绿的空转判据。
 *
 * @param {{ bridge?: string[] }} [over] 哪几格挂卷（缺省 = 两格都挂同一份落点）
 * @returns {string}
 */
const containerFixture = ({ bridge }: { bridge?: string[] } = {}) => {
  const vols = bridge ?? ["A", "B"];
  const one = (name: string) => [
    `        - name: ${name}`,
    "          script: echo " + name,
    "          jobs:",
    `            - name: ${name}`,
    "              image: mcr.microsoft.com/playwright:v1.63.0-noble",
    ...(vols.includes(name)
      ? [
          "              volumes:",
          `                - comfyapp-ms-playwright:${BROWSERS_VOLUME}`,
        ]
      : []),
    "",
  ];
  return [
    "master:",
    "  pull_request:",
    "    - stages:",
    ...one("A"),
    ...one("B"),
  ].join("\n");
};

describe("容器格：卷声明是「别每格重下 120 MiB」的唯一执行者", () => {
  it("现役 `.cnb.yml`：有容器格时每一格都挂着同一个浏览器落点（此刻没有容器格 ⇒ `none`）", () => {
    /* 两态都由**同一份现役配置**判出来：有容器格 ⇒ 桥必须通（`complete` 且 `missing`
     * 为空）；没有容器格 ⇒ `none`（不是 `broken`，也不是「桥修好了」）。后者是这一档
     * 此刻的真形态 —— 两格都跑在宿主机上，同一块盘，没有「跨容器」这回事。 */
    const p = plan(CNB);
    if (p.containers.length === 0) {
      expect(
        p.bridge,
        "没有容器格时 `bridge` 必须是 `none` —— `complete` 会让人以为桥在起作用",
      ).toBe("none");
      expect(p.missing).toEqual([]);
      return;
    }
    expect(
      p.bridge,
      `没挂 ${BROWSERS_VOLUME} 的格：${p.missing.join(" / ")}`,
    ).toBe("complete");
    expect(p.missing).toEqual([]);
  });

  it("两格挂同一份落点 ⇒ 桥通；一格都不挂 ⇒ 断，且点名是哪几格（反向复算）", () => {
    expect(plan(containerFixture()).bridge).toBe("complete");
    const p = plan(containerFixture({ bridge: [] }));
    expect(p.containers.length).toBe(2);
    expect(p.bridge).toBe("broken");
    expect(p.missing).toEqual(["A", "B"]);
  });

  it("只给一格挂卷 ⇒ 另一格仍点名（半通不算通）", () => {
    const p = plan(containerFixture({ bridge: ["A"] }));
    expect(p.bridge).toBe("broken");
    expect(p.missing).toEqual(["B"]);
  });

  it("容器格与 `镜像身份` 那份读数是同一批格（两个出口，一份事实）", () => {
    const fromPlan = containerStages(CNB).map((s) => s.name);
    const fromReadout = platformImageStages(CNB).map((s) => s.name);
    expect(fromPlan).toEqual(fromReadout);
  });

  it("`env:` 里的 `image:` / `volumes:` 不算项自己的键（同名键不算第二份声明）", () => {
    const text = [
      "master:",
      "  push:",
      "    - stages:",
      "        - name: X",
      "          script: echo x",
      "          env:",
      "            image: not-an-image-key",
      "            volumes: not-a-volume-key",
      "        - name: Y",
      "          jobs:",
      "            - name: Y",
      "              image: node:24",
      "              env:",
      "                image: still-not",
      "              volumes:",
      "                - v:/data",
      "",
    ].join("\n");
    expect(containerStages(text)).toEqual([
      { name: "Y", image: "node:24", volumes: ["v:/data"] },
    ]);
  });

  it("`volumes:` 写在 `image:` 之前也认（键的先后不该改变判定）", () => {
    const text = [
      "master:",
      "  push:",
      "    - stages:",
      "        - name: X",
      "          jobs:",
      "            - name: X",
      "              volumes:",
      "                - vol:/ms-playwright",
      "              image: node:24",
      "",
    ].join("\n");
    expect(containerStages(text)).toEqual([
      { name: "X", image: "node:24", volumes: ["vol:/ms-playwright"] },
    ]);
  });

  it("`image:` 写在 **stage** 上 ⇒ 那不是容器格，而是**写错层**（整格起不来）", () => {
    /* 现场（`cnb-0ka-1k5517hk3`）：上一版把 `image:` 写在 stage 级，平台 99ms
     * 就答 `Runner does not enable Docker.` —— 容器都没起。两层语义不同，所以
     * 两件事**分两个出口**：`containerStages()` 不认它，`stageLevelImages()` 点名它。 */
    const text = [
      "master:",
      "  push:",
      "    - stages:",
      "        - name: X",
      "          image: node:24",
      "          volumes:",
      "            - vol:/ms-playwright",
      "          script: echo x",
      "",
    ].join("\n");
    expect(containerStages(text)).toEqual([]);
    expect(stageLevelImages(text)).toEqual([{ name: "X", image: "node:24" }]);
  });

  it("现役 `.cnb.yml` 没有写错层的 `image:`（这一条是那次 99ms 红的回归判据）", () => {
    /* 这条判据的存在理由只有一个：**写错层不报错，整格起不来**。它是本仓唯一
     * 一次「配置解析期就被平台挡下」的形态，而本地任何一条判据此前都看不见它。 */
    expect(
      stageLevelImages(CNB),
      "这些格的 `image:` 写在 stage 上 —— 自托管上整格会以「Runner does not enable Docker.」失败，" +
        "要拆成 `jobs:` + Job 级 `image:`（见 .cnb.yml 那两格的注释）",
    ).toEqual([]);
  });

  it("容器格的 `env` / `timeout` 真的在 Job 那一层（不是「看着缩进对、其实挂在 stage 上」）", () => {
    /* 这条判据是一次**真踩到的坑**：把 `image:` 下移到 Job 时，`env:` 下面的键与
     * `timeout:` 的缩进没跟着走 —— YAML 于是把 `PLAYWRIGHT_DOWNLOAD_HOST` 之类读成
     * **stage 项自己的键**（`env:` 变成 `null`），配置仍然合法、`env` 却空了。
     *
     * 而 `.cnb.yml` 里没有任何 YAML 解析器跑（判据全按行读原文），所以这种「缩进
     * 半途而废」在本地可以全绿。这里按**层级**判：`timeout` 必须是项自己的键
     * （`- name:` 深一层），`env` 的键必须与项自己的键**同层**（`env:` 深一层、它的键
     * 再深一层，正好落在那里）—— 更浅的都在 stage 那一层，YAML 会把 `env` 读成 null。 */
    /** @type {string[]} */
    const offenders = [];
    for (const name of ["浏览器安装", "E2E 关键流程"]) {
      const block = stageBlock(CNB, name);
      expect(block, `找不到 stage 项：${name}`).toBeTruthy();
      /** 当前项的键应该在的缩进（`- name:` 缩进 + 2）。 */
      /** @type {number | null} */
      let keyIndent = null;
      /** `env:` 的键应该在的缩进；`null` = 不在 `env` 里。 */
      /** @type {number | null} */
      let envKeyIndent = null;
      for (const raw of String(block).split("\n")) {
        if (raw.trim() === "") continue;
        const indent = raw.length - raw.trimStart().length;
        const body = raw.trim();
        /* stage 块尾会带上**下一个 stage 之前那一段注释**（`stageBlock()` 只按缩进与
         * 顶格键收尾），它不属于本项的任何一层 —— 跳过，否则深度判据会对着注释开火。 */
        if (body.startsWith("#")) continue;
        if (body.startsWith("- name:")) {
          keyIndent = indent + 2;
          envKeyIndent = null;
          continue;
        }
        if (keyIndent === null) continue;
        /* 列表项（`volumes:` 的 `- <卷名>:<路径>`）：它比 `volumes:` 深一层，
         * 是**合法**的更深层键 —— 只有当 `env` 正在收键时越过它才算挂错层。 */
        if (body.startsWith("- ")) {
          if (envKeyIndent !== null && indent <= envKeyIndent) {
            offenders.push(`${name}：${body}`);
            envKeyIndent = null;
          }
          continue;
        }
        /* `env:` 正在收键：比 `env:` 还浅（`indent < envKeyIndent`）就是跑到了项上面
         * —— `env` 会被读成 null，那几个键挂到 stage 那一层，而本判据要抓的就是这一次。
         * ⚠️ 这一支必须排在「比项自己的键更浅 ⇒ 结束」**之前**：挂错层时它们的缩进
         * 恰好等于项自己那一层，先判「结束」会悄悄放过去。 */
        if (envKeyIndent !== null) {
          if (indent >= envKeyIndent) continue;
          offenders.push(
            `${name}：${body.slice(0, 30)}（缩进 ${indent}，该在 ${envKeyIndent}）`,
          );
          envKeyIndent = null;
          continue;
        }
        /* 比项自己的键更浅 ⇒ 这一项结束了。 */
        if (indent < keyIndent) {
          keyIndent = null;
          continue;
        }
        if (body.startsWith("env:")) {
          /* `env:` 的键与项自己的键**同一层**（这是 YAML 的形态：`env:` 深一层，
           * 它的键再深一层 —— 正好落在项自己的键那一层上）。 */
          envKeyIndent = keyIndent;
          if (indent !== keyIndent)
            offenders.push(
              `${name}：env:（缩进 ${indent}，该在 ${keyIndent}）`,
            );
          continue;
        }
        /* 不在 `env` 里：`timeout` 该在 `keyIndent` 那一层。 */
        if (body.startsWith("timeout:") && indent !== keyIndent)
          offenders.push(`${name}：${body}`);
      }
    }
    expect(
      offenders,
      "这些键没挂在它那一项的正确层级上 —— YAML 会把它们读成 stage 项自己的键（`env` 变 null），" +
        "而配置文件仍然合法、本地判据（按行读）也全绿",
    ).toEqual([]);
  });

  it("写错层时读数把它排在**最前**（更重的结论不许排在更轻的后面）", () => {
    /* 夹具而不是现役配置：现役配置此刻**没有**容器格，从它身上摘 `jobs:` 什么都摘不到。
     * 而这一条判的是「一个更重的结论排在更轻的前面」这条顺序，与配置有没有容器格无关。 */
    const wrong = [
      "master:",
      "  pull_request:",
      "    - runner:",
      "        namespace: group",
      "        tags:",
      `          - ${SELF_HOSTED_TAG}`,
      "      stages:",
      "        - name: 浏览器安装",
      "          image: node:24",
      "          script: echo x",
      "",
    ].join("\n");
    const lines = describePlan(wrong);
    expect(lines[1]).toContain("stage");
    expect(lines[1]).toContain("浏览器安装");
  });
});

describe("解析器的两处细节：注释与卷写法", () => {
  it("剥整行注释与行尾注释，但引号里的 `#` 不剥", () => {
    expect(stripYamlComments('a: "x#y" # 行尾\n# 整行\nb: 1')).toEqual([
      'a: "x#y" ',
      "",
      "b: 1",
    ]);
  });

  it("卷声明只认 `<卷名>:<容器内路径>` 那一形态（宿主路径不是本仓的口径）", () => {
    expect(parseVolume("comfyapp-ms-playwright:/ms-playwright")).toEqual({
      source: "comfyapp-ms-playwright",
      target: "/ms-playwright",
    });
    expect(parseVolume("/host/path")).toBeNull();
    expect(parseVolume(":/only-target")).toBeNull();
  });

  it("读数是人读的三行，且断桥那一档**点名**（不是一句「有问题」）", () => {
    const lines = describePlan(CNB);
    expect(lines[0]).toContain("self-hosted");
    if (plan(CNB).containers.length > 0)
      expect(lines.join("\n")).toContain(BROWSERS_VOLUME);
    const broken = describePlan(containerFixture({ bridge: [] }));
    expect(broken.join("\n")).toContain("重下");
    /* 点名到格：两格都要出现，不是一句「有格没挂卷」。 */
    expect(broken.join("\n")).toContain("A");
    expect(broken.join("\n")).toContain("B");
  });
});
