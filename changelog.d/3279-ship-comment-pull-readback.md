## Fixed

- `ship --comment` 对 **PR** 落点写读数时：平台其实写上了，回读却复用了单子评论区的
  `--sort -created`——`pulls list-pull-comments` 不支持它 ⇒ 命令不存在，写成功也念成
  「回读没跑起来」退 2，人会去重跑造成重复评论（#3279）。回读尾巴按 route 拼开：
  PR 侧不带 `--sort`（分页读即可，回读本来就是逐字找最新那条），单子侧照旧。
