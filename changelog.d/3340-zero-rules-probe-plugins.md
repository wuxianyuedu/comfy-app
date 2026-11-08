## Fixed

- 「已清零 oxlint 规则集」探针缺 `plugins:` 声明，`import/*` 与 `react/*` 共 4 条
  在探针里静默空转——「0 命中」里它们是「没扫」而不是「扫过 0」（#3340）。
  探针配置改为从 ZERO_RULES 推导 `plugins:`（清单涉及的内建族全集，替换语义下
  漏一个挤一个；jsPlugins 的名字不进该数组），新增配置自检：清单里出现未注册的
  namespace 当场退 2，同类空转不再可能静默。契约负控补 import / react 族夹具
  （旧负控只挑生效族，空转抓不住自己）。接电后复扫全仓清掉 2 处真实存量：
  `use-feedback-dialog.ts` 的重复 import 与 `check-reformat-only.cjs` 的
  require 后缺空行。
