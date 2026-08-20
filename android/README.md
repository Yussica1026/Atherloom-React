# Atherloom React Android

这个 Android 客户端使用独立包名 `app.atherloom.react`，不会覆盖旧版 Atherloom。APK 内置 React/Vite 构建产物，通过原生网络桥连接现有 FastAPI 后端。

首次打开后，在“设置 → 后端连接”填写后端根地址，例如：

```text
http://192.168.1.20:8876
```

手机与后端必须能够互相访问。局域网测试时，FastAPI 需要监听 `0.0.0.0`，Windows 防火墙也需要允许相应端口。公网使用应配置 HTTPS。

本地构建前先在仓库根目录运行 `npm run build`，再进入 `android` 执行 `gradle :app:assembleDebug`。没有 Android SDK 的电脑可以使用仓库内 GitHub Actions 构建。

当前首个 APK 使用 Android Debug 签名，适合安装测试；后续正式更新前需要配置固定发布签名。
