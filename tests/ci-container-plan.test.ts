/**
 * 「永远不用平台池，只用自托管节点上的容器」（ISSUE #1993）是三件合取：`runner.namespace: group`（漏掉就
 * 静默回落计费平台池）、`runner.tags` 非空且不是平台池标签（节点离线会改派，`.cnb.yml` 头注第 5 条）、
 * 容器在 Job 级 `image:`（stage 级答 `Runner does not enable Docker.`）；每格须挂同一份浏览器落点，反向控制靠改坏夹具复算。
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
const fixture = (over: { namespace?: string; tags?: Array<string> } = {}) =>
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
    expect(runnerShape(fixture({ namespace: "public" })).verdict).toBe("platform-pool");
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
    const text = ["# 以下是反例，别照抄：", "#        namespace: public", fixture()].join("\n");
    expect(runnerShape(text).verdict).toBe("self-hosted");
  });
});

/**
 * 容器格夹具（Job 层挂 `image:`），现役配置无容器格（`image:` 被答 Docker 未启用，§13.5.3.4.1.5），保证「桥」判据有执行对象、不空转。
 * @param {{ bridge?: string[] }} [over] 哪几格挂卷（缺省 = 两格都挂同一份落点）
 * @returns {string}
 */
const containerFixture = ({ bridge }: { bridge?: Array<string> } = {}) => {
  const vols = bridge ?? ["A", "B"];
  const one = (name: string) => [
    `        - name: ${name}`,
    `          script: echo ${name}`,
    "          jobs:",
    `            - name: ${name}`,
    "              image: mcr.microsoft.com/playwright:v1.63.0-noble",
    ...(vols.includes(name)
      ? ["              volumes:", `                - comfyapp-ms-playwright:${BROWSERS_VOLUME}`]
      : []),
    "",
  ];
  return ["master:", "  pull_request:", "    - stages:", ...one("A"), ...one("B")].join("\n");
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
    expect(p.bridge, `没挂 ${BROWSERS_VOLUME} 的格：${p.missing.join(" / ")}`).toBe("complete");
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
    expect(containerStages(text)).toEqual([{ name: "Y", image: "node:24", volumes: ["v:/data"] }]);
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
    /* 真踩到的坑：`image:` 下移到 Job 时 `env:`/`timeout:` 缩进没跟着走 —— YAML 把
       `PLAYWRIGHT_DOWNLOAD_HOST` 读成 stage 项自己的键（`env:` 变 null），配置仍合法而 `env` 空了。
       判据全按行读原文、本地无 YAML 解析器，故按层级判：`timeout` 属项自己（`- name:` 深一层），
       `env` 的键与项自己的键同层；更浅的都落在 stage 层，YAML 会把 `env` 读成 null。 */
    /** @type {string[]} */
    const offenders = [];
    /* 名单按「配置里真的带 `env:` 的格」取，不写死：2026-10-19 撤掉 PR 那格的 `E2E 关键流程`、
       再把 `浏览器安装` 挪到每日档后，PR 上已无带 `env:` 的格，写死的名字会以「找不到 stage 项」
       红在一个**正确**的配置上（假红，同「解析失败伪装成结论」族）；故留显式名单 + 下方
       「名单里的格必须在配置里取到块」的前置断言。 */
    for (const name of ["每日浏览器安装", "每日全量E2E"]) {
      const block = stageBlock(CNB, name);
      expect(block, `找不到 stage 项：${name}`).toBeTruthy();
      /** 当前项的键应该在的缩进（`- name:` 缩进 + 2）。 */
      /** @type {number | null} */
      let keyIndent = null;
      /** `env:` 的键应该在的缩进；`null` = 不在 `env` 里。 */
      /** @type {number | null} */
      let envKeyIndent = null;
      for (const raw of String(block).split("\n")) {
        if (raw.trim() === "") {
          continue;
        }
        const indent = raw.length - raw.trimStart().length;
        const body = raw.trim();
        /* stage 块尾会带上**下一个 stage 之前那一段注释**（`stageBlock()` 只按缩进与
         * 顶格键收尾），它不属于本项的任何一层 —— 跳过，否则深度判据会对着注释开火。 */
        if (body.startsWith("#")) {
          continue;
        }
        if (body.startsWith("- name:")) {
          keyIndent = indent + 2;
          envKeyIndent = null;
          continue;
        }
        if (keyIndent === null) {
          continue;
        }
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
          if (indent >= envKeyIndent) {
            continue;
          }
          offenders.push(`${name}：${body.slice(0, 30)}（缩进 ${indent}，该在 ${envKeyIndent}）`);
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
          if (indent !== keyIndent) {
            offenders.push(`${name}：env:（缩进 ${indent}，该在 ${keyIndent}）`);
          }
          continue;
        }
        /* 不在 `env` 里：`timeout` 该在 `keyIndent` 那一层。 */
        if (body.startsWith("timeout:") && indent !== keyIndent) {
          offenders.push(`${name}：${body}`);
        }
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
    expect(stripYamlComments('a: "x#y" # 行尾\n# 整行\nb: 1')).toEqual(['a: "x#y" ', "", "b: 1"]);
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
    if (plan(CNB).containers.length > 0) {
      expect(lines.join("\n")).toContain(BROWSERS_VOLUME);
    }
    const broken = describePlan(containerFixture({ bridge: [] }));
    expect(broken.join("\n")).toContain("重下");
    /* 点名到格：两格都要出现，不是一句「有格没挂卷」。 */
    expect(broken.join("\n")).toContain("A");
    expect(broken.join("\n")).toContain("B");
  });
});
