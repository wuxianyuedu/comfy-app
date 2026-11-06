## Fixed

- **GA 桌包档 `package-desktop.yml` 整份 workflow 解析失败（`Startup failure`），侧边栏退化成显示文件路径**（#3276，报障见 #3258）。上一轮 #3263 把 `COMFY_CI_TOOLS_ROOT` 写死盘符换成 `runner.temp` 时放进了 **workflow 级顶层 `env:`**：`runner` context 只在 step 级（`env` / `with` / `run`）可用，顶层 `env:` 求值时平台直接判 `Unrecognized named-value: 'runner'`（L61），文件作废 ⇒ job 不派生、`name: Package desktop (mirror)` 读不出来、定时与 `workflow_dispatch` 都跑不起来。修法是把这个变量下沉到唯一消费它的「桌包工具预置」step 级 `env:`（仍取 `${{ runner.temp }}\ci-tools`，与上方 `actions/cache` 的 `path` 同源），顶层 `env:` 只留三条字面量。不叠补丁、不改工具预置链与打包链一字。
- 修完形态读数：顶层 `${{ }}` 归零、`name:` 能被平台读到、YAML 与 `check-ci-yaml` 可解析；`tests/ci-yaml-parse` / `tests/no-platform-ci-config` / `tests/ci-actionlint` 共 67 条相关用例绿。真 actionlint 二进制不在本仓常驻根（判据零网络纪律 ⇒ 退 2「没判」，不是绿），GA 真机是否跑绿仍由镜像侧下一次定时/手点验。
