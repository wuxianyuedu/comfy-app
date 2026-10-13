## Fixed

- **假 comfy-cli 执行器的跨平台形状判据在 Windows 开发机上必然红一条（ISSUE #1767 的另外一半）**：
  `e2e/support/fake-comfyui-executor-env.mjs` 里「包在不在」用宿主 `path.join` 拼，
  而它的用例注入 `platform: "linux"` 并按 POSIX 路径比对 `exists` —— 于是在 win32 宿主上
  拼出 `\fake\fake-comfyui\comfy_cli`、`exists` 永不命中，那条「两个平台同一条形状」的判据
  实际只在 POSIX 上自证过。同一个 describe 里另一条用例又按**宿主** `path.delimiter` 断 PYTHONPATH
  的分隔符，两条对「分隔符归谁管」的要求相反 ⇒ 在 Windows 上恰好红一条、在 Linux 上全绿，
  谁都不会把它当成缺陷去查。
  改法是把口径统一成「这条 env 是为**哪个平台**的 Python 拼的」：实现按注入的 `platform`
  选 `path.win32` / `path.posix`（join 与 delimiter 同一个来源），那条用例的期望值随之写成 `:`。
  **生产形态逐字不变**：真实调用方不传 `platform`，缺省即 `process.platform`，
  win32 拿到 `path.win32` 与 `;`、POSIX 拿到 `path.posix` 与 `:`，与改前同一实现。
  本机（win32）实测：改前该文件 10 过 1 红，改后 11 全过。
