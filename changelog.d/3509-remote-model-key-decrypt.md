## Fixed

- **远端模型保存的 API Key 读出来是密文**（#3509）。写侧一直用 `encryptLlmKey`
  落盘，但 `RemoteModelRepository.list()` / `findByName()` 读侧没有解密，
  运行时把 `enc:v1:…` 当成密钥发给上游 ⇒ 配了密钥的远端模型仍被 401。
  现在读侧统一解密（历史明文原样透传），并按名解析、整份清单保存两条路径都走同一份。
