## Changed

- **两件工作区读数判据退役（ISSUE #3480，#3474 评估）**：`ci-workspace-probe.mjs`
  （工作区复用读数，结论「每次新建目录」已在 §13.5.35 retired 段留档）与
  `ci-workspace-provenance.mjs`（工作区出处，push 树级校验档退役后无对象）+ 两份
  用例 —— #3478 / #3504 两轮迁移后 CNB 侧再无会写工作区的判据，两份脚本只是无调用
  孤儿（import 图核实零外部引用）。`.cnb.yml` 两段退役叙事改为简短退役注，
  `no-platform-ci-config` retired 段的「脚本留盘」改「已随 #3480 退役」；
  规范 §13.5.38 记账。引用面里的注释引用是惯用法出处指引、不构成 import，
  随各文件下次触碰顺手更新。
