import { afterEach, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { SessionAuth } from './sessionAuth.js';

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

it('isolated environments cannot replace or revoke the original session cookie', async () => {
  const records = new Map<string,string>();
  const db = { getConfig: async (user:string,key:string) => records.get(user+key), setConfig: async (user:string,key:string,value:string) => { records.set(user+key,value); } };
  delete process.env.X_COMPUTER_ISOLATED;
  const original = new SessionAuth(db), originalCookie = await original.createCookie('fixture');
  expect(originalCookie.startsWith('x_session=')).toBe(true);
  process.env.X_COMPUTER_ISOLATED = '1'; process.env.X_COMPUTER_WORKSPACE = '/isolated-a';
  const isolated = new SessionAuth(db), isolatedCookie = await isolated.createCookie('fixture');
  process.env.X_COMPUTER_WORKSPACE = '/isolated-b';
  const another = new SessionAuth(db);
  expect(await isolated.authenticate(originalCookie)).toBeNull();
  expect(await another.authenticate(isolatedCookie)).toBeNull();
  const emitted:string[] = [];
  await isolated.logout({headers:{cookie: `${originalCookie}; ${isolatedCookie}`}} as Request,{append: (_key:string,value:string) => emitted.push(value)} as unknown as Response);
  expect(emitted[0]).toMatch(/^x_session_isolated_/);
  expect(await original.authenticate(originalCookie)).not.toBeNull();
  expect(await isolated.authenticate(isolatedCookie)).toBeNull();
});
