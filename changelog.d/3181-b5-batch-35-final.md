## Changed

- **oxlint B5 清账收官（子批35）**（ISSUE #3181 的最后一个批次）：末份文件
  `tests/oxlint-jsplugin-rules.test.ts` 从 `typescript/no-unsafe-type-assertion`
  的文件级豁免里摘除，3 处存量就地修掉（两份 oxlint 配置与 oxlint JSON 报告改
  形状守卫）。台账末行改「已清」，**B5 归零：608/608 份全部摘账，B2–B5 四个
  批次全部完成**。本批前置：#3440 的对拍修复先行落地（PR #3756），末份文件
  才能不带在途改动地收尾。`pnpm run lint` 0 诊断、`tsc --noEmit` 绿、
  该文件用例 2/2 绿。

  Closes #3181
