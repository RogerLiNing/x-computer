import fs from 'node:fs';
import path from 'node:path';

export function validateIsolatedRuntime(env = process.env) {
  if (env.X_COMPUTER_ISOLATED !== '1') return;
  const root = env.X_COMPUTER_WORKSPACE;
  if (!root || !path.isAbsolute(root) || fs.realpathSync(root) !== root) throw new Error('隔离目录必须为独立真实绝对路径');
  const privatePath = path.join(root, 'config.private.json');
  if (env.X_COMPUTER_CONFIG_PATH !== privatePath || env.DATABASE_TYPE !== 'sqlite') throw new Error('隔离启动仅允许目录内 SQLite 配置');
  for (const file of [root, path.join(root, 'home'), privatePath, path.join(root, '.x-isolated.json')]) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('隔离目录和配置必须私有且不能为链接');
  }
  // Resume must not redirect user files or SQLite WAL writes into another environment.
  const pending = [root];
  const linkedFiles = new Map();
  let inspected = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++inspected > 100000) throw new Error('隔离目录条目过多，请单独审核后迁移');
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('隔离运行数据不能包含符号链接');
      if (stat.isFile() && stat.nlink > 1) {
        const key = `${stat.dev}:${stat.ino}`, group = linkedFiles.get(key) ?? { count: 0, links: stat.nlink };
        group.count++; linkedFiles.set(key, group);
      }
      if (stat.isDirectory()) pending.push(file);
    }
  }
  for (const group of linkedFiles.values()) if (group.count !== group.links) throw new Error('隔离运行数据不能与外部文件共享硬链接');
  if (JSON.parse(fs.readFileSync(path.join(root, '.x-isolated.json'), 'utf8')).format !== 'x-computer-isolated-v1') throw new Error('不是已登记的隔离目录');
  const config = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
  if (config.database?.type !== 'sqlite' || config.auth?.allowAnonymous !== false || config.container?.enabled !== false || config.runtime_profile !== 'lightweight') throw new Error('隔离配置的数据库、登录或运行模式不符合要求');
  const allowed = ['database', 'auth', 'container', 'runtime_profile', 'llm_config'];
  if (Object.keys(config).some(key => !allowed.includes(key))) throw new Error('隔离配置不能启用原环境的邮件、扩展或其他集成');
}
