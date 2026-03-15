#!/bin/bash

# Xray VMess 配置导入脚本
# 用法: ./import-vmess.sh "vmess://base64编码的配置"

set -e

if [ -z "$1" ]; then
    echo "用法: $0 <vmess链接>"
    echo "示例: $0 'vmess://eyJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOjQ0M...'"
    echo ""
    echo "如何获取 VMess 链接："
    echo "1. V2Box: 右键节点 → 复制链接"
    echo "2. Quantumult X: 长按节点 → 分享 → 复制"
    exit 1
fi

VMESS_LINK="$1"

# 检查是否是 vmess:// 链接
if [[ ! "$VMESS_LINK" =~ ^vmess:// ]]; then
    echo "错误: 不是有效的 vmess:// 链接"
    exit 1
fi

# 提取 base64 部分
BASE64_PART="${VMESS_LINK#vmess://}"

# 解码 base64
DECODED=$(echo "$BASE64_PART" | base64 -d 2>/dev/null || echo "$BASE64_PART" | base64 -D 2>/dev/null)

if [ -z "$DECODED" ]; then
    echo "错误: 无法解码 VMess 链接"
    exit 1
fi

echo "解码后的配置:"
echo "$DECODED" | jq . 2>/dev/null || echo "$DECODED"
echo ""

# 提取配置信息
ADDRESS=$(echo "$DECODED" | jq -r '.add // .address // empty' 2>/dev/null)
PORT=$(echo "$DECODED" | jq -r '.port // empty' 2>/dev/null)
UUID=$(echo "$DECODED" | jq -r '.id // .uuid // empty' 2>/dev/null)
ALTERID=$(echo "$DECODED" | jq -r '.aid // .alterId // 0' 2>/dev/null)
NETWORK=$(echo "$DECODED" | jq -r '.net // .network // "tcp"' 2>/dev/null)
TYPE=$(echo "$DECODED" | jq -r '.type // "none"' 2>/dev/null)
HOST=$(echo "$DECODED" | jq -r '.host // empty' 2>/dev/null)
PATH=$(echo "$DECODED" | jq -r '.path // "/"' 2>/dev/null)
TLS=$(echo "$DECODED" | jq -r '.tls // ""' 2>/dev/null)
SNI=$(echo "$DECODED" | jq -r '.sni // .serverName // empty' 2>/dev/null)

# 如果 SNI 为空，使用 HOST 或 ADDRESS
if [ -z "$SNI" ]; then
    if [ -n "$HOST" ]; then
        SNI="$HOST"
    else
        SNI="$ADDRESS"
    fi
fi

echo "提取的配置信息:"
echo "  服务器地址: $ADDRESS"
echo "  端口: $PORT"
echo "  UUID: $UUID"
echo "  AlterId: $ALTERID"
echo "  传输协议: $NETWORK"
echo "  伪装类型: $TYPE"
echo "  Host: $HOST"
echo "  路径: $PATH"
echo "  TLS: $TLS"
echo "  SNI: $SNI"
echo ""

# 备份原配置
if [ -f "config.json" ]; then
    cp config.json "config.json.backup.$(date +%Y%m%d_%H%M%S)"
    echo "已备份原配置到 config.json.backup.*"
fi

# 生成新配置
cat > config.json <<EOF
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 10809,
      "protocol": "http",
      "listen": "0.0.0.0",
      "settings": {
        "timeout": 300,
        "allowTransparent": false,
        "userLevel": 0
      },
      "tag": "http-in"
    },
    {
      "port": 10808,
      "protocol": "socks",
      "listen": "0.0.0.0",
      "settings": {
        "auth": "noauth",
        "udp": true,
        "userLevel": 0
      },
      "tag": "socks-in"
    }
  ],
  "outbounds": [
    {
      "protocol": "vmess",
      "settings": {
        "vnext": [
          {
            "address": "$ADDRESS",
            "port": $PORT,
            "users": [
              {
                "id": "$UUID",
                "alterId": $ALTERID,
                "security": "auto",
                "level": 0
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "$NETWORK",
        "security": "$([ "$TLS" = "tls" ] && echo "tls" || echo "none")",
EOF

# 添加 TLS 配置
if [ "$TLS" = "tls" ]; then
cat >> config.json <<EOF
        "tlsSettings": {
          "allowInsecure": false,
          "serverName": "$SNI"
        },
EOF
fi

# 添加传输协议配置
if [ "$NETWORK" = "ws" ]; then
cat >> config.json <<EOF
        "wsSettings": {
          "path": "$PATH",
          "headers": {
            $([ -n "$HOST" ] && echo "\"Host\": \"$HOST\"" || echo "")
          }
        }
EOF
elif [ "$NETWORK" = "tcp" ] && [ "$TYPE" = "http" ]; then
cat >> config.json <<EOF
        "tcpSettings": {
          "header": {
            "type": "http",
            "request": {
              "path": ["$PATH"],
              "headers": {
                $([ -n "$HOST" ] && echo "\"Host\": [\"$HOST\"]" || echo "")
              }
            }
          }
        }
EOF
fi

cat >> config.json <<EOF
      },
      "tag": "proxy"
    },
    {
      "protocol": "freedom",
      "settings": {},
      "tag": "direct"
    },
    {
      "protocol": "blackhole",
      "settings": {},
      "tag": "block"
    }
  ],
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [
      {
        "type": "field",
        "ip": [
          "geoip:private"
        ],
        "outboundTag": "direct"
      },
      {
        "type": "field",
        "domain": [
          "geosite:cn"
        ],
        "outboundTag": "direct"
      },
      {
        "type": "field",
        "ip": [
          "geoip:cn"
        ],
        "outboundTag": "direct"
      }
    ]
  }
}
EOF

echo "✅ 配置已更新到 config.json"
echo ""
echo "下一步："
echo "1. 检查配置: cat config.json | jq ."
echo "2. 启动容器: docker-compose up -d"
echo "3. 查看日志: docker-compose logs -f"
echo "4. 测试代理: curl -x http://127.0.0.1:10809 https://www.google.com -I"
