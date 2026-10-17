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
 * 3. 「用容器」落在**任务级 `image:`**（`pipeline.docker.image` 在自托管上不生效）。
 *
 * ## 还有一件比上面三件更容易漏的：桥
 *
 * 任务级 `image:` 每一格都是**一个新容器**。不挂卷，「上一格下的 120 MiB」到下一格
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
  stripYamlComments,
} from "../scripts/ci-container-plan.mjs";
import { platformImageStages, ROOT } from "../scripts/ci-image-identity.mjs";

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
    "        - name: B",
    "          image: node:24",
    "          script: echo b",
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

describe("容器格：卷声明是「别每格重下 120 MiB」的唯一执行者", () => {
  it("现役 `.cnb.yml`：每一格容器格都挂着同一个浏览器落点（桥是通的）", () => {
    const p = plan(CNB);
    expect(p.containers.length).toBeGreaterThan(0);
    expect(
      p.bridge,
      `没挂 ${BROWSERS_VOLUME} 的格：${p.missing.join(" / ")}`,
    ).toBe("complete");
    expect(p.missing).toEqual([]);
  });

  it("删掉某一格的 `volumes:` ⇒ 桥断，且点名是哪一格（反向复算）", () => {
    const broken = CNB.replace(
      /    volumes:\n      - comfyapp-ms-playwright:\/ms-playwright\n/g,
      "",
    );
    expect(broken).not.toBe(CNB);
    const p = plan(broken);
    expect(p.bridge).toBe("broken");
    expect(p.missing.length).toBe(p.containers.length);
  });

  it("只给一格挂卷 ⇒ 另一格仍点名（半通不算通）", () => {
    const lines = CNB.split("\n");
    const first = lines.findIndex((l) => l.includes("comfyapp-ms-playwright"));
    expect(first).toBeGreaterThan(0);
    /* 删掉第二处卷声明（从它往前找到那个 `volumes:` 起删三行）。 */
    const second = lines.findIndex(
      (l, i) => i > first + 2 && l.includes("comfyapp-ms-playwright"),
    );
    expect(second).toBeGreaterThan(first);
    lines.splice(second - 1, 2);
    expect(plan(lines.join("\n")).bridge).toBe("broken");
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
      "          image: node:24",
      "          env:",
      "            image: still-not",
      "          volumes:",
      "            - v:/data",
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
      "          volumes:",
      "            - vol:/ms-playwright",
      "          image: node:24",
      "",
    ].join("\n");
    expect(containerStages(text)).toEqual([
      { name: "X", image: "node:24", volumes: ["vol:/ms-playwright"] },
    ]);
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
    expect(lines.join("\n")).toContain(BROWSERS_VOLUME);
    const broken = describePlan(
      CNB.replace(
        /    volumes:\n      - comfyapp-ms-playwright:\/ms-playwright\n/g,
        "",
      ),
    );
    expect(broken.join("\n")).toContain("重下");
    expect(broken.join("\n")).toContain("浏览器安装");
  });
});
