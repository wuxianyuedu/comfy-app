/**
 * tests/stubs/server-only.ts — vitest 环境的 `server-only` 空实现。
 * `server-only` 在非 RSC 环境（vitest node）会直接抛错，而数据访问层（db / repository*）都 `import "server-only"` 作为客户端误引的硬约束。
 * vitest.config.ts 把 `server-only` alias 到本空实现，单测才能在 node 环境加载这些模块（两全）。
 */
export {};
