## Fixed

- **`pnpm check:toolchain` 报「命令起不来（可执行形态/权限不对） —— EINVAL（未发现可回退形态）」，命令是 `.tools\pnpm\<ver>\bin\pnpm.CMD`**：corepack 装到该目录的 pnpm 是 `.CMD` + `.ps1` 并排（旁边没有可用的无扩展名 shim）。两个缺陷叠加 —— ① 形态判据把 `.cmd` / `.bat` 与 `.ps1` 同判为通用文本脚本，而「非 shebang」直接认作可用（没真起一次），于是 `.CMD` 一路通过被选中；② 真跑起来是 `EINVAL`（批处理既不是 PE 镜像、也没有 Node 认的 shebang），而回退逻辑**只服务 shebang**，`.CMD` 走到这里没有回退，提示于是说「未发现可回退形态」—— 而 `pnpm.ps1` 就摆在同一个目录里。现在批处理单列一类形态（`@echo` / `@setlocal` 起头判形态），Windows 上直接走同目录 `.ps1` 回退（经 PowerShell 宿主）而不再真起一次；回退同胞名按「去掉自身扩展名再拼 `.ps1`」求（`pnpm.CMD` → `pnpm.ps1`）。shebang 不按形态一刀切（机器上真配好文件关联时仍可用），POSIX 不受批处理短路影响。
