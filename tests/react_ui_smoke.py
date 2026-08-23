from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


NATIVE_MOCK = r"""
(() => {
  const providers = [];
  const correspondenceContacts = [];
  const correspondenceMail = [];
  let chatCount = 0;
  window.__useCorrespondenceBackend = false;
  const publicProvider = value => {
    const copy = {...value, has_api_key: Boolean(value.api_key)};
    delete copy.api_key;
    return copy;
  };
  const nativeResult = body => JSON.stringify({ok: true, status: 200, body: JSON.stringify(body)});
  window.AtherloomNative = {
    getBackendUrl: () => window.__useCorrespondenceBackend ? "http://127.0.0.1:8876" : "",
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
    apiRequest: (method, path, raw) => {
      const request = JSON.parse(raw || "{}");
      const stamp = new Date().toISOString();
      if (method === "GET" && path.startsWith("/api/correspondence/")) {
        return nativeResult({contacts: correspondenceContacts, mail: correspondenceMail, parlors: [], duration_seconds: 300});
      }
      if (method === "POST" && path === "/api/correspondence/contacts") {
        const existing = correspondenceContacts.find(item => item.persona_key === request.persona_key && item.platform === request.platform && item.stable_id === request.stable_id);
        if (existing) return nativeResult(existing);
        const entry = {...request, id: `server-contact-${correspondenceContacts.length + 1}`, ai_approved: true, user_approved: false, blocked: false, whitelisted: false, created_at: stamp, updated_at: stamp};
        correspondenceContacts.unshift(entry);
        return nativeResult(entry);
      }
      const decision = path.match(/^\/api\/correspondence\/contacts\/([^/]+)\/user-decision$/);
      if (method === "POST" && decision) {
        const entry = correspondenceContacts.find(item => item.id === decodeURIComponent(decision[1]));
        entry.user_approved = Boolean(request.approved);
        entry.whitelisted = entry.ai_approved && entry.user_approved && !entry.blocked;
        entry.updated_at = stamp;
        return nativeResult(entry);
      }
      const block = path.match(/^\/api\/correspondence\/contacts\/([^/]+)\/block$/);
      if (method === "POST" && block) {
        const entry = correspondenceContacts.find(item => item.id === decodeURIComponent(block[1]));
        entry.blocked = true;
        entry.user_approved = false;
        entry.whitelisted = false;
        entry.updated_at = stamp;
        return nativeResult({blocked: true});
      }
      if (method === "POST" && path === "/api/correspondence/mail") {
        const entry = {...request, id: `server-mail-${correspondenceMail.length + 1}`, status: "delivered", safety_reason: "", created_at: stamp, delivered_at: stamp};
        correspondenceMail.unshift(entry);
        return nativeResult(entry);
      }
      if (method === "POST" && path === "/api/correspondence/invites") {
        return nativeResult({code: "SMOKE-INVITE", expires_at: new Date(Date.now() + 600000).toISOString()});
      }
      return JSON.stringify({ok: false, status: 404, error: `unhandled native route: ${method} ${path}`});
    },
    providerOperationAsync: (operation, raw, callbackId) => {
      const request = JSON.parse(raw || "{}");
      let body;
      if (operation === "models") body = {models: ["mock-model", "mock-model-pro"]};
      else if (operation === "test") body = {ok: true, message: "连接成功，模型已响应"};
      else if (String(request.system || "").includes("受限子代理")) {
        body = {content: "子代理核对报告：边界与事实一致。", reasoning: "", model: request.model || "mock-model-pro", usage: {prompt_tokens: 4, completion_tokens: 3, total_tokens: 7}};
      }
      else if (String(request.system || "").includes("用户已经在 Atherloom 任务台明确批准")) {
        body = {content: "自动唤醒回归留言。", reasoning: "", model: request.model || "mock-model-pro", usage: {prompt_tokens: 4, completion_tokens: 3, total_tokens: 7}};
      }
      else if (Array.isArray(request.tools) && JSON.stringify(request.messages || []).includes("subagent-tool-smoke")) {
        body = {content: "子代理已经返回核对报告。", reasoning: "只采用受限报告", model: request.model || "mock-model-pro", usage: {prompt_tokens: 5, completion_tokens: 4, total_tokens: 9}};
      }
      else if (Array.isArray(request.tools) && request.tools.some(tool => tool.name === "atherloom_subagent_run")
        && JSON.stringify(request.messages || []).includes("委托回归")
        && !(request.messages || []).some(message => message.role === "tool")) {
        const definition = request.tools.find(tool => tool.name === "atherloom_subagent_run");
        const agentId = definition.input_schema.properties.agent_id.enum[0];
        const args = {agent_id: agentId, task: "核对子代理回归资料的事实边界"};
        const nativeCall = {id: "subagent-tool-smoke", type: "function", function: {name: "atherloom_subagent_run", arguments: JSON.stringify(args)}};
        body = {
          content: "", reasoning: "委托受限子代理核对", model: request.model || "mock-model-pro",
          tool_calls: [{id: "subagent-tool-smoke", name: "atherloom_subagent_run", arguments: args, source: "native"}],
          raw_assistant: {role: "assistant", content: null, tool_calls: [nativeCall]},
          usage: {prompt_tokens: 6, completion_tokens: 3, total_tokens: 9},
        };
      }
      else if (Array.isArray(request.tools) && request.tools.some(tool => tool.name === "atherloom_board_create")
        && JSON.stringify(request.messages || []).includes("工具回归留言")
        && !(request.messages || []).some(message => message.role === "tool")) {
        const nativeCall = {id: "writing-tool-smoke", type: "function", function: {name: "atherloom_board_create", arguments: JSON.stringify({content: "工具回归留言", visible_to_user: true})}};
        body = {
          content: "", reasoning: "决定使用真实留言工具", model: request.model || "mock-model-pro",
          tool_calls: [{id: "writing-tool-smoke", name: "atherloom_board_create", arguments: {content: "工具回归留言", visible_to_user: true}, source: "native"}],
          raw_assistant: {role: "assistant", content: null, tool_calls: [nativeCall]},
          usage: {prompt_tokens: 6, completion_tokens: 3, total_tokens: 9},
        };
      }
      else if (Array.isArray(request.tools) && JSON.stringify(request.messages || []).includes("writing-tool-smoke")) {
        body = {content: "已经通过真实工具把便利贴留好了。", reasoning: "工具结果确认已创建", model: request.model || "mock-model-pro", usage: {prompt_tokens: 5, completion_tokens: 4, total_tokens: 9}};
      }
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
      window.__lastProviderChatRequest = request;
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


def assert_dialog_header_in_view(dialog) -> None:
    dialog_box = dialog.bounding_box()
    header_box = dialog.locator(".feature-hub-header").bounding_box()
    close_box = dialog.locator(".feature-hub-header > button").bounding_box()
    assert dialog_box and header_box and close_box
    assert dialog_box["y"] >= -1, dialog_box
    assert header_box["y"] >= -1, header_box
    assert header_box["y"] >= dialog_box["y"] - 1
    assert close_box["x"] + close_box["width"] <= dialog_box["x"] + dialog_box["width"] + 1


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

        assert page.evaluate("document.documentElement.dataset.font") == "kai"
        assert "Atherloom WenKai" in page.locator("body").evaluate("element => getComputedStyle(element).fontFamily")

        page.get_by_role("button", name="设置用户名").click()
        username_field = page.get_by_label("用户名", exact=True)
        username_field.wait_for()
        page.wait_for_timeout(50)
        assert username_field.evaluate("element => document.activeElement === element"), page.evaluate("document.activeElement?.outerHTML")
        username_field.fill("测试用户")
        page.get_by_role("button", name="保存用户名").click()
        page.get_by_text("用户名已保存", exact=True).wait_for()
        page.locator(".theme-setting select").select_option("water")
        font_select = page.get_by_label("正文字体")
        assert font_select.locator("option").evaluate_all("nodes => nodes.map(node => node.value)") == ["kai", "song", "hei", "fangsong", "system"]
        font_select.select_option("song")
        assert page.evaluate("document.documentElement.dataset.font") == "song"
        font_select.select_option("kai")
        assert page.evaluate("localStorage.getItem('atherloom-react:font')") == "kai"
        page.get_by_role("button", name="API 与网关").click()
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
        page.get_by_role("button", name="子代理", exact=True).click()
        page.get_by_role("button", name="添加子代理").click()
        subagent_card = page.locator(".subagent-config-card").first
        subagent_card.get_by_label("名称").fill("资料核对员")
        subagent_card.get_by_label("专长").fill("核对事实与边界，不做最终决定")
        subagent_card.get_by_label("模型线路").select_option(label="本机测试线路 · mock-model-pro")
        subagent_card.get_by_label("工作指令").fill("只核对本轮任务中的事实和冲突，返回简短报告，不调用工具。")
        page.get_by_role("button", name="保存人格").click()
        page.get_by_text("已保存「隔离人格」", exact=True).wait_for()
        saved_subagents = page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1')).personas.find(item => item.name === '隔离人格').config.subagents")
        assert len(saved_subagents) == 1, saved_subagents
        assert saved_subagents[0]["name"] == "资料核对员", saved_subagents
        assert saved_subagents[0]["enabled"] is True, saved_subagents
        proactive = page.get_by_role("switch", name="允许助手主动提问")
        assert proactive.get_attribute("aria-checked") == "false"
        proactive.click()
        page.get_by_text("设置已保存", exact=True).wait_for()
        assert proactive.get_attribute("aria-checked") == "true"
        saved_settings = page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1')).settings")
        assert saved_settings["proactive_questions"] is True

        page.get_by_role("button", name="自动唤醒").click()
        wake_editor = page.locator(".automation-task-editor")
        wake_editor.get_by_label("任务名称").fill("自动唤醒回归")
        wake_editor.get_by_label("模型线路").select_option(label="本机测试线路")
        wake_editor.get_by_label("唤醒时交给 AI 的提示词").fill("留一句自动唤醒回归留言")
        wake_editor.get_by_role("button", name="添加任务").click()
        page.get_by_text("任务已保存；应用在前台打开时会按计划唤醒", exact=True).wait_for()
        wake_task = page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:automation:v1')).wake_tasks.find(item => item.name === '自动唤醒回归')")
        assert wake_task["created_by"] == "user" and wake_task["approval"] == "approved" and wake_task["enabled"] is True, wake_task
        wake_card = page.locator(".automation-task-card", has_text="自动唤醒回归")
        wake_card.get_by_role("button", name="立即运行").click()
        page.get_by_text("已交给本机调度", exact=False).wait_for()
        page.wait_for_function("JSON.parse(localStorage.getItem('atherloom-react:automation:v1')).wake_tasks.some(item => item.name === '自动唤醒回归' && item.status === 'completed' && item.run_count === 1)")
        wake_result = page.evaluate("JSON.parse(localStorage.getItem('atherloom-react:feature-spaces:v1')).board.find(item => item.automation_task_id)")
        assert wake_result["content"] == "自动唤醒回归留言。", wake_result

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
        page.get_by_role("button", name="关闭设置").click()
        automation_sticky = page.locator(".board-wake-sticky", has_text="自动唤醒回归留言。")
        automation_sticky.wait_for()
        automation_sticky.get_by_role("button", name="收好").click()
        automation_sticky.wait_for(state="detached")

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

        composer.fill("请委托资料核对员检查这段委托回归资料")
        page.get_by_role("button", name="发送").click()
        page.get_by_text("子代理已经返回核对报告。", exact=True).wait_for()
        page.get_by_text("资料核对员 · 已完成", exact=True).wait_for()
        subagent_event = page.evaluate("""() => {
          const state = JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1'));
          return Object.values(state.messages).flat().find(row => row.content === '子代理已经返回核对报告。')?.tool_events?.[0];
        }""")
        assert subagent_event["type"] == "subagent" and subagent_event["tool_name"] == "资料核对员", subagent_event

        page.get_by_role("button", name="往来", exact=True).click()
        standalone_correspondence = page.get_by_role("dialog", name="往来")
        standalone_correspondence.get_by_text("Android 本机模式尚未接入真实往来服务。", exact=True).wait_for()
        assert standalone_correspondence.get_by_role("button", name="申请联系人").is_disabled()
        assert standalone_correspondence.get_by_role("button", name="寄出这一封").is_disabled()
        standalone_correspondence.get_by_role("button", name="通信记录", exact=True).click()
        standalone_correspondence.get_by_text("无法读取服务器通信记录。", exact=True).wait_for()
        standalone_correspondence.get_by_role("button", name="关闭", exact=True).click()

        page.evaluate("window.__useCorrespondenceBackend = true")
        page.get_by_role("button", name="往来", exact=True).click()
        correspondence = page.get_by_role("dialog", name="往来")
        assert correspondence.get_by_role("button", name="信箱", exact=True).is_visible()
        assert correspondence.get_by_role("button", name="会客厅", exact=True).is_visible()
        assert correspondence.get_by_role("button", name="通信记录", exact=True).is_visible()
        correspondence.get_by_text("往来服务已连接", exact=False).wait_for()
        water_workspace_colors = correspondence.locator(".correspondence-intro").evaluate("element => { const style = getComputedStyle(element); return [style.backgroundColor, style.borderColor, style.color]; }")
        page.evaluate("document.documentElement.dataset.theme = 'lilac'")
        lilac_workspace_colors = correspondence.locator(".correspondence-intro").evaluate("element => { const style = getComputedStyle(element); return [style.backgroundColor, style.borderColor, style.color]; }")
        assert water_workspace_colors != lilac_workspace_colors
        page.evaluate("document.documentElement.dataset.theme = 'water'")
        correspondence.get_by_role("button", name="申请联系人").click()
        correspondence.get_by_label("显示名称").fill("测试联系人")
        correspondence.get_by_label("平台").fill("测试平台")
        correspondence.get_by_label("稳定联系人 ID").fill("contact-test-001")
        correspondence.get_by_role("button", name="提交申请").click()
        correspondence.get_by_role("button", name="批准", exact=True).click()
        correspondence.get_by_label("白名单收件人").select_option(label="测试联系人 · 测试平台")
        correspondence.get_by_label("标题", exact=True).fill("测试信件")
        correspondence.get_by_label("正文", exact=True).fill("这是一封用于本机回归的测试信件。")
        correspondence.get_by_role("button", name="寄出这一封").click()
        correspondence.get_by_text("这一封已通过安全检查并送达。", exact=True).wait_for()
        correspondence.get_by_role("button", name="通信记录", exact=True).click()
        correspondence.get_by_text("发出信件「测试信件」· 已送达", exact=True).wait_for()
        correspondence.get_by_role("button", name="会客厅", exact=True).click()
        correspondence.get_by_label("主持人格").select_option(label="隔离人格")
        correspondence.get_by_label("归档总结线路").select_option(label="本机测试线路 · mock-model-pro")
        correspondence.get_by_role("button", name="保存会客厅配置").click()
        correspondence.get_by_text("会客厅配置已保存在当前设备。", exact=True).wait_for()
        correspondence.get_by_role("button", name="关闭", exact=True).click()
        page.evaluate("window.__useCorrespondenceBackend = false")

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
        page.evaluate("""() => {
          const state = JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1'));
          const personaKey = state.personas[0].id;
          const stamp = new Date(Date.now() - 60000).toISOString();
          localStorage.removeItem('atherloom-react:writing-migration:legacy-v1');
          localStorage.setItem(`atherloom:journals:${encodeURIComponent(personaKey)}`, JSON.stringify([{
            id: 'legacy-journal-smoke', persona_key: personaKey, title: '旧版迁移日记', content: '旧日记正文仍在',
            space: 'user', author: 'user', visible_to_user: true, visible_to_ai: false, created_at: stamp, updated_at: stamp
          }, {
            id: 'legacy-sealed-journal-smoke', persona_key: personaKey, title: '密封测试页', content: '这段正文不能进入公开生成',
            space: 'ai', author: 'ai', visible_to_user: false, visible_to_ai: true, created_at: stamp, updated_at: stamp
          }]));
          localStorage.setItem(`atherloom:board:${encodeURIComponent(personaKey)}`, JSON.stringify([{
            id: 'legacy-board-smoke', persona_key: personaKey, content: '旧留言正文仍在', author_role: 'user',
            visible_to_user: true, visible_to_ai: false, created_at: stamp, updated_at: stamp
          }]));
          localStorage.setItem(`atherloom:dreams:${encodeURIComponent(personaKey)}`, JSON.stringify([{
            id: 'legacy-dream-smoke', persona_key: personaKey, title: '旧版迁移梦境', raw_text: '旧梦境正文仍在',
            kind: 'quarantined', claimed: false, created_at: stamp, updated_at: stamp
          }]));
          localStorage.setItem('atherloom:board_wakes', JSON.stringify([{
            id: 'legacy-exhausted-wake', message_id: 'legacy-board-smoke', persona_key: personaKey,
            provider_id: 'provider-legacy', due_at: stamp, status: 'pending', attempts: 3, created_at: stamp
          }]));
          const spaces = JSON.parse(localStorage.getItem('atherloom-react:feature-spaces:v1') || '{}');
          spaces.boardWakes = [{
            id: 'mirror-terminal-wake', message_id: 'legacy-board-smoke', persona_key: personaKey,
            provider_id: 'provider-legacy', due_at: stamp, status: 'pending', attempts: 1, created_at: stamp
          }, {
            id: 'done-wins-wake', message_id: 'legacy-board-smoke', persona_key: personaKey,
            provider_id: 'provider-legacy', due_at: stamp, status: 'done', attempts: 1,
            created_at: stamp, completed_at: new Date().toISOString()
          }];
          localStorage.setItem('atherloom-react:feature-spaces:v1', JSON.stringify(spaces));
          localStorage.setItem('atherloom-react:board-wakes:v1', JSON.stringify([{
            id: 'mirror-terminal-wake', message_id: 'legacy-board-smoke', persona_key: personaKey,
            provider_id: 'provider-legacy', due_at: stamp, status: 'done', attempts: 1,
            created_at: stamp, completed_at: new Date().toISOString()
          }, {
            id: 'done-wins-wake', message_id: 'legacy-board-smoke', persona_key: personaKey,
            provider_id: 'provider-legacy', due_at: new Date(Date.now() + 86400000).toISOString(),
            status: 'error', attempts: 3, created_at: stamp, error: 'stale mirror retry'
          }]));
        }""")
        page.get_by_role("button", name="日记", exact=True).click()
        page.get_by_text("旧版迁移日记", exact=True).wait_for()
        wake_states = page.evaluate("""() => Object.fromEntries(
          JSON.parse(localStorage.getItem('atherloom-react:feature-spaces:v1')).boardWakes.map(row => [row.id, row.status])
        )""")
        assert wake_states["legacy-exhausted-wake"] == "error", wake_states
        assert wake_states["mirror-terminal-wake"] == "done", wake_states
        assert wake_states["done-wins-wake"] == "done", wake_states
        page.get_by_label("你能否阅读").select_option("visible")
        page.get_by_role("button", name="让 TA 现在写一篇").click()
        page.get_by_text("已写入写作库", exact=False).wait_for()
        page.get_by_text("这是第 3 版回答。", exact=True).wait_for()
        public_journal_system = page.evaluate("() => String(window.__lastProviderChatRequest?.system || '')")
        assert "persona_visible_spaces" not in public_journal_system, public_journal_system
        assert "密封测试页" not in public_journal_system, public_journal_system
        page.get_by_text("运行审计", exact=False).click()
        page.get_by_text("写作完成", exact=False).wait_for()
        page.get_by_role("button", name="留言板", exact=True).click()
        page.get_by_text("旧留言正文仍在", exact=True).wait_for()
        page.get_by_label("留言正文").fill("这是一条本机回归留言。")
        page.get_by_role("button", name="贴到留言板").click()
        page.get_by_text("这是一条本机回归留言。", exact=True).wait_for()
        page.get_by_role("button", name="梦库", exact=True).click()
        page.get_by_text("旧版迁移梦境", exact=True).wait_for()
        dream_cards_before = page.locator(".dream-note").count()
        page.get_by_role("button", name="让 TA 做梦").click()
        page.get_by_text("梦境草稿已经填好", exact=False).wait_for()
        assert page.locator(".dream-note").count() == dream_cards_before
        page.get_by_role("button", name="保存梦境").click()
        page.get_by_text("梦境已保存并认领。", exact=True).wait_for()
        assert page.locator(".dream-note").count() == dream_cards_before + 1
        page.get_by_text("这是第 4 版回答。", exact=True).wait_for()
        assert page.evaluate("localStorage.getItem('atherloom:journals:' + encodeURIComponent(JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1')).personas[0].id)) !== null")
        page.screenshot(path=str(ARTIFACTS / "react-desktop.png"), full_page=True)

        page.get_by_role("button", name="关闭", exact=True).click()
        composer.fill("请在留言板给我留一张公开便利贴，内容是工具回归留言")
        page.get_by_role("button", name="发送").click()
        page.get_by_text("已经通过真实工具把便利贴留好了。", exact=True).wait_for()
        page.get_by_text("贴出留言 · 已完成", exact=True).wait_for()
        tool_persistence = page.evaluate("""() => {
          const state = JSON.parse(localStorage.getItem('atherloom-react:standalone-state:v1'));
          const personaKey = state.personas[0].id;
          const spaces = JSON.parse(localStorage.getItem('atherloom-react:feature-spaces:v1'));
          const note = spaces.board.find(row => row.persona_key === personaKey && row.content === '工具回归留言');
          const assistant = Object.values(state.messages).flat().find(row => row.role === 'assistant' && row.content === '已经通过真实工具把便利贴留好了。');
          return {note, toolEvents: assistant?.tool_events || []};
        }""")
        assert tool_persistence["note"]["author"] == "ai", tool_persistence
        assert tool_persistence["note"]["visible_to_user"] is True, tool_persistence
        assert tool_persistence["toolEvents"][0]["name"] == "atherloom_board_create", tool_persistence
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
        page.get_by_role("button", name="打开账号与外观设置").click()
        page.get_by_label("用户名").wait_for()
        page.screenshot(path=str(ARTIFACTS / "react-mobile-username.png"), full_page=True)
        page.get_by_role("button", name="API 与网关").click()
        page.get_by_text("本机测试线路", exact=True).wait_for()
        page.screenshot(path=str(ARTIFACTS / "react-mobile-settings.png"), full_page=True)
        page.get_by_role("button", name="关闭设置").click()

        page.evaluate("window.__useCorrespondenceBackend = true")
        page.get_by_role("button", name="打开菜单").click()
        page.locator(".sidebar-feature-list").get_by_role("button", name="往来", exact=True).click()
        mobile_correspondence = page.locator(".correspondence-workspace")
        mobile_correspondence.get_by_text("往来服务已连接", exact=False).wait_for()
        mobile_correspondence.get_by_role("button", name="信箱", exact=True).click()
        assert_dialog_header_in_view(mobile_correspondence)
        mobile_correspondence.screenshot(path=str(ARTIFACTS / "react-mobile-correspondence-mail.png"))
        mobile_correspondence.get_by_role("button", name="会客厅", exact=True).click()
        assert_dialog_header_in_view(mobile_correspondence)
        mobile_correspondence.screenshot(path=str(ARTIFACTS / "react-mobile-correspondence-parlor.png"))
        mobile_correspondence.get_by_role("button", name="通信记录", exact=True).click()
        assert_dialog_header_in_view(mobile_correspondence)
        mobile_correspondence.screenshot(path=str(ARTIFACTS / "react-mobile-correspondence-audit.png"))
        mobile_correspondence.get_by_role("button", name="关闭", exact=True).click()
        page.evaluate("window.__useCorrespondenceBackend = false")

        page.get_by_role("button", name="打开菜单").click()
        mobile_sidebar = page.locator(".sidebar-feature-list")
        writing_group = mobile_sidebar.locator("details").filter(has_text="日记与留言")
        if writing_group.get_attribute("open") is None:
            writing_group.locator("summary").click()
        writing_group.get_by_text("日记", exact=True).click()
        mobile_writing = page.locator(".writing-workspace")
        assert_dialog_header_in_view(mobile_writing)
        mobile_writing.screenshot(path=str(ARTIFACTS / "react-mobile-journal.png"))
        mobile_writing.get_by_role("button", name="留言板", exact=True).click()
        assert_dialog_header_in_view(mobile_writing)
        mobile_writing.screenshot(path=str(ARTIFACTS / "react-mobile-board.png"))
        mobile_writing.get_by_role("button", name="梦库", exact=True).click()
        assert_dialog_header_in_view(mobile_writing)
        mobile_writing.screenshot(path=str(ARTIFACTS / "react-mobile-dream.png"))

        assert not page_errors, page_errors
        assert not console_errors, console_errors
        context.close()
        browser.close()


if __name__ == "__main__":
    run()
    print("react-ui-smoke: ok")
