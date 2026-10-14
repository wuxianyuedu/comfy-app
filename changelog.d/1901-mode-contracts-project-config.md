## Changed

- **模式契约改成入库的项目配置**（`config/workshop-mode-contracts.json`）：此前登记在
  `data/workshop-mode-contracts.json` —— 那是本机运行期目录（`.gitignore` 忽略、并被分发
  产物按「私有输入」剥离），于是在一台机器上配好的契约到不了别的检出，桌包里更是静默跑成
  内置默认。现在它落在仓库根的 `config/`（新增目录）：随 git 走、每个检出用同一份，桌包也
  随包带出去（`build-desktop.mjs` 的 `§入库配置` 显式拷贝 + `check-standalone-contents.cjs`
  的 `REQUIRED_CONFIG_FILES` 两层都数）。与含密钥的 `data/`（LLM 主密钥、整机设置、API
  通道）划清：那一类**刻意**不入库、不随包。保存提示改为「已保存到 config/…（项目配置，
  随 git 走）—— 提交这个文件后，别的检出才拿得到同一份配置」；老检出升级不丢配置
  （新文件不在时回落读 `data/` 那份，读路径只读不搬）；写失败不再静默（抛出带路径的错误，
  桌包安装目录不可写时就靠它）。
