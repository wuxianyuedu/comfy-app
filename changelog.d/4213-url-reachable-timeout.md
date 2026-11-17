## Fixed

- **壳的 TCP 探测加 1s 超时**（#4213）：`url_reachable` 与就绪看护线程里的
  `TcpStream::connect` 不设超时——端口被防火墙 DROP 时按系统默认 SYN 重试阻塞
  十几秒，而前者跑在**主线程**的页面加载回调里（整个壳冻结）。收口成 `tcp_probe`
  （`connect_timeout` 1s，解析取首个地址），两个调用点共用。
