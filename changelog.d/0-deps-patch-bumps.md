## Changed

- **补丁级依赖升级（11 项，全部落在同大版本内的最新补丁）**：`next` 16.3.2 → 16.3.5
  （`eslint-config-next` / `@next/bundle-analyzer` 随之 16.3.4 → 16.3.5）、`prettier`
  3.9.6 → 3.9.8、`tsx` 4.23.13 → 4.23.15、`postcss` 8.5.26 → 8.5.28、`jsdom`
  30.0.1 → 30.1.0、`@testing-library/dom` 10.4.1 → 10.4.2、`@testing-library/user-event`
  14.6.6 → 14.6.7、`@tauri-apps/cli` 2.11.4 → 2.11.5。改动面只有 `package.json` 的
  声明下限与 `pnpm-lock.yaml`，无源码改动。`prettier` 升版后全库格式仍过棘轮
  （`node scripts/check-format.cjs` 报 0 个未过文件，白名单外的文件一个都没变脏）；
  `jsdom` 30.1 的解出值满足其 `engines` 要求（`.nvmrc` 的 Node 24 线）。

- **`tests/lockfile-diff.test.ts` 不再把 `next` 的 specifier 抄成字面量**：该用例要验的是
  「解析器能从真 lockfile 里读出根 importer 的声明与解析版本」，而写死的 `^16.3.2`
  会让**每一次依赖升级**都打红一个与升级本身无关的用例（判据漂移到了「当前钉着哪一版」
  上）。期望值改为读 `package.json` 的声明逐字比对，断言反而更强——锁的是「lockfile 与
  package.json 一致」，而不是「等于某个历史值」。
