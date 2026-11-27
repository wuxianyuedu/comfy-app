## Added
- `pnpm dns:check [--json]` 与 `pnpm deps:install-ipv4 -- <pnpm 子命令>`（#5189）：前者只读打印 registry 域名 lookup 读数；后者先 `deps:guard` 再带绝对路径的 IPv4 preload 执行 pnpm，两个子进程退码原样透传。
