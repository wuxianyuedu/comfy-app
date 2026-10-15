## Fixed

- `scripts/check-app-port-vectors.cjs` 的 Python 可用性探测从三态改四态：新增
  `present-but-nonzero`（命令起来了、只是 `--version` 非零退出）。此前它被静默归进
  `missing`，于是这一侧以「这台机器探测不到 python3 / python」的名义永久退出四侧比对 ——
  那是一句事实错误的话，且给出的下一步动作（去装 Python）也是错的。三种「没取证」现在各有
  各的话术与下一步：超时 ⇒ 当场再取一遍；`ENOENT` / `EACCES` ⇒ 去装 Python；形态不符 ⇒
  换探测方式（Windows 的 Microsoft Store 占位别名、`py` 启动器不带 `-3` 都属这一档）。
  回归用例见 `tests/app-port-vectors-timeout-classification.test.ts`。
