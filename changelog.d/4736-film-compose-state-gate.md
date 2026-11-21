## Fixed

- **影片 GENERATING 期间不能再经 API 抢跑合成**（ISSUE #4736）：`film.compose` 此前对任何
  状态一律放行，而 composeFilm 抢不到合成锁就静默让位——镜头尚未全部完成时直调会拿
  「部分成片」过早 markDone 定格成 DONE；此后剩余镜头完成的自动合成被 DONE 挡住、手动
  再点也静默 no-op，部分成片被永久定格，没有任何 API 出口重合成。
  - compose 路由改为**只放行 FAILED**（「重新合成」是文档承诺的恢复出口，#4251），其余
    状态逐个返回可行动的错误文案（PARSING / GENERATING / COMPOSING / DONE / CANCELLED），
    不再冒充 ok:true。
  - `claimComposing` 的排除集**刻意不加 GENERATING**：监看循环在全部镜头落定后、影片仍是
    GENERATING 时直调 composeFilm 完成自动合成——排除集加它会掐断自动合成主链路。闸门
    收在路由层，不影响该链路（已在代码注释留痕，防止后续按单面描述「补齐」）。
