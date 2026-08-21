from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


NATIVE_MOCK = r"""
(() => {
  const providers = [];
  let chatCount = 0;
  const publicProvider = value => {
    const copy = {...value, has_api_key: Boolean(value.api_key)};
    delete copy.api_key;
    return copy;
  };
  window.AtherloomNative = {
    getBackendUrl: () => "",
    setBackendUrl: () => JSON.stringify({ok: true}),
    getClipboard: () => "sk-from-android-clipboard",
    setClipboard: value => JSON.stringify({ok: true, length: String(value || "").length}),
    listProviders: () => JSON.stringify(providers.map(publicProvider)),
    saveProvider: raw => {
      const value = JSON.parse(raw || "{}");
      const current = providers.find(item => item.id === value.id || item.id === value.source_provider_id);
      const saved = {...current, ...value, id: value.id || value.source_provider_id || `provider-${providers.length + 1}`};
      if (!saved.api_key && current?.api_key) saved.api_key = current.api_key;
      const index = providers.findIndex(item => item.id === saved.id);
      if (index >= 0) providers[index] = saved; else providers.push(saved);
      return JSON.stringify(publicProvider(saved));
    },
    deleteProvider: id => {
      const index = providers.findIndex(item => item.id === id);
      if (index >= 0) providers.splice(index, 1);
      return JSON.stringify({ok: true});
    },
    providerOperationAsync: (operation, raw, callbackId) => {
      const request = JSON.parse(raw || "{}");
      let body;
      if (operation === "models") body = {models: ["mock-model", "mock-model-pro"]};
      else if (operation === "test") body = {ok: true, message: "连接成功，模型已响应"};
      else {
        chatCount += 1;
        body = {
          content: chatCount === 1
            ? '这是第一版回答。<questions>[{"question":"你想继续哪个方向？","options":["继续细化","换个角度"]}]</questions>'
            : `这是第 ${chatCount} 版回答。`,
          reasoning: "已完成本机测试思考",
          model: request.model || "mock-model-pro",
          usage: {prompt_tokens: 10, completion_tokens: 8, total_tokens: 18},
        };
      }
      setTimeout(() => window.AtherloomNativeRequest(callbackId, JSON.stringify({ok: true, status: 200, body: JSON.stringify(body)})), 20);
    },
    providerChatStream: (raw, callbackId) => {
      const request = JSON.parse(raw || "{}");
      chatCount += 1;
      const content = chatCount === 1
        ? '这是第一版回答。<questions>[{"question":"你想继续哪个方向？","options":["继续细化","换个角度"]}]</questions>'
        : `这是第 ${chatCount} 版回答。`;
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({reasoning_delta: "已完成本机测试思考"})), 10);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({delta: content.slice(0, 8)})), 20);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({delta: content.slice(8)})), 30);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({done: true, model: request.model || "mock-model-pro", usage: {prompt_tokens: 10, completion_tokens: 8, total_tokens: 18}})), 40);
    },
    saveFile: (name, mime, base64, callbackId) => {
      const cancelled = Boolean(window.__cancelNextSave);
      window.__cancelNextSave = false;
      setTimeout(() => window.AtherloomNativeFile(callbackId, JSON.stringify(cancelled ? {ok: false, error: "已取消保存"} : {ok: true, message: `已保存 ${name}`})), 10);
    },
    cancelStream: () => {},
  };
})();
"""


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.add_init_script(NATIVE_MOCK)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")

        page.get_by_role("button", name="打开设置").click()
        page.get_by_role("button", name="添加第一条线路").click()
        page.get_by_label("显示名称").fill("本机测试线路")
        page.get_by_label("官方或反代 Base URL").fill("https://api.example.com/v1")
        page.get_by_role("button", name="粘贴").click()
        page.get_by_label("当前默认模型").fill("mock-model")
        page.get_by_role("button", name="拉取模型").click()
        page.get_by_text("已读取 2 个模型", exact=False).wait_for()
        page.get_by_label("选择已拉取的模型").select_option("mock-model-pro")
        page.get_by_role("button", name="测试当前模型").click()
        page.get_by_text("连接成功，模型已响应", exact=True).wait_for()
        page.get_by_role("button", name="保存线路与模型").click()
        page.get_by_text("线路已保存", exact=True).wait_for()

        page.get_by_role("button", name="人格指令").click()
        page.get_by_label("助手名称").fill("隔离人格")
        page.get_by_role("button", name="保存人格").click()
        page.get_by_text("已保存「隔离人格」", exact=True).wait_for()
        proactive = page.get_by_role("switch", name="允许助手主动提问")
        assert proactive.get_attribute("aria-checked") == "false"
        proactive.click()
        page.get_by_text("设置已保存", exact=True).wait_for()
        assert proactive.get_attribute("aria-checked") == "true"
        saved_settings = page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1')).settings")
        assert saved_settings["proactive_questions"] is True

        page.get_by_role("button", name="世界书").click()
        page.get_by_role("button", name="添加世界书").click()
        page.get_by_label("名称", exact=True).fill("测试世界书")
        page.get_by_role("button", name="保存世界书").click()
        page.get_by_text("世界书已保存", exact=True).wait_for()

        page.get_by_role("button", name="自动总结").click()
        page.get_by_role("button", name="保存自动总结").click()
        page.get_by_text("自动总结设置已保存", exact=True).wait_for()

        page.get_by_role("button", name="记忆库").click()
        page.get_by_label("标题", exact=True).fill("喜欢热茶")
        page.get_by_label("内容", exact=True).fill("用户喜欢在晚上喝热茶")
        page.get_by_role("button", name="新增记忆").click()
        page.get_by_text("记忆已保存", exact=True).wait_for()

        page.get_by_role("button", name="MCP").click()
        page.get_by_label("名称", exact=True).fill("本机 MCP 配置")
        page.get_by_label("服务地址").fill("https://mcp.example.com")
        page.get_by_role("button", name="保存连接").click()
        page.get_by_text("MCP 配置已保存", exact=True).wait_for()

        page.get_by_role("button", name="工具与权限").click()
        page.get_by_role("button", name="保存搜索与记忆线路").click()
        page.get_by_text("搜索与记忆线路已保存", exact=True).wait_for()

        page.get_by_role("button", name="备份与恢复").click()
        page.get_by_role("button", name="导出备份").click()
        page.get_by_text("API Key、搜索 Key", exact=False).wait_for()

        page.get_by_role("button", name="插件中心").click()
        page.get_by_text("人格九维状态", exact=True).wait_for()
        page.get_by_label("启用九维状态").check()
        page.get_by_role("button", name="保存九维设置").click()
        page.get_by_text("九维状态设置已保存", exact=True).wait_for()
        assert page.locator(".motivation-grid article").count() == 9
        page.get_by_role("button", name="外观").click()
        page.get_by_label("用户名").fill("测试用户")
        page.get_by_role("button", name="保存用户名").click()
        page.get_by_text("用户名已保存", exact=True).wait_for()
        page.get_by_role("button", name="关闭设置").click()

        page.get_by_role("button", name="打开或关闭欲望与聊天状态").click()
        page.locator(".chat-status-card").get_by_text("隔离人格 的状态", exact=True).wait_for()
        page.get_by_role("button", name="非流式", exact=True).click()
        page.get_by_text("已切换为非流式输出", exact=True).wait_for()
        page.get_by_role("button", name="流式", exact=True).click()
        page.get_by_text("已切换为流式输出", exact=True).wait_for()
        page.get_by_role("button", name="关闭欲望状态").click()

        composer = page.get_by_role("textbox", name="消息")
        composer.fill("请给我两个选择")
        page.get_by_role("button", name="发送").click()
        page.get_by_text("这是第一版回答。", exact=False).wait_for()
        reasoning = page.locator("details.reasoning").last
        assert reasoning.get_attribute("open") is not None
        assert "点击收起" in reasoning.inner_text()
        option = page.get_by_role("button", name="继续细化")
        option.click()
        assert option.get_attribute("aria-pressed") == "true"
        assert "继续细化" in composer.input_value()
        composer.fill("")

        assistant = page.locator("article.message-assistant").last
        assistant.get_by_role("button", name="☆ 珍藏").click()
        assistant.get_by_role("button", name="★ 已珍藏").wait_for()
        assistant.get_by_role("button", name="修改").click()
        page.get_by_role("dialog", name="修改内容").get_by_role("textbox").fill("第一版已经修改")
        page.get_by_role("dialog", name="修改内容").get_by_role("button", name="保存修改").click()
        page.get_by_text("第一版已经修改", exact=True).wait_for()

        page.locator("article.message-assistant").last.get_by_role("button", name="重新 Roll").click()
        page.get_by_text("这是第 2 版回答。", exact=True).wait_for()
        page.get_by_text("2 / 2", exact=True).wait_for()
        page.locator(".version-switcher button").first.click()
        page.get_by_text("第一版已经修改", exact=True).wait_for()

        page.locator("article.message-assistant").last.get_by_role("button", name="更多消息操作").click()
        page.get_by_role("button", name="从这里创建分支").click()
        page.locator(".conversation-title strong").filter(has_text="分支").wait_for()
        assert "分支" in page.locator(".conversation-title strong").inner_text()

        page.get_by_role("button", name="生活簿").click()
        page.get_by_text("日常记录", exact=True).wait_for()
        page.get_by_label("标题").fill("早餐")
        page.get_by_label("备注").fill("吃了粥")
        page.get_by_label("允许当前人格读取这条记录").check()
        page.get_by_role("button", name="保存记录").click()
        page.get_by_text("早餐", exact=True).wait_for()

        page.locator(".feature-hub-nav").get_by_role("button", name="一起读书").click()
        page.get_by_label("导入 PDF / TXT / Markdown").set_input_files({"name": "sample.txt", "mimeType": "text/plain", "buffer": b"Atherloom local reading smoke text."})
        page.get_by_text("Atherloom local reading smoke text.", exact=False).wait_for()
        page.get_by_role("button", name="日记", exact=True).click()
        page.get_by_label("你能否阅读").select_option("visible")
        page.get_by_role("button", name="让 TA 现在写一篇").click()
        page.get_by_text("已写完", exact=False).wait_for()
        page.get_by_text("这是第 3 版回答。", exact=True).wait_for()
        page.get_by_text("运行审计", exact=False).click()
        page.get_by_text("写作完成", exact=False).wait_for()
        page.screenshot(path=str(ARTIFACTS / "react-desktop.png"), full_page=True)

        page.get_by_role("button", name="关闭", exact=True).click()
        page.evaluate("window.__cancelNextSave = true")
        page.get_by_role("button", name="导出脱敏 Markdown").click()
        page.get_by_text("导出失败：已取消保存", exact=True).wait_for()
        page.get_by_role("button", name="关闭提示").click()
        assert page.get_by_text("导出失败：已取消保存", exact=True).count() == 0
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="打开菜单").click()
        sidebar_features = page.locator(".sidebar-feature-list")
        assert sidebar_features.get_by_role("button", name="珍藏").is_visible()
        assert sidebar_features.get_by_role("button", name="生活簿").is_visible()
        assert sidebar_features.get_by_role("button", name="往来").is_visible()
        page.wait_for_timeout(260)
        page.screenshot(path=str(ARTIFACTS / "react-mobile-sidebar.png"), full_page=True)
        page.get_by_role("button", name="打开设置").click()
        page.get_by_role("button", name="API 与网关").click()
        page.get_by_text("本机测试线路", exact=True).wait_for()
        page.screenshot(path=str(ARTIFACTS / "react-mobile-settings.png"), full_page=True)

        assert not page_errors, page_errors
        assert not console_errors, console_errors
        context.close()
        browser.close()


if __name__ == "__main__":
    run()
    print("react-ui-smoke: ok")
