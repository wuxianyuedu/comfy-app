## Added

- **平台侧流水线随自托管节点重新启用（`.cnb.yml` 回来了）**：根组织接入了自托管
  Windows 构建节点（标签 `win`），而官方文档写明自定义 Runner「构建脚本直接运行在
  宿主机上……`runner.cpus` 配置无效，**不参与核时计费**」——#623 那条「160 核时/月
  用不起」的全部推理都建立在计费上，前提没了，结论随之反转。挂在 `pull_request`
  （全套门禁）与 `push`（master 合并形态复核）两个事件上。

  **反转的是一整套取舍，不是贴一段 yaml**，与本配置同批落地的还有四条：

  1. **形态有了判据**：`tests/no-platform-ci-config.test.ts` 从「仓库根不许有 CI 配置」
     翻成「**要么没有，要么必须是自托管 + 已登记的那一份**」——顶层必须是
     `分支: { 事件: [流水线] }`（#1229 那份顶层直接写 `stages:` 的配置从不触发、
     静默失效），必须有 `runner.namespace: group` 与非空 `tags`（漏掉会静默回落到
     **计费的**平台池），必须挂 `pull_request` 与 `push`；`scripts/doc-facts.cjs`
     把 `.cnb.yml` 登记回 path 类事实，规范锚点句同步改写。判据没撤，换了个方向。
  2. **与旧的 Linux 平台池配置是两套形态**：自托管**没有 docker**
     （`pipeline.docker.image` 不生效），所以工具链必须预装在宿主机上——配置第一步
     是「工具链自证」（`cmd /c ver` + git/node/pnpm 版本），把「环境该有什么」从注释
     变成会红的断言；脚本语言是 **PowerShell** 而不是 POSIX sh；不声明 `runner.cpus`
     （无效）；不走上报插件那条路（宿主机上不生效）。
  3. **代价换了个位置**：节点离线 / 被禁用 / 达上限时平台**会自动改派**，而这一档的
     「其他节点」就是计费平台池——**最坏情况是悄悄花回核时且不报错**。所以 `push` 侧
     仍然只留一条合并形态复核、不重跑全套，理由从「省额度」变成「省一遍没有新信息的
     运行」；诊断出口（看构建列表标签、看第一步输出）写进规范 §13.5.3.3。
  4. **本地那一层一条都不减**：平台侧取自源分支（「不可信事件」）且跑的是**另一份清单**
     （全量档 + 核心档，钩子走 `--staged` 增量），因此本地钩子与 §13.5.4 的按需召唤
     照旧——平台侧回来不取消它们，正如按需召唤也替代不了平台侧。

## Fixed

- **`tests/app-port-vectors-timeout-classification.test.ts` 有两条判据只在 POSIX 上成立、
  却从来没有守卫**：它们要写一个 `#!/bin/sh` 的假命令再 `chmod` 出执行位，而 Windows 上
  libuv 不解析 shebang、`chmodSync` 也不存执行位 —— 于是探到的是 `missing`，红的形状与
  「判据写坏了」逐字同形。它们在 Linux 平台池上一直绿，所以没人发现；换成自托管 Windows
  节点之后当场红了。加 `needsPosixExec` 别名并经 `tests/conditional-skip-registry.test.ts`
  登记（档位 `platform`），把「这两条在 Windows 上其实没跑过」变成一句读得出来的事实。
  判据本身跨平台（`probeCommand` 对「不存在」与「非零退出」的分支不依赖执行位），
  Windows 侧缺的是可注入的等价形态。

## Changed

- **`.cnb.yml` 的「工具链自证」补上 `python -V`**：Python 是门禁链的真实依赖
  （`check-app-port-vectors.cjs` 要调 `.py` 做四语言比对，几处用例用它验 zip 包），
  而缺了它的表现是**静默少判**而不是报错 —— `check-app-port-vectors.cjs` 会把这一侧
  归进 `missing` 档、「以这台机器探测不到 Python 的名义」退出比对。放在第一步正面回答，
  代价是几秒，换来的是不必在 vitest 跑完四十分钟之后从几条看不懂的失败里反推。
