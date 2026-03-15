# Docker Shell 快速入门

## 5 分钟上手

### 1. 创建并进入容器

```typescript
// 创建后台容器
await docker.run({
  image: "node:20",
  detach: true,
  name: "my-dev"
});

// 进入 Shell
await docker.shell.enter({
  container: "my-dev"
});
```

### 2. 执行命令

```typescript
// 执行单个命令
await docker.shell.exec({
  container: "my-dev",
  command: "npm init -y"
});

// 继续执行（保持状态）
await docker.shell.exec({
  container: "my-dev",
  command: "npm install express"
});
```

### 3. 退出并清理

```typescript
// 退出 Shell
await docker.shell.exit({
  container: "my-dev"
});

// 停止容器
await docker.stop({
  container: "my-dev"
});
```

## 完整示例

### 示例 1：快速脚本执行

```typescript
// 一次性任务（不需要 Shell）
const result = await docker.run({
  image: "python:3.11",
  script: "print('Hello World')"
});

console.log(result.stdout); // "Hello World"
```

### 示例 2：多步开发流程

```typescript
// 1. 创建开发容器
await docker.run({
  image: "node:20",
  detach: true,
  name: "web-app",
  ports: { "3000": "3000" },
  volumes: { "/Users/me/project": "/workspace" }
});

// 2. 进入 Shell
await docker.shell.enter({
  container: "web-app",
  workdir: "/workspace"
});

// 3. 初始化项目
await docker.shell.exec({
  container: "web-app",
  command: "npm init -y"
});

// 4. 安装依赖
await docker.shell.exec({
  container: "web-app",
  command: "npm install express"
});

// 5. 创建应用
await docker.shell.exec({
  container: "web-app",
  command: `cat > app.js << 'EOF'
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello!'));
app.listen(3000);
EOF`
});

// 6. 启动应用
await docker.shell.exec({
  container: "web-app",
  command: "node app.js &"
});

// 7. 退出 Shell
await docker.shell.exit({
  container: "web-app"
});

// 8. 查看日志
await docker.logs({
  container: "web-app"
});
```

### 示例 3：数据库操作

```typescript
// 1. 启动 MySQL
await docker.run({
  image: "mysql:8",
  detach: true,
  name: "mysql-db",
  env: { "MYSQL_ROOT_PASSWORD": "password" },
  ports: { "3306": "3306" }
});

// 2. 等待启动
await sleep(10000);

// 3. 进入 Shell
await docker.shell.enter({
  container: "mysql-db"
});

// 4. 创建数据库
await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword -e 'CREATE DATABASE mydb;'"
});

// 5. 创建表
await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword -e 'USE mydb; CREATE TABLE users (id INT, name VARCHAR(100));'"
});

// 6. 插入数据
await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword -e 'USE mydb; INSERT INTO users VALUES (1, \"Alice\");'"
});

// 7. 查询数据
const result = await docker.shell.exec({
  container: "mysql-db",
  command: "mysql -uroot -ppassword -e 'USE mydb; SELECT * FROM users;'"
});

console.log(result.output);

// 8. 退出
await docker.shell.exit({
  container: "mysql-db"
});
```

## 何时使用 Shell？

### ✅ 使用 Shell 会话

- 多步操作（安装、配置、测试）
- 需要保持工作目录
- 需要保持环境变量
- 调试和开发
- 交互式工具（数据库命令行等）

### ❌ 不使用 Shell 会话

- 单次命令执行 → 用 `docker.run` 或 `docker.exec`
- 不需要状态连续性 → 用 `docker.run`
- 短期任务 → 用 `docker.run` (foreground 模式)

## 常见模式

### 模式 1：开发 → 测试 → 部署

```typescript
// 开发
await docker.shell.enter({ container: "dev" });
await docker.shell.exec({ container: "dev", command: "npm install" });
await docker.shell.exec({ container: "dev", command: "npm run build" });

// 测试
await docker.shell.exec({ container: "dev", command: "npm test" });

// 部署
await docker.shell.exec({ container: "dev", command: "npm run deploy" });

await docker.shell.exit({ container: "dev" });
```

### 模式 2：调试问题

```typescript
// 进入容器
await docker.shell.enter({ container: "app" });

// 查看日志
await docker.shell.exec({ container: "app", command: "tail -n 100 /var/log/app.log" });

// 检查进程
await docker.shell.exec({ container: "app", command: "ps aux" });

// 检查网络
await docker.shell.exec({ container: "app", command: "netstat -tulpn" });

// 修复问题
await docker.shell.exec({ container: "app", command: "systemctl restart app" });

await docker.shell.exit({ container: "app" });
```

### 模式 3：数据处理流水线

```typescript
await docker.shell.enter({ container: "data-pipeline" });

// 下载数据
await docker.shell.exec({
  container: "data-pipeline",
  command: "wget https://example.com/data.csv"
});

// 清洗数据
await docker.shell.exec({
  container: "data-pipeline",
  command: "python clean.py data.csv"
});

// 分析数据
await docker.shell.exec({
  container: "data-pipeline",
  command: "python analyze.py cleaned_data.csv"
});

// 生成报告
await docker.shell.exec({
  container: "data-pipeline",
  command: "python report.py analysis.json"
});

await docker.shell.exit({ container: "data-pipeline" });
```

## 工具对比速查表

| 需求 | 使用工具 |
|------|---------|
| 运行单个命令 | `docker.run` (foreground) |
| 创建后台服务 | `docker.run` (detach: true) |
| 在运行容器执行单个命令 | `docker.exec` |
| 多步操作（保持状态） | `docker.shell.enter` + `docker.shell.exec` |
| 查看容器日志 | `docker.logs` |
| 停止容器 | `docker.stop` |
| 列出容器 | `docker.list` |
| 拉取镜像 | `docker.pull` |

## 最佳实践

### 1. 总是关闭会话

```typescript
try {
  await docker.shell.enter({ container: "app" });
  // ... 操作 ...
} finally {
  await docker.shell.exit({ container: "app" });
}
```

### 2. 设置合理的超时

```typescript
// 长时间运行的命令
await docker.shell.exec({
  container: "app",
  command: "npm install",
  timeout: 120000  // 2 分钟
});
```

### 3. 检查命令输出

```typescript
const result = await docker.shell.exec({
  container: "app",
  command: "npm test"
});

if (result.output.includes("FAILED")) {
  console.error("测试失败！");
}
```

### 4. 使用卷挂载共享文件

```typescript
await docker.run({
  image: "node:20",
  detach: true,
  name: "dev",
  volumes: {
    "/Users/me/project": "/workspace"  // 宿主机 → 容器
  }
});
```

## 故障排除

### 问题：会话未找到

```
错误：没有找到活跃的 Shell 会话
解决：先调用 docker.shell.enter
```

### 问题：命令超时

```
错误：Timeout waiting for prompt
解决：增加 timeout 参数或检查命令是否需要交互式输入
```

### 问题：容器不存在

```
错误：Failed to start shell session
解决：使用 docker.list 检查容器是否存在和运行
```

## 总结

Docker Shell 会话让 AI 可以：

✅ 像真人一样操作容器  
✅ 保持状态连续性  
✅ 适用于复杂多步场景  
✅ 与现有 Docker 工具完美配合  

现在开始使用吧！🚀
