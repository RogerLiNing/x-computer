# X-Computer 沙箱镜像
# 用于用户容器隔离，提供安全的命令执行环境
#
# 已包含：Node.js 20、Python 3、git、curl、bash、常用 CLI 工具
# Python 库：requests
# Node：npm、npx 可用，项目内 npm install 即可
#
# 构建：docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .

FROM node:20-alpine

# 系统工具 + 编译依赖（npm 安装原生模块需要）+ Python 常用库
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-requests \
    git \
    curl \
    wget \
    bash \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    tar \
    gzip \
    zip \
    unzip \
    jq \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# 创建非特权用户（使用 2000 避免与基础镜像冲突）
RUN addgroup -g 2000 xuser && \
    adduser -D -u 2000 -G xuser xuser

# 创建工作目录
RUN mkdir -p /workspace && \
    chown -R xuser:xuser /workspace

# 创建用户主目录（用于临时文件）
RUN mkdir -p /home/xuser && \
    chown -R xuser:xuser /home/xuser

# 切换到非特权用户
USER xuser

WORKDIR /workspace

# 默认命令
CMD ["/bin/sh"]
