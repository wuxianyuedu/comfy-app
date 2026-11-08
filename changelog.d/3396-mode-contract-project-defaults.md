## Added

- 模式契约的第二种保存方式（#3396）：「保存为项目默认（跟代码走）」把与推导有
  差异的契约写进入库的 `src/lib/workshop/mode-contract-defaults.json`（按模式整份
  替换推导，未显式覆盖的模式继续跟随推导演进），只有开发检出可用（判据与壳的
  形态判据同口径：检出里有 `scripts/dev-launcher.mjs`）；正式包只有原有的
  「保存模式契约」（只落本机 `data/`，不入库）。
