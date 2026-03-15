# WhatsApp 错误码 515 修复说明

## 问题描述

WhatsApp 扫码登录后出现 `Stream Errored (code: 515)` 错误，导致无法完成配对。

## 根本原因（多个）

### 原因 1：平台识别错误

Baileys 库的 `webSubPlatform` 识别逻辑有特殊要求：

```javascript
// node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js
const getWebInfo = (config) => {
    let webSubPlatform = proto.ClientPayload.WebInfo.WebSubPlatform.WEB_BROWSER;
    if (config.syncFullHistory &&
        PLATFORM_MAP[config.browser[0]] &&
        config.browser[1] === 'Desktop') {
        webSubPlatform = PLATFORM_MAP[config.browser[0]];
    }
    return { webSubPlatform };
};
```

**关键条件：**
1. `syncFullHistory` 必须为 `true`
2. `browser[0]` 必须是 `'Mac OS'` 或 `'Windows'`
3. `browser[1]` 必须是 `'Desktop'`

如果不满足这些条件，平台会被识别为 `WEB_BROWSER`，导致 WhatsApp 服务器拒绝连接（515 错误）。

## 修复方案

### 1. 使用 Baileys 官方的 `Browsers` 工具类

```typescript
import makeWASocket, { Browsers } from '@whiskeysockets/baileys';

const sock = makeWASocket({
  browser: Browsers.macOS('Desktop'),  // ✅ 正确
  // browser: ['Mac OS', 'Desktop', '14.4.1'],  // ❌ 错误（虽然看起来一样）
});
```

### 2. 设置 `syncFullHistory: true`

```typescript
const sock = makeWASocket({
  browser: Browsers.macOS('Desktop'),
  syncFullHistory: true,  // ✅ 必须为 true
  // syncFullHistory: false,  // ❌ 会导致平台识别为 WEB_BROWSER
});
```

### 3. 完整配置示例

```typescript
import makeWASocket, { 
  useMultiFileAuthState, 
  Browsers 
} from '@whiskeysockets/baileys';

const WHATSAPP_VERSION: [number, number, number] = [2, 3000, 1027934701];

const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: state.keys,
  },
  version: WHATSAPP_VERSION,
  browser: Browsers.macOS('Desktop'),
  syncFullHistory: true,  // 关键！
  markOnlineOnConnect: false,
  connectTimeoutMs: 60000,
});
```

## 验证方法

查看 Baileys 日志中的 `webSubPlatform` 字段：

```json
// ✅ 正确（DARWIN）
{
  "node": {
    "userAgent": { "platform": "MACOS" },
    "webInfo": { "webSubPlatform": "DARWIN" }
  }
}

// ❌ 错误（WEB_BROWSER）
{
  "node": {
    "userAgent": { "platform": "MACOS" },
    "webInfo": { "webSubPlatform": "WEB_BROWSER" }
  }
}
```

## 相关文件

- `server/src/whatsapp/whatsappService.ts` - 主要服务实现
- `server/test-whatsapp-vpn.js` - VPN 模式测试脚本
- `node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js` - Baileys 平台识别逻辑
- `node_modules/@whiskeysockets/baileys/lib/Utils/browser-utils.js` - Browsers 工具类定义

## 参考资料

