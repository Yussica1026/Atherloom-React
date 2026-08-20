# Atherloom React Android

这个 Android 客户端使用独立包名 `app.atherloom.react`，不会覆盖旧版 Atherloom。APK 内置 React/Vite 构建产物，通过原生网络桥连接现有 FastAPI 后端。

首次打开后，在“设置 → 后端连接”填写后端根地址，例如：

```text
http://192.168.1.20:8876
```

手机与后端必须能够互相访问。局域网测试时，FastAPI 需要监听 `0.0.0.0`，Windows 防火墙也需要允许相应端口。公网使用应配置 HTTPS。

本地构建前先在仓库根目录运行 `npm run build`，再进入 `android` 执行 `gradle :app:assembleDebug`。没有 Android SDK 的电脑可以使用仓库内 GitHub Actions 构建。

长期版使用现有 Atherloom 固定发布证书，通过私有 GitHub Actions Secrets 注入签名材料。工作流会在上传前使用 `apksigner` 核对证书 SHA-256 指纹，不匹配就终止发布。

签名材料不得进入仓库。构建需要四项私有 Secrets：`ATHERLOOM_KEYSTORE_BASE64`、`ATHERLOOM_STORE_PASSWORD`、`ATHERLOOM_KEY_ALIAS`、`ATHERLOOM_KEY_PASSWORD`。

如果已经安装 `v0.1.0-react` Debug 测试版，需要先卸载测试版，再安装首个固定签名版。之后只要应用包名与签名原件保持不变，后续 APK 就能覆盖升级并保留应用数据。
