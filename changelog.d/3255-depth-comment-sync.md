## Changed

- GA 镜像档 `pr-gate.yml` 的 `fixed-structural-tests` 一格回到浅检出（`fetch-depth: 2`）：
  全量核过固定清单，已无依赖 git 全历史的判据 —— 已删基线名单改读仓内台账（#3245）、
  唯一读真历史的用例自带浅克隆 skip。同批把散在四处（外加台账 note）的
  「depth=2 浅检出」过时注释统一成「判据与检出深度解耦」，不再绑定具体深度数值（#3255）。
