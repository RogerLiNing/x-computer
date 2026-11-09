/**
 * 统一解析 Docker daemon 的 unix socket 路径。
 *
 * 顺序：DOCKER_HOST(unix://) → Linux 默认 /var/run/docker.sock → OrbStack → Docker Desktop → colima。
 * 都不存在时返回默认路径，由实际连接给出清晰报错。
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';

export const DEFAULT_DOCKER_SOCKET = '/var/run/docker.sock';

const UNIX_PREFIX = 'unix://';
const HOME_RELATIVE_SOCKETS: readonly string[] = [
  '.orbstack/run/docker.sock',
  '.docker/run/docker.sock',
  '.colima/default/docker.sock',
];

export interface DockerSocketEnv {
  env?: Readonly<Record<string, string | undefined>>;
  homeDir?: string;
  exists?: (candidate: string) => boolean;
}

export function resolveDockerSocketPath(options: DockerSocketEnv = {}): string {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const exists = options.exists ?? existsSync;

  const dockerHost = env.DOCKER_HOST?.trim();
  if (dockerHost?.startsWith(UNIX_PREFIX)) return dockerHost.slice(UNIX_PREFIX.length);

  const candidates = [DEFAULT_DOCKER_SOCKET, ...HOME_RELATIVE_SOCKETS.map((rel) => path.join(homeDir, rel))];
  return candidates.find((candidate) => exists(candidate)) ?? DEFAULT_DOCKER_SOCKET;
}

/** docker CLI 使用的 --host 参数 */
export function dockerHostArgs(socketPath: string = resolveDockerSocketPath()): string[] {
  return ['--host', `${UNIX_PREFIX}${socketPath}`];
}

/** 创建连接到解析后 socket 的 dockerode 客户端 */
export function createDockerClient(): Docker {
  const dockerHost = process.env.DOCKER_HOST?.trim();
  // tcp:// 等非 unix 地址交给 dockerode 自己按 DOCKER_HOST / DOCKER_TLS_VERIFY 解析
  if (dockerHost && !dockerHost.startsWith(UNIX_PREFIX)) return new Docker();
  return new Docker({ socketPath: resolveDockerSocketPath() });
}
