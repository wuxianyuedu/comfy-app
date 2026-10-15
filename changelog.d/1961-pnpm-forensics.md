## Added

- **`工具链自证` 报「pnpm 不可用」时打一份取证**（ISSUE #1961）：那一格报过之后
  **两次猜测**都没修好它 —— 先以为是「谁解析这个名字」（加 cmd.exe 退路，仍红），
  再以为是「扩展名候选不全」（`findPnpm` 补 `.PS1` 与同目录回退，仍红）。
  而**历史上**同一次构建里 `Install dependencies` 用 `pnpm install` 跑得通，
  两条读数放在一起，「缺一条候选规则」解释不通。

  缺的是一条**读数**：这一步看到的 `PATH` 是什么、逐条命中在哪些目录上。
  人答得出来而这里答不出来，只可能是执行上下文不同（服务账号读机器 PATH、
  子进程继承的 PATH 不是同一份）。现在失败分支会打 `pnpmForensics()`
  （与 `pythonForensics` 同形：PATH 逐条 + `pnpm*` 各目录命中），
  成功即静默 —— 把这件事变成可读的事实，而不是再猜一轮。

  ⚠️ 它按**目标平台**的分隔符切 PATH，不按宿主的 `path.delimiter`
  （`ci-toolchain-python.mjs` 的 `pathDrives` 记过这一格：本机是 `:` 而 Windows 是
  `;`，拿宿主的切会把 `C:\Windows` 拆成 `C` 与 `\Windows`）—— 这条判据的 `platform`
  可注入，单测正是在 POSIX 上判 Windows 的形态，判据自己会红。
