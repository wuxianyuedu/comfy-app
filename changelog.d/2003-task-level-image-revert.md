## Fixed

- **撤掉两格的任务级 `image:`：这台节点上它 70 毫秒就红**（ISSUE #1993 续 / PR #2003
  的首跑读数 `cnb-cqk-1k550gpp2`）：

  ```
  浏览器安装  error [70ms]
  Runner does not enable Docker.
  ```

  脚本一行都没执行，前面三十三步全绿。也就是说「没有 docker」是**整条执行面**的，
  不只 `pipeline.docker.image` 那一层：自托管节点上没有 docker daemon，平台连「起容器」
  这一步都做不到，带 `image:` 的 stage **必然**红。上一版给 `浏览器安装` / `E2E 关键流程`
  加 `image:` 的那条推理（依据官方 `script-vs-plugin.md` 讲平台池的那句「指定 `image` 的
  脚本任务在独立容器中执行」）是**从两句真话推出来的第三句**，而它没有文档背书 ——
  只有实测能答，实测说不行。

  于是 `浏览器安装` / `E2E 关键流程` 回到宿主机直跑：浏览器靠本步自己的三条通道
  （落点已有 ⇒ 秒级返回 / 分片自取 + 续传 / 才交给 `playwright install`），长期出路仍是
  `scripts/ci-image-plan.mjs` 那份节点镜像计划。

- **连带撤掉 `PLAYWRIGHT_BROWSERS_PATH: /ms-playwright`**：那一行是**给容器**配的
  （镜像把浏览器装在那儿）。带 `image:` 的 stage 既然必然红，它剩下的唯一效果是把落点
  判据指到宿主上一个不存在的目录 —— 「明明装过」与「一件都没有」在日志里逐字同形。
  宿主机上不给覆盖就对了，落点按 `playwrightBrowsersRoot()` 自己推。

## Added

- **`环境前提` 多判一格：`.cnb.yml` 里不许有 stage 带 `image:`**（`scripts/ci-env-probe.mjs`
  的 `stagesWithImage()`）。它跑在 `Install dependencies` 之前、代价是零，把「有人又加了
  一格」这件事拦在最便宜的位置 —— 而不是让它在整条流水线倒数第二步以一句英语收场。

- **判据改成「一格都不带」**（`tests/ci-image-identity.test.ts` 的「容器格」一组）：
  允许带 `image:` 的名单是**空数组**，多一格就红；并补一条**非空转**用例（喂一份真带
  `image:` 的配置，断言解析器认得出来、且与名单不等）—— 名单为空时「解析器永远返回空」
  与「配置真的干净」在结果上无法区分。同一组还判 `.cnb.yml` 里没有
  `PLAYWRIGHT_BROWSERS_PATH` 覆盖。

## Docs

- **规范 §13.5.3.4.1.3 改写**：从「『没有 docker』≠『没有容器』」改成「任务级 `image:`
  同样是红的：整条流水线一格容器都不起」，带上那次 70ms 的读数原文与「两句官方文档都真、
  结论却错」的推理链复盘。
- **规范 §13.5.3.4.1 与 §13.5.21 两张表同步**：前者的「三条出路」收成一条
  （装好工具的现成环境只能靠节点镜像或当场装），后者补一行
  「任务级 `image:` ⇒ 红」。`scripts/ci-image-identity.mjs` / `scripts/ci-image-plan.mjs` /
  `docs/guides/ci-node-image.md` 的头注一并订正。
