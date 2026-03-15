# Xray 代理使用说明

## ✅ 当前状态

Xray 代理容器已成功运行！

- **HTTP 代理**: `http://127.0.0.1:10809`
- **SOCKS5 代理**: `socks5://127.0.0.1:10808`

## 🚀 在 X-Computer 中使用

1. 打开 X-Computer 应用
2. 进入「设置」→「通知与渠道」
3. 找到「WhatsApp」配置部分
4. 在「代理」输入框中填入：
   ```
   http://127.0.0.1:10809
   ```
5. 点击「登录」按钮
6. 扫描二维码完成 WhatsApp 登录

## 📊 管理命令

```bash
# 进入配置目录
cd ~/code/x-computer/docker/xray

# 查看容器状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 重启容器
docker-compose restart

# 停止容器
docker-compose down

# 启动容器
docker-compose up -d
```

## 🧪 测试代理

```bash
# 测试 HTTP 代理访问 Google
curl -x http://127.0.0.1:10809 https://www.google.com -I

# 测试 SOCKS5 代理
curl -x socks5://127.0.0.1:10808 https://www.google.com -I

# 测试访问 WhatsApp
curl -x http://127.0.0.1:10809 https://web.whatsapp.com -I
```

## 🔧 更新 VMess 配置

如果需要更换服务器节点：

1. 编辑 `config.json` 文件
2. 修改 `outbounds[0].settings.vnext` 部分
3. 重启容器：`docker-compose restart`

## 📝 当前配置

- 服务器：69.197.141.142:26059
- 协议：VMess (TCP, 无 TLS)
- UUID：c9c6d319-302f-4043-bb4d-7f7ecef9b342

## 🛡️ 路由规则

当前配置了智能分流：
- 国内网站/IP：直连
- 国外网站：通过代理
- 私有 IP：直连

## ⚠️ 注意事项

- 容器会在系统重启后自动启动（`restart: unless-stopped`）
- 如果代理服务器失效，需要更新 `config.json` 中的服务器信息
- 日志级别设置为 `warning`，如需调试可改为 `debug`
