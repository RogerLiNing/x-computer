# X-Computer SDK

TypeScript/JavaScript SDK for X-Computer.

## Installation

```bash
npm install @x-computer/sdk
# or
yarn add @x-computer/sdk
# or
pnpm add @x-computer/sdk
```

## Quick Start

```typescript
import { createClient } from '@x-computer/sdk'

// Create client
const client = createClient({
  baseUrl: 'http://localhost:4000',
  userId: 'user-123'
})

// Create a task
const task = await client.createTask({
  domain: 'coding',
  goal: 'Create a React component',
  context: 'Build a button with click handler'
})

// Get task status
const status = await client.getTask(task.id)

// Execute a tool
const result = await client.executeTool('file_read', {
  path: '/src/App.tsx'
})

// Run shell command
const shellResult = await client.runCommand('npm test', {
  timeout: 60000
})
```

## Authentication

```typescript
// Login with email/password
const auth = await client.login('user@example.com', 'password')

// Set user ID
client.setUserId('user-123')

// Logout
await client.logout()
```

## Task Management

```typescript
// Create task
const task = await client.createTask({
  domain: 'agent',
  goal: 'Research AI trends'
})

// List tasks
const tasks = await client.listTasks({
  domain: 'agent',
  status: 'completed',
  limit: 10
})

// Pause/Resume
await client.pauseTask(task.id)
await client.resumeTask(task.id)
```

## File Operations

```typescript
// Read file
const content = await client.readFile('/src/index.ts')

// Write file
await client.writeFile('/src/hello.ts', 'export const hello = "world"')

// List directory
const files = await client.listDirectory('/src')
```

## Shell Commands

```typescript
// Run command
const result = await client.runCommand('npm run build', {
  timeout: 120000,
  cwd: '/project'
})

console.log(result.stdout)
console.log(result.stderr)
console.log(result.exitCode)
```

## Subscription Management

```typescript
// Get available plans
const plans = await client.getPlans()

// Get current subscription
const subscription = await client.getSubscription()

// Get usage
const usage = await client.getUsage()
```

## API Reference

### Client Options

```typescript
interface XComputerConfig {
  baseUrl: string          // Server URL
  apiKey?: string          // API key
  userId?: string          // User ID
  timeout?: number         // Request timeout (ms)
  retries?: number         // Number of retries
  headers?: Record<string, string>  // Custom headers
}
```

### Methods

- `login(email, password)` - Login with credentials
- `logout()` - Logout current user
- `getCurrentUser()` - Get current user info
- `setUserId(userId)` - Set user ID
- `createTask(request)` - Create new task
- `getTask(id)` - Get task by ID
- `listTasks(filter?)` - List tasks
- `pauseTask(id)` - Pause task
- `resumeTask(id)` - Resume task
- `executeTool(name, params)` - Execute tool
- `readFile(path)` - Read file
- `writeFile(path, content)` - Write file
- `listDirectory(path)` - List directory
- `runCommand(command, options?)` - Run shell command
- `getPlans()` - Get subscription plans
- `getSubscription()` - Get current subscription
- `getUsage(limit?)` - Get usage history
- `getComputerContext()` - Get desktop context
- `setComputerContext(context)` - Set desktop context

## Error Handling

```typescript
import { XComputerError, ERROR_CODES } from '@x-computer/sdk'

try {
  await client.readFile('/nonexistent')
} catch (error) {
  if (error instanceof XComputerError) {
    console.log(error.code)      // FILE_NOT_FOUND
    console.log(error.message)   // File not found
    console.log(error.statusCode) // 404
  }
}
```

## Utilities

```typescript
import {
  formatBytes,
  formatDuration,
  formatDate,
  generateId,
  retry,
  withTimeout
} from '@x-computer/sdk'

// Format bytes
formatBytes(1048576) // "1.00 MB"

// Format duration
formatDuration(123456) // "2.1m"

// Generate ID
const id = generateId('task') // "task-abc123-def456"

// Retry function
await retry(() => client.getTask(id), { maxRetries: 3 })

// Timeout
await withTimeout(
  client.runCommand('npm test'),
  30000 // 30 seconds
)
```

## License

MIT