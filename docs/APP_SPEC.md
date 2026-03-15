# X-Computer 应用开发规范

本文档定义 X-Computer 桌面应用的开发规范。符合规范的应用可被识别为**内置应用**（随系统提供）或**安装应用**（用户按规范开发并安装到电脑中）。

---

## 1. 应用清单 (App Manifest)

每个应用必须提供一份 **AppManifest**，描述应用元数据与运行方式。

### 1.1 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识。内置应用使用如 `file-manager`；安装应用建议使用反向域名，如 `com.example.myapp` |
| `name` | string | ✅ | 显示名称（桌面图标、窗口标题、任务栏） |
| `description` | string |  | 简短描述，用于搜索与设置页 |
| `version` | string |  | 语义化版本，如 `1.0.0` |
| `author` | string |  | 作者或组织 |
| `source` | `'builtin' \| 'installed'` | ✅ | 来源：内置 / 用户安装 |
| `icon` | string | ✅ | 图标：`lucide-react` 图标名（如 `FolderOpen`）或图标 URL |
| `aliasBuiltin` | BuiltinAppId |  | 仅安装应用。表示“快捷方式”：打开时使用该内置应用的界面与能力 |
| `entry` | string |  | 仅安装应用。未来支持：应用模块 URL，用于加载第三方实现的界面 |
| `defaultSize` | `{ width, height }` |  | 建议默认窗口宽高（像素） |

### 1.2 内置应用

- 由系统预置，`source: 'builtin'`，不可卸载。
- 当前内置应用 ID：`file-manager`、`terminal`、`browser`、`chat`、`code-editor`、`text-editor`、`spreadsheet`、`email`、`calendar`、`settings`、`task-timeline`。
- 界面由前端代码直接实现并注册到应用注册表。

### 1.3 安装应用

- 用户通过「安装」加入电脑，`source: 'installed'`。
- 当前支持两种形式：
  1. **快捷方式（alias）**：`aliasBuiltin` 指向某内置应用，使用自定义 `name`/`icon`，打开时复用该内置应用的界面。
  2. **独立模块（规划中）**：`entry` 指向可加载的模块 URL，运行第三方实现的界面。

### 1.4 清单示例

**内置应用（由系统注册）：**

```json
{
  "id": "file-manager",
  "name": "文件管理器",
  "description": "浏览与管理沙箱文件",
  "source": "builtin",
  "icon": "FolderOpen"
}
```

**安装应用（快捷方式）：**

```json
{
  "id": "com.mycompany.quick-terminal",
  "name": "我的终端",
  "description": "快速打开终端",
  "version": "1.0.0",
  "author": "My Company",
  "source": "installed",
  "icon": "Terminal",
  "aliasBuiltin": "terminal",
  "defaultSize": { "width": 700, "height": 440 }
}
```

---

## 2. 应用界面规范（内置 / 未来独立模块）

当应用需要自行实现界面时（内置应用或未来通过 `entry` 加载的模块），组件需符合以下约定。

### 2.1 组件 Props

应用根组件接收的 props 由系统注入：

```ts
interface XComputerAppProps {
  /** 当前窗口实例 ID */
  windowId: string;
  /** 应用标识（内置 id 或安装应用 id） */
  appId: string;
  /** 打开时传入的额外参数，如文件路径 */
  metadata?: Record<string, unknown>;
}
```

### 2.2 能力与限制

- 可使用 X-Computer 提供的 **API 客户端**（如 `@/utils/api`）访问任务、文件、Shell、审计等。
- 可通过 **Zustand store**（如 `useDesktopStore`）获取执行模式、通知、窗口状态等。
- 应避免直接操作 DOM 或覆盖系统级快捷键；窗口生命周期由系统管理。

### 2.3 窗口标题

- 系统根据 manifest 的 `name` 设置默认标题；应用可通过 store 的 `setWindowTitle(windowId, title)` 动态更新。

---

## 3. 注册与安装流程

### 3.1 内置应用

- 在 **应用注册表** 中预置所有内置应用的 manifest。
- 桌面、任务栏、搜索等从注册表读取「所有应用」（内置 + 已安装）并展示。

### 3.2 安装应用

1. 用户提供符合规范的 **AppManifest**（通过设置页「安装应用」、拖入 manifest 文件或未来从应用市场选择）。
2. 系统校验必填字段与 `id` 唯一性（不与内置、已安装冲突）。
3. 将 manifest 写入 **已安装应用列表**（当前为前端 localStorage），并出现在桌面/任务栏/搜索中。
4. 打开时：若存在 `aliasBuiltin`，则加载对应内置应用界面；若未来支持 `entry`，则从 `entry` 加载模块并渲染。

### 3.3 卸载

- 用户可从设置中「卸载」已安装应用；仅移除注册信息，不删除用户数据（若有）。

---

## 4. 类型定义（shared）

应用相关类型在 `@shared/index` 中导出，供前端与后续工具链使用：

- `BuiltinAppId`：内置应用 ID 联合类型
- `AppId`：与 BuiltinAppId 同义（兼容）
- `AppIdentifier`：任意应用标识（内置 ID 或安装应用 id 字符串）
- `AppSource`：`'builtin' | 'installed'`
- `AppManifest`：如上字段的接口

---

## 5. 扩展与后续

- **应用市场 / 发现**：可在此基础上增加服务端目录与安装接口。
- **entry 模块格式**：未来可约定 UMD/ES 模块格式与沙箱要求，用于安全加载第三方界面。
- **权限与策略**：可在 manifest 中增加 `permissions` 等字段，与后端策略与审批联动。
