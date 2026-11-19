## Fixed

- `tests/no-platform-ci-config.test.ts` 的 R2「类锁 key 不许带变量」原先一刀切判 `includes("$")`，把 `.cnb.yml` 里按 sha 分锁的 `ga-verdict-$CNB_COMMIT`（#3924）一起判红 —— 于是**干净 master 上这条恒红**，从 master 分出的每个提交都被它拦一下。现在改成「用两组必然不同的取值各代一次，两代相同才判红」：判的是**退不退化**，不是有没有 `$`。反向自检同时补了正控（不参与分锁的变量仍被抓）与负控（按 sha 分锁不许判红）（#3982）。
