## Fixed

**Code scanning high 的正则 / 消毒五项（#8 / #9 / #10 / #11 / #17）**：

- #8 `scripts/check-changelog-versions.cjs`：HTML 注释改成单遍线性剥除（`<!--` 到
  `-->`，未闭合的丢到行尾）。旧写法 `replaceAll(/<!--[\s\S]*?-->/g, "")` 删掉一段
  后仍可能留下新的 `<!--`；新实现只做「注释里的 #N 不算」这一件确定的事，并补了
  「未闭合注释」的回归用例。
- #9 `scripts/ci-image-plan.mjs`：`checkCommands()` 不再剪掉 Playwright 路径里的
  `*` —— 旧实现产出 `test -x /root/.cache/ms-playwright/chromium_headless_shell-`
  （残缺路径、实际不存在），与 `selfCheckRunLines()` 和 `docs/guides/ci-node-image.md`
  期望的完整 glob 不一致；这是真实 bug，不是纯消毒告警。
- #10 `tests/ci-incremental-gates.test.ts`：探针生成改 `replaceAll("*", "probe")`，
  多星号 glob 不再把 `*` 留在探针路径里。
- #11 `tests/splash-log-scroll-follow.test.ts`：内联 `<script>` 提取加 `i` 标志，
  大写 `<SCRIPT>` 同样命中；当前页面只有小写标签，行为不变。
- #17 `scripts/ui-primitives-rules-p67-p86.cjs`：P81 标签属性段按「首字符互斥」拆成
  引号串 / 单引号串 / 花括号表达式 / 其余单字符四支，去掉旧式 `[^>]` 与引号串的重叠
  回溯（`<A """"…` 的指数形态）。差分实测：全 `src/` 的 P81 计数旧 12 → 新 12、
  逐文件零差异；病态输入 4 万个 `"` 的新正则匹配耗时 < 1ms。
