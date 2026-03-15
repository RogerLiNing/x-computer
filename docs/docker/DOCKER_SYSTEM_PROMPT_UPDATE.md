# Docker 功能已集成到 X 核心提示词

## ✅ 完成

X 的核心系统提示词已更新，现在包含完整的 Docker 使用指南。

## 📍 更新位置

**文件：** `server/src/prompts/systemCore/corePrompt.ts`

**位置：** 在"能力边界"部分之后，添加了新的"Docker 容器管理（完整能力）"章节

## 📝 添加的内容

### 1. 工具列表
- **通用 Docker 工具**（6 个）：`docker.run`, `docker.list`, `docker.logs`, `docker.stop`, `docker.exec`, `docker.pull`
- **交互式 Shell 会话**（5 个）：`docker.shell.enter`, `docker.shell.exec`, `docker.shell.interactive`, `docker.shell.exit`, `docker.shell.list`

### 2. 核心特性说明
- ✅ 状态保持（工作目录、环境变量）
- ✅ 后台执行（自动检测 `&` 或 `nohup`）
- ✅ 交互式程序（MySQL、PostgreSQL、Redis、MongoDB）

### 3. 使用场景示例
- 单次任务（使用 `docker.run`）
- 后台服务（使用 `docker.shell.exec` + `&`）
- 数据库操作（使用 `docker.shell.interactive`）
- 后台任务管理（使用 `screen`）

### 4. 最佳实践
- ⚠️ 长时间运行的命令必须后台执行
- ⚠️ 交互式程序必须使用 `docker.shell.interactive`
- ⚠️ 查看后台进程和日志的正确方法

### 5. 工具选择决策树
帮助 X 快速决定使用哪个工具。

### 6. 支持的场景
列出所有 Docker 可以处理的场景。

## 🎯 现在 X 知道什么

### X 知道的核心概念

1. **Docker 是什么**：容器管理工具
2. **何时使用 Docker**：需要隔离环境、运行服务、数据库操作等
3. **如何使用 Docker**：11 个工具的完整使用方法

### X 知道的关键区别

1. **单次 vs 多步**：
   - 单次 → `docker.run` 或 `docker.exec`
   - 多步 → `docker.shell.enter` + `docker.shell.exec`

2. **前台 vs 后台**：
   - 前台 → 直接执行命令
   - 后台 → 使用 `&` 或 `nohup`（X 会自动检测）

3. **普通命令 vs 交互式程序**：
   - 普通命令 → `docker.shell.exec`
   - 交互式程序 → `docker.shell.interactive`

### X 知道的最佳实践

1. **长时间运行的服务**：
   ```typescript
   // X 知道要这样做
   docker.shell.exec({command: "node app.js > /var/log/app.log 2>&1 &"})
   
   // 而不是这样（会堵塞）
   docker.shell.exec({command: "node app.js"})
   ```

2. **数据库操作**：
   ```typescript
   // X 知道要这样做
   docker.shell.interactive({
     program: "mysql -uroot -ppassword",
     commands: ["SHOW DATABASES;", "USE mydb;", "SELECT * FROM users;"]
   })
   
   // 而不是这样（会堵塞）
   docker.shell.exec({command: "mysql -uroot -p"})
   ```

3. **后台任务管理**：
   ```typescript
   // X 知道要先安装 screen
   docker.shell.exec({command: "apt-get install -y screen"})
   
   // 然后在 screen 中运行
   docker.shell.exec({command: "screen -dmS task python script.py"})
   ```

## 🧪 测试建议

### 测试 1：Web 服务器
```
用户：帮我在 Docker 里启动一个 Node.js Web 服务器

期望：
1. X 使用 docker.run 创建容器
2. X 使用 docker.shell.enter 进入
3. X 使用 docker.shell.exec 安装依赖
4. X 使用 docker.shell.exec + & 后台启动服务器
5. X 使用 docker.shell.exec 测试服务器
6. X 使用 docker.shell.exit 退出
```

### 测试 2：MySQL 数据库
```
用户：帮我在 MySQL 里创建一个数据库和表

期望：
1. X 使用 docker.run 启动 MySQL
2. X 等待 MySQL 启动（15秒）
3. X 使用 docker.shell.enter 进入
4. X 使用 docker.shell.interactive 执行 SQL 命令
5. X 使用 docker.shell.exit 退出
```

### 测试 3：Python 数据分析
```
用户：帮我分析这个 CSV 文件

期望：
1. X 使用 docker.run 创建 Python 容器，挂载文件
2. X 使用 docker.shell.enter 进入
3. X 使用 docker.shell.exec 安装 pandas
4. X 使用 docker.shell.exec 执行分析脚本
5. X 使用 docker.shell.exit 退出
```

## 📚 相关文档

X 的提示词中引用了这些概念，用户可以在以下文档中找到详细说明：

1. **DOCKER_SHELL_QUICKSTART.md** - 5 分钟快速入门
2. **DOCKER_SHELL_EXAMPLES.md** - 实际使用示例
3. **DOCKER_SHELL_ADVANCED.md** - 高级功能详解
4. **DOCKER_COMPLETE_SUMMARY.md** - 完整功能矩阵
5. **DOCKER_README.md** - 文档索引

## 🎉 效果

现在，当用户说：

- "帮我在 Docker 里启动一个 Web 服务器"
- "帮我在 MySQL 里创建数据库"
- "帮我用 Python 分析数据"
- "帮我在容器里运行这个脚本"

**X 会自动：**
1. ✅ 选择正确的 Docker 工具
2. ✅ 使用正确的参数
3. ✅ 避免堵塞（后台执行）
4. ✅ 正确处理交互式程序
5. ✅ 保持状态连续性
6. ✅ 像真人一样操作容器

## 🚀 下一步

### 建议测试流程

1. **重启服务器**：让新的提示词生效
   ```bash
   cd server && npm run dev
   ```

2. **测试基础功能**：
   - 让 X 启动一个简单的 Web 服务器
   - 让 X 操作 MySQL 数据库
   - 让 X 在容器里运行 Python 脚本

3. **测试高级功能**：
   - 让 X 管理后台任务
   - 让 X 操作多个容器
   - 让 X 使用 screen 管理任务

### 可能需要的调整

如果发现 X 的行为不符合预期，可以：

1. **查看 X 的推理过程**：看 X 是否正确理解了提示词
2. **调整提示词**：如果某些场景需要更明确的指导
3. **添加示例**：在提示词中添加更多具体示例

## 📝 总结

✅ **X 的核心提示词已更新**  
✅ **包含完整的 Docker 使用指南**  
✅ **涵盖所有工具和最佳实践**  
✅ **提供决策树和场景示例**  
✅ **X 现在知道如何使用 Docker！**  

**现在，X 可以像真人一样操作 Docker 容器，处理任何需要容器化的场景！** 🚀
