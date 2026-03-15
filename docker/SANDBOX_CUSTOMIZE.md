# 沙箱镜像自定义

沙箱镜像 `x-computer-sandbox:latest` 用于容器模式下执行 shell 命令，基于 `node:20-alpine`。

## 已预装内容

| 类别 | 工具 |
|------|------|
| **运行环境** | Node.js 20、Python 3、pip |
| **Python 库** | requests（`py3-requests`） |
| **Node** | npm、npx（项目内 `npm install` 安装依赖） |
| **CLI 工具** | git, curl, wget, bash, jq, make, g++ |
| **文本处理** | grep, sed, awk, tar, gzip, zip, unzip |

## 添加更多工具

### 1. 修改 Dockerfile

编辑 `docker/sandbox.Dockerfile`，在 `apk add` 中追加包：

```dockerfile
# 例如添加更多 Python 库（Alpine 包名一般为 py3-xxx）
RUN apk add --no-cache \
    ... \
    py3-pandas \    # 若 Alpine 提供
    py3-numpy \
    && rm -rf /var/cache/apk/*
```

或通过 pip 安装（需 `--break-system-packages`）：

```dockerfile
RUN pip3 install --no-cache-dir --break-system-packages \
    pandas numpy \
    && rm -rf /root/.cache/pip
```

### 2. 重新构建并测试

```bash
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .
# 或
./docker/build-sandbox.sh
```

### 3. 验证

```bash
docker run --rm x-computer-sandbox:latest node --version
docker run --rm x-computer-sandbox:latest python3 -c "import requests; print('ok')"
```

## 按需安装（运行时）

沙箱内支持在 `/workspace` 下执行 `pip install` 或 `npm install`，AI 可先写入 `requirements.txt` 或 `package.json`，再执行安装。适合项目级依赖，但每次新建容器需重新安装。