- [Baileys Issue #1218 - Stream Error 515](https://github.com/WhiskeySockets/Baileys/issues/1218)
- [Baileys Issue #1939 - 405 Method Not Allowed](https://github.com/WhiskeySockets/Baileys/issues/1939)
- OpenClaw WhatsApp 实现参考

### 原因 2：错误的错误处理逻辑

根据 [Baileys Issue #1218](https://github.com/WhiskeySockets/Baileys/issues/1218)，515 错误的含义是 "restart required"（需要重启连接），**不是**"设备被移除"。

**错误的处理方式：**
```typescript
if (statusCode === 515) {
  // ❌ 错误：清除认证文件
  fs.rmSync(authPath, { recursive: true });
  // ❌ 错误：通知用户重新登录
  disconnectCallback('logged_out');
}
```

**正确的处理方式：**
```typescript
if (statusCode === 515) {
  // ✅ 正确：让 Baileys 自动重连
  logger.info('515 错误：需要重启连接，自动重连中...');
  // Baileys 内部会自动处理重连，不需要清除认证
  disconnectCallback('disconnected', '连接中断，正在重连...');
  return; // 不要继续执行其他逻辑
}
```

## 完整修复方案

### 修复 1：平台识别

#### 1.1 使用 Baileys 官方的 `Browsers` 工具类

```typescript
import makeWASocket, { Browsers } from '@whiskeysockets/baileys';

const sock = makeWASocket({
  browser: Browsers.macOS('Desktop'),  // ✅ 正确
  // browser: ['Mac OS', 'Desktop', '14.4.1'],  // ❌ 错误（虽然看起来一样）
});
```

#### 1.2 设置 `syncFullHistory: true`

```typescript
const sock = makeWASocket({
  browser: Browsers.macOS('Desktop'),
  syncFullHistory: true,  // ✅ 必须为 true
  // syncFullHistory: false,  // ❌ 会导致平台识别为 WEB_BROWSER
});
```

### 修复 2：正确处理 515 错误

```typescript
sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect } = update;
  
  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    
    if (statusCode === 515) {
      // ✅ 正确：515 是临时错误，让 Baileys 自动重连
      logger.info('515 错误：连接需要重启，等待自动重连...');
      // 不要清除认证，不要通知用户重新登录
      return;
    }
    
    if (statusCode === 401 && msg.includes('device_removed')) {
      // ✅ 正确：401 + device_removed 才需要清除认证
      fs.rmSync(authPath, { recursive: true });
      disconnectCallback('logged_out', '设备已被移除，请重新扫码登录');
      return;
    }
    
    // 其他错误的处理...
  }
});
```

### 完整配置示例

```typescript
import makeWASocket, { 
  useMultiFileAuthState, 
  Browsers 
} from '@whiskeysockets/baileys';

const WHATSAPP_VERSION: [number, number, number] = [2, 3000, 1027934701];

const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: state.keys,
  },
  version: WHATSAPP_VERSION,
  browser: Browsers.macOS('Desktop'),
  syncFullHistory: true,  // 关键！
  markOnlineOnConnect: false,
  connectTimeoutMs: 60000,
});

sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect } = update;
  
  if (connection === 'close') {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    
    // 515: 自动重连，不清除认证
    if (statusCode === 515) {
      logger.info('连接需要重启，等待自动重连...');
      return;
    }
    
    // 401 + device_removed: 清除认证
    if (statusCode === 401 && msg.includes('device_removed')) {
      fs.rmSync(authPath, { recursive: true });
      return;
    }
  }
});
```

## 验证方法

查看 Baileys 日志中的 `webSubPlatform` 字段：

```json
// ✅ 正确（DARWIN）
{
  "node": {
    "userAgent": { "platform": "MACOS" },
    "webInfo": { "webSubPlatform": "DARWIN" }
  }
}

// ❌ 错误（WEB_BROWSER）
{
  "node": {
    "userAgent": { "platform": "MACOS" },
    "webInfo": { "webSubPlatform": "WEB_BROWSER" }
  }
}
```

## 相关文件

- `server/src/whatsapp/whatsappService.ts` - 主要服务实现
- `server/test-whatsapp-vpn.js` - VPN 模式测试脚本
- `node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js` - Baileys 平台识别逻辑
- `node_modules/@whiskeysockets/baileys/lib/Utils/browser-utils.js` - Browsers 工具类定义

## 参考资料

- [Baileys Issue #1218 - Stream Error 515](https://github.com/WhiskeySockets/Baileys/issues/1218) - **关键：515 错误应该自动重连**
- [Baileys Issue #1939 - 405 Method Not Allowed](https://github.com/WhiskeySockets/Baileys/issues/1939)
- [Baileys Issue #2364 - Platform MACOS Fix](https://github.com/WhiskeySockets/Baileys/issues/2364)
- OpenClaw WhatsApp 实现参考

## 修复日期

2026-02-28

## 重要提示

**515 错误通常会在几次重连后自动恢复。** 如果持续出现 515 错误：

1. 检查手机 WhatsApp 中的「已链接的设备」，删除所有未完成的设备
2. 等待 1-2 小时后再试（WhatsApp 可能有防滥用限制）
3. 确保 VPN 连接稳定
