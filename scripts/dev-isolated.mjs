import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

export async function prepareIsolated({ resume, modelConfig, serverPort = '4100', frontendPort = '3100' } = {}) {
  for (const port of [serverPort, frontendPort]) {
    if (!/^\d+$/.test(String(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error('端口须在 1024–65535 之间');
  }
  if (Number(serverPort) === Number(frontendPort)) throw new Error('前后端端口不能相同');
  if (resume && modelConfig) throw new Error('恢复环境不会覆盖配置；请修改该环境的配置副本');
  const root = resume ? path.resolve(resume) : await mkdtemp(path.join(await realpath(os.tmpdir()), 'x-computer-isolated-'));
  const configPath = path.join(root, 'config.private.json');
  if (!resume) {
    let llm_config = { providers: [] };
    if (modelConfig) {
      const source = JSON.parse(await readFile(path.resolve(modelConfig), 'utf8'));
      if (!Array.isArray(source?.llm_config?.providers)) throw new Error('模型配置需要 llm_config.providers');
      const resolve = value => {
        if (typeof value === 'string') return value.replace(/\{env:([^}]+)\}/g, (_, key) => {
          if (!process.env[key.trim()]) throw new Error('模型配置引用的环境变量未设置');
          return process.env[key.trim()];
        });
        if (Array.isArray(value)) return value.map(resolve);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
        return value;
      };
      llm_config = resolve(source.llm_config);
    }
    await writeFile(configPath, JSON.stringify({ database: { type: 'sqlite' }, auth: { allowAnonymous: false, allowRegister: true }, container: { enabled: false }, runtime_profile: 'lightweight', llm_config }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(root, '.x-isolated.json'), JSON.stringify({ format: 'x-computer-isolated-v1' }), { flag: 'wx', mode: 0o600 });
    await mkdir(path.join(root, 'home'), { mode: 0o700 });
  }
  // Do not inherit database, channel, payment, MCP or Node preload credentials.
  const env = {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: path.join(root, 'home'), TMPDIR: root, LANG: 'en_US.UTF-8',
    X_COMPUTER_ISOLATED: '1', X_COMPUTER_CONFIG_PATH: configPath,
    X_COMPUTER_WORKSPACE: root, DATABASE_TYPE: 'sqlite',
    X_COMPUTER_REQUIRE_LOGIN: 'true', X_COMPUTER_PROFILE: 'lightweight',
    X_COMPUTER_PLUGINS: 'productivity,automation',
    HOST: '127.0.0.1', PORT: String(Number(serverPort)),
    X_COMPUTER_DEV_API_PORT: String(Number(serverPort)),
    X_COMPUTER_DEV_ORIGIN: `http://127.0.0.1:${Number(frontendPort)}`,
  };
  // Use the same fail-closed check as the server before starting either child.
  const { validateIsolatedRuntime } = await import('../server/src/config/isolatedRuntime.mjs');
  validateIsolatedRuntime(env);
  return { root, configPath, env, frontendPort: String(Number(frontendPort)) };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--init-only') options.initOnly = true;
    else {
      const key = { '--resume': 'resume', '--model-config': 'modelConfig', '--server-port': 'serverPort', '--frontend-port': 'frontendPort' }[args[i]];
      if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数无效；参见 docs/ISOLATED_DEVELOPMENT.md');
      options[key] = args[++i];
    }
  }
  const prepared = await prepareIsolated(options);
  console.log(`隔离目录：${prepared.root}\n私有配置：${prepared.configPath}\n数据库：SQLite（仅本目录）\n页面：http://127.0.0.1:${prepared.frontendPort}\n恢复命令：npm run dev:isolated -- --resume '${prepared.root.replaceAll("'", "'\\''")}' --server-port ${prepared.env.PORT} --frontend-port ${prepared.frontendPort}`);
  if (options.initOnly) return;
  const child = spawn(process.execPath, [path.join(repository, 'node_modules/concurrently/dist/bin/concurrently.js'), '--kill-others', '--success', 'all',
    'npm run dev:server', `npm run dev --workspace=frontend -- --host 127.0.0.1 --port ${prepared.frontendPort} --strictPort`],
    { cwd: repository, env: prepared.env, stdio: 'inherit', shell: false });
  const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  child.once('error', () => { console.error('隔离服务启动失败，请检查依赖'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('隔离启动被拒绝：请检查参数、私有配置、目录标识和权限。未回退到原配置。'); process.exitCode = 1; });
}
