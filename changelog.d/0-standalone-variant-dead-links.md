## Fixed

- **`pnpm build` 在 win32 上过不去第 2 步（`standalone-link-repair`）** —— 那一步把
  「重建后仍不可跟随」的链接一律当缺件退 1，但其中有一类**在 win32 上必然出现**：
  pnpm 给 optionalDependencies 的**每一个平台变体**都建链接，却只安装本平台那一份。
  本机实测 4 条（`@libsql/darwin-arm64` / `linux-arm-gnueabihf` / `linux-arm-musleabihf` /
  `linux-x64-musl`）的目标不存在 —— 而运行期用的是本平台那份
  （`@libsql/win32-x64-msvc`，目标确实在）。判据缺了这一档时，本机 `pnpm build`
  在第 2 步就退 1，**后面 4 步（数产物 / 体积账 / 冒烟）全跑不到** ——
  本机连完整构建链都跑不完。
  现在分三档报告：真缺件仍退 1；「非本平台变体死链」不阻断但逐条点名。
  判法不认平台名单：看 `.pnpm` 下有没有同包的**其它**变体目录、且那份的实体在。
  顺带把「产物目录在不在」与「某条链接的目标在不在」拆成两个注入口 ——
  共用时「目标不在」会顺带把产物目录也判成不存在，于是这一步直接跳过，
  读数上像「没发现问题」，而真实情况是产物根本没被检查。
  规范见 `docs/standards/launch-and-build.md` §7.5.1；判据自证
  `tests/standalone-link-repair.test.ts`（新增三组：变体死链不阻断 / 真缺件仍阻断 /
  同包变体探测的真文件系统那一层）。
  （ISSUE #2158）
