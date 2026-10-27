## Changed

- **缓存槽那三档表补上第四档「键变」的节点读数**（`docs/standards/13-提交与-code-review.md`
  §13.5.3.4.3）：2026-10-24 自然发生了两次真改依赖面（#2280 升依赖、#2298 改 `next.config.js`），
  两次都走 `install-into-slot`（`Done in 1m 3.7s` / `Done in 2m 25.8s`），槽根下**新键出现、
  旧键不被写**，淘汰落在另一个更旧的键上；三个旧键到 2026-10-27 仍在盘上。⇒ 键变 = 新开一个键 +
  旧键按「超配额且过 26h TTL」最后淘汰；这两跑打印 `超配额但留着 0 个`，别把「旧键留下」读成
  「TTL 保护了它」。
- 同节把「`pnpm-workspace.yaml` 里被摘掉的 `scripts`」订正为 `package.json` —— 摘 `scripts`
  的只有复制面里的 `package.json`。同批量到的「scripts-only 也换键」与只读读数 off-by-one
  已分别立案 #2489 / #2490。
