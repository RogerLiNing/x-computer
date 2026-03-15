# WhatsApp 渠道接入（R052）

参考 [Openclaw WhatsApp](https://docs.openclaw.ai/channels/whatsapp)，使用 Baileys（WhatsApp Web 协议）实现 X-Computer 与 WhatsApp 的双向通信。

## 功能概览

- **QR 码登录**：通过 WhatsApp Web 扫码登录，无需 Meta 审核
- **发送消息**：X 可通过 `x.send_whatsapp` 工具向指定号码发送消息
- **接收消息**：用户发来的消息存入 DB，发出 `whatsapp_message_received` 信号
- **白名单策略**：仅处理白名单内号码的消息，避免骚扰

## 配置步骤

1. 打开 **设置 → 通知/邮件**，滚动到 **WhatsApp（R052）** 区域
2. 勾选 **启用**
3. 在 **白名单** 中填写允许接收消息的号码（E.164 格式，如 `+8613800138000`），逗号分隔
4. 点击 **扫码登录**，用手机 WhatsApp 扫描显示的 QR 码
5. 连接成功后状态显示为「已连接」

## 配置说明

| 配置项 | 说明 |
|--------|------|
| 启用 | 是否启用 WhatsApp 渠道 |
| 白名单 | 允许接收消息的号码，E.164 格式（如 +8613800138000） |
| dmPolicy | 私聊策略，默认 `allowlist`（仅白名单） |
| groupPolicy | 群组策略，默认 `disabled` |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/whatsapp/status | 连接状态、白名单 |
| POST | /api/whatsapp/login | 获取 QR 码或返回已连接 |
| POST | /api/whatsapp/logout | 登出并清除凭证 |
| GET | /api/whatsapp/inbox | 收件箱消息列表 |

## 工具与信号

### x.send_whatsapp

X 发送 WhatsApp 消息：

```json
{
  "name": "x.send_whatsapp",
  "parameters": {
    "to": "+8613800138000",
    "message": "你好，这是 X 发送的消息"
  }
}
```

### whatsapp_message_received 信号

收到用户 WhatsApp 消息时发出。可用 `signal.add_trigger` 监听：

```json
{
  "signal": "whatsapp_message_received",
  "intent": "处理用户通过 WhatsApp 发来的消息并回复"
}
```

或指定 agent：

```json
{
  "signal": "whatsapp_message_received",
  "agentId": "xxx"
}
```

## 凭证存储

- 路径：`~/.x-computer/credentials/whatsapp/{userId}/`
- 登出后该目录会被删除

## 代理配置（国内必读）

国内访问 WhatsApp 需代理。X-Computer 支持以下代理来源（优先级从高到低）：

1. **设置页手动填写**：在代理输入框填写 `http://127.0.0.1:端口` 或 `socks5://127.0.0.1:端口`
2. **macOS 系统代理**：若已开启 Quantumult X / Clash 等「设置为系统代理」，点击「检测系统代理」可自动填入
3. **环境变量**：`HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy`

### Quantumult X（Mac）配置步骤

1. 在 Quantumult X 中选中你的美国节点（或任意可访问 WhatsApp 的节点）
2. 开启 **「设置为系统代理」** 或 **「Set as System Proxy」**
3. 打开 X-Computer 设置 → WhatsApp → 点击 **「检测系统代理」**，代理框会自动填入（如 `http://127.0.0.1:9090`）
4. 若检测不到，可手动填写 Quantumult X 的本地代理端口（常见为 9090、7890，以 Quantumult X 设置中显示的为准）
5. 点击 **「扫码登录」** 连接 WhatsApp

> **说明**：VMess 节点是远程服务器配置，不能直接填入代理框。需通过 Quantumult X 开启本地代理后，使用其本地地址（如 `http://127.0.0.1:9090`）。

## 注意事项

1. **账号安全**：建议使用专用号码，避免主号被检测
2. **消息频率**：避免短时间大量发送，可能被 WhatsApp 限制
3. **去重**：相同 messageId 在 7 天内不会重复触发
