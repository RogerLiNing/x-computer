# X-Computer OpenResty 配置指南

OpenResty 基于 Nginx，配置语法兼容。X-Computer 部署路径为 `/apps/x-computer-staging`。

## 配置文件位置

- **宝塔面板**：`/www/server/panel/vhost/nginx/` 或 `/www/server/openresty/vhost/`
- **默认 OpenResty**：`/usr/local/openresty/nginx/conf/vhost/`
- **手动安装**：`/etc/openresty/conf.d/` 或 `conf.d/` 目录下

## 基础配置

创建配置文件，例如 `x-computer.conf`：

```nginx
# X-Computer OpenResty/Nginx 配置
# 后端 API + WebSocket: localhost:4000
# 前端静态: /apps/x-computer-staging/frontend/dist

server {
    listen 80;
    server_name x-computer.example.com;  # 改为你的域名

    root /apps/x-computer-staging/frontend/dist;
    index index.html;

    # SPA 前端
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_cache off;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # 禁止敏感文件
    location ~ ^/(\.user\.ini|\.htaccess|\.git|\.env) {
        return 404;
    }

    # SSL 证书验证（Let's Encrypt）
    location ~ \.well-known {
        allow all;
    }

    # 静态资源缓存
    location ~* \.(gif|jpg|jpeg|png|bmp|swf|ico|webp)$ {
        expires 30d;
        access_log off;
    }
    location ~* \.(js|css|woff2?|ttf|svg)$ {
        expires 12h;
        access_log off;
    }

    access_log  /var/log/openresty/x-computer.access.log;
    error_log   /var/log/openresty/x-computer.error.log;
}
```

## HTTPS 配置（Let's Encrypt）

```nginx
server {
    listen 80;
    server_name x-computer.example.com;
    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name x-computer.example.com;

    # SSL 证书（certbot 或 acme.sh 申请）
    ssl_certificate     /etc/letsencrypt/live/x-computer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/x-computer.example.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    root /apps/x-computer-staging/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }

    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location ~ \.well-known {
        allow all;
    }

    access_log  /var/log/openresty/x-computer.access.log;
    error_log   /var/log/openresty/x-computer.error.log;
}
```

## 部署步骤

```bash
# 1. 创建配置（替换域名为你的）
sudo vim /usr/local/openresty/nginx/conf/vhost/x-computer.conf

# 2. 测试配置
sudo openresty -t

# 3. 重载配置
sudo openresty -s reload

# 或 systemd
sudo systemctl reload openresty
```

## 宝塔面板用户

若使用宝塔安装的 OpenResty：

1. 网站 → 添加站点 → 选择 OpenResty
2. 域名：`x-computer.example.com`
3. 根目录：`/apps/x-computer-staging/frontend/dist`
4. 在站点设置中添加反向代理：
   - 代理名称：API
   - 目标 URL：`http://127.0.0.1:4000`
   - 发送域名：`$host`
   - 高级：添加 `/ws` 的 WebSocket 代理规则

## 环境变量

如需在 OpenResty 中使用 Lua 注入头信息等，可参考：

```nginx
location /api {
    set $backend "http://127.0.0.1:4000";
    proxy_pass $backend;
    # ... 其他 proxy_set_header
}
```

## 验证

```bash
# 检查服务
curl -I http://localhost/api/health

# 检查 WebSocket（需 wscat）
wscat -c ws://localhost/ws
```
