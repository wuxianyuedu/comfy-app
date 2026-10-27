## Fixed

缓存槽的键不再把 `package.json` 的 `scripts` 当依赖面：键面与复制面共用
`normalizePackageJson`（摘 `scripts` + 固定缩进），「只加一行脚本」不再换键、
不再白付一次整装（#2330 之后那一跑实测 `Done in 3m 41.4s`，而两份输入副本 sha256 全等）。

⚠️ 一次性代价：键的口径变了，现存所有槽键全部失效，下一跑各自冷装一次。
