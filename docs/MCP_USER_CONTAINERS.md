# 用户扩展的容器执行

MCP 的发现、配置测试与实际工具调用共用 client/clientStdio。用户 JSON 中的 containerId、trustedServer 等字段不授予执行权限；上下文由服务器依据登录账号和配置来源构造。未提供隔离容器时拒绝 stdio，不回退到宿主 spawn。

## 本地进程

UserContainerManager 按用户及扩展配置指纹创建独立 MCP 容器，使用管理员配置的沙箱镜像。用户 Shell、另一用户以及同一用户的其他扩展使用不同容器。仅绑定该用户工作区至 /workspace，不挂载 Docker Socket；沿用非特权、只读根文件系统、CPU/内存/PID 限制。MCP 禁用 host 网络；默认无网络，bridge 需要管理员的运行配置允许。

Docker exec 的宿主命令固定，扩展 command/args/env 通过标准输入传入容器中的固定启动器。宿主环境不复制给扩展；子进程仅获得显式变量和必要的基础环境。HOME、工作目录与 npm 缓存在独立容器的 /tmp/x-mcp，防止平台扩展使用用户可改写的 npm 缓存。stdio stderr 不写入宿主日志。退出或停止时回收该扩展进程组，不影响另一用户的连接。

宿主需要可用的 Docker CLI 和 Unix Socket；沙箱镜像需要 Node.js。本地相对脚本应写成 /workspace 下的完整容器路径。无网络配置下无法临时下载 npm/Python 包，需要管理员预装到镜像。MCP 私有 tmpfs 允许执行安装的依赖；普通 Shell tmpfs 仍保留原有 noexec 限制。容器以非 root 身份执行，并匹配非 root 服务进程的 UID/GID，便于读写挂载工作区；服务进程为 root 时使用 1000:1000。

相同扩展编号按用户保存连接。配置不变时复用连接，发现缓存不终止正在执行的调用；变更配置时只关闭该用户的旧连接。每次工具调用确认容器可用后再执行。定义、模型可见列表和实际派发均优先使用用户自己的同名扩展，避免平台同名工具覆盖或重复出现。

## HTTP 扩展

用户配置只替换自己的显式环境变量，不读取宿主变量。用户 HTTP(S) 扩展禁止连接内网、元数据及保留地址；DNS 查询得到的地址全部经过检查，连接使用同一次查询的数值地址，拒绝 IPv6 及 VPN fake-IP 地址，不跟随重定向。管理员固定配置的服务可使用其内部端点与显式宿主变量替换；普通用户不能在 JSON 中自行声明为管理员配置。

不再记录完整 URL、请求头、参数或服务端错误正文，也不会自动把 Header 中的密钥复制到 URL。请求、响应及工具分页有大小或次数限制。鉴权失败、连接中断及超时不会自动重放 tools/call；JSON-RPC 与 SSE 均要求响应编号匹配。这里只支持现有直接 HTTP JSON/SSE 回执，并不代表已完成所有远程 MCP 会话协议及各厂商兼容验收。

## 停止与结果未知

工具调用发出后未取得有效回执，抛出 UncertainToolOutcomeError。执行器将其交还检查点所有者，不制造一条已结算工具消息；ChatRun 因待定调用进入不可直接恢复的状态，要求核实后重新交办。主动停止也会关闭连接、回收扩展进程组。关闭本地连接不能撤销第三方已经发生的操作。

## 验证与限制

真实 Docker 测试命令：

```sh
X_MCP_TEST_IMAGE=x-computer-sandbox:latest npm run test --workspace=server -- src/mcp/isolation.live.test.ts src/mcp/client.security.test.ts
```

测试证明同名扩展跨用户隔离、宿主哨兵及环境变量不可见、无 Docker Socket、平台与用户扩展容器不同、关闭一名用户的进程不影响另一用户，以及主动取消和真实写入后丢失回执不自动重放。测试容器停止后保留，工作区测试文件保留。

真实模型任务 b19698b1ce8248694ccfe13580832ee8 只调用 mcp.acceptance_cb5160ef.inspect 一次，读取“隔离扩展验收”，回执的宿主环境和 Docker Socket 均为 false；已在项目浏览器核对并验收。证据使用 outputs/x-computer-mcp-isolation-20261031/real-model-cb5160ef-verified.json，容器身份按标准化后的配置验证；accepted.png 为用户可见结果。验收使用独立 SQLite，不修改原 MySQL 或记忆策略。

尚未证明第三方账号授权、所有远程 MCP 协议、容器互联网出口及恶意扩展的资源公平性。桥接网络不能视作已限制全部内网出口，平台预设必须使用可信扩展和依赖。老容器不会因配置修复自动重新创建。公开上线前还需统一高风险确认、服务预算、生成应用隔离及剩余出口审计。

执行参数依据 [Docker exec 官方说明](https://docs.docker.com/reference/cli/docker/container/exec/)，实际隔离和回收结果以本地测试为准。
