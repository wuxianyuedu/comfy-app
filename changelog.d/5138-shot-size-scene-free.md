## Fixed

- 图生视频首帧与潜空间宽高不一致（#5138）：分场景的 1k 档让出图侧与视频侧算出两组
  multiple。单镜画幅改用场景无关档（比例 + 1M + 倍数 64，`shotSizeFor` / `NATIVE_SHOT_SIZE`），
  成片画幅仍按 `FILM_COMPOSE_SIZE` 合成并逐镜归一化；树形 run 的逐镜生图用同一份画幅。
