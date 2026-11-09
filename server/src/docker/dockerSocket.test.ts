import { describe, it, expect } from 'vitest';
import { resolveDockerSocketPath, dockerHostArgs, DEFAULT_DOCKER_SOCKET } from './dockerSocket.js';

const existsOnly = (...paths: string[]) => (candidate: string) => paths.includes(candidate);

describe('resolveDockerSocketPath', () => {
  it('优先使用 DOCKER_HOST 指定的 unix socket', () => {
    const result = resolveDockerSocketPath({
      env: { DOCKER_HOST: 'unix:///custom/docker.sock' },
      homeDir: '/home/u',
      exists: existsOnly(DEFAULT_DOCKER_SOCKET),
    });
    expect(result).toBe('/custom/docker.sock');
  });

  it('Linux 默认路径存在时使用默认路径', () => {
    const result = resolveDockerSocketPath({ env: {}, homeDir: '/home/u', exists: existsOnly(DEFAULT_DOCKER_SOCKET) });
    expect(result).toBe(DEFAULT_DOCKER_SOCKET);
  });

  it('默认路径不存在时回退到 OrbStack / Docker Desktop / colima', () => {
    expect(resolveDockerSocketPath({ env: {}, homeDir: '/Users/u', exists: existsOnly('/Users/u/.orbstack/run/docker.sock') }))
      .toBe('/Users/u/.orbstack/run/docker.sock');
    expect(resolveDockerSocketPath({ env: {}, homeDir: '/Users/u', exists: existsOnly('/Users/u/.docker/run/docker.sock') }))
      .toBe('/Users/u/.docker/run/docker.sock');
    expect(resolveDockerSocketPath({ env: {}, homeDir: '/Users/u', exists: existsOnly('/Users/u/.colima/default/docker.sock') }))
      .toBe('/Users/u/.colima/default/docker.sock');
  });

  it('都不存在时返回默认路径，交由连接时报错', () => {
    expect(resolveDockerSocketPath({ env: {}, homeDir: '/Users/u', exists: () => false })).toBe(DEFAULT_DOCKER_SOCKET);
  });

  it('忽略非 unix 的 DOCKER_HOST，继续按候选路径解析', () => {
    const result = resolveDockerSocketPath({
      env: { DOCKER_HOST: 'tcp://10.0.0.1:2375' },
      homeDir: '/Users/u',
      exists: existsOnly('/Users/u/.orbstack/run/docker.sock'),
    });
    expect(result).toBe('/Users/u/.orbstack/run/docker.sock');
  });
});

describe('dockerHostArgs', () => {
  it('生成 docker CLI 的 --host 参数', () => {
    expect(dockerHostArgs('/x/docker.sock')).toEqual(['--host', 'unix:///x/docker.sock']);
  });
});
