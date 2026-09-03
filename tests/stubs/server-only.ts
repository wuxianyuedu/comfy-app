/**
 * tests/stubs/server-only.ts — vitest 环境的 `server-only` 空实现。
 *
 * `server-only` 包在「非 React Server Component」环境（vitest node 环境）
 * 会直接抛错。源码里数据访问层（db / repository*）都 `import "server-only"`
 * 作为客户端误引的硬约束，但单测需要能在 node 环境加载这些模块——
 * vitest.config.ts 把 `server-only` alias 到本空实现即可两全。
 */
export {};
