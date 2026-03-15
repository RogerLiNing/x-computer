/**
 * WhatsApp Baileys VPN 模式测试
 * 使用本地 VPN（GoGoJumpVPN）而不是代理
 */

import makeWASocket, { useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TEST_AUTH_DIR = path.join(os.tmpdir(), 'whatsapp-vpn-test', Date.now().toString());

console.log('🧪 WhatsApp VPN 模式测试');
console.log('测试目录:', TEST_AUTH_DIR);
console.log('请确保 GoGoJumpVPN 或其他 VPN 正在运行');
console.log('---');

fs.mkdirSync(TEST_AUTH_DIR, { recursive: true });

async function testVPN() {
  console.log('\n📡 测试 VPN 模式（无代理配置）...');
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(TEST_AUTH_DIR);
    
    console.log('  创建 WASocket（VPN 模式）...');
    const WHATSAPP_VERSION = [2, 3000, 1027934701];
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      version: WHATSAPP_VERSION,
      browser: Browsers.macOS('Desktop'),
      // syncFullHistory 必须为 true 才能触发 DARWIN 平台识别
      syncFullHistory: true,
      markOnlineOnConnect: false,
      connectTimeoutMs: 30000,
      logger: {
        level: 'warn',
        trace: () => {},
        debug: () => {},
        info: (msg) => console.log('    [Info]', JSON.stringify(msg)),
        warn: (msg) => console.warn('    [Warn]', JSON.stringify(msg)),
        error: (msg) => console.error('    [Error]', JSON.stringify(msg)),
        fatal: (msg) => console.error('    [Fatal]', JSON.stringify(msg)),
        child: () => ({
          level: 'warn',
          trace: () => {},
          debug: () => {},
          info: (msg) => console.log('    [Child Info]', JSON.stringify(msg)),
          warn: (msg) => console.warn('    [Child Warn]', JSON.stringify(msg)),
          error: (msg) => console.error('    [Child Error]', JSON.stringify(msg)),
          fatal: (msg) => console.error('    [Child Fatal]', JSON.stringify(msg)),
          child: () => ({}),
        }),
      },
    });
    
    console.log('  ✅ WASocket 创建成功');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sock.end();
        reject(new Error('连接超时（30秒）'));
      }, 30000);
      
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          console.log('  📱 收到 QR 码（长度:', qr.length, '字符）');
          console.log('  ✅ VPN 模式连接成功！');
          clearTimeout(timeout);
          sock.end();
          resolve({ success: true, qr: true });
        }
        
        if (connection === 'open') {
          console.log('  ✅ 连接成功！');
          clearTimeout(timeout);
          sock.end();
          resolve({ success: true, connected: true });
        }
        
        if (connection === 'close') {
          const err = lastDisconnect?.error;
          const message = err?.message || 'Unknown error';
          
          console.error('  ❌ 连接关闭:', message);
          
          clearTimeout(timeout);
          sock.end();
          reject(new Error(`Connection closed: ${message}`));
        }
      });
      
      sock.ev.on('creds.update', saveCreds);
    });
    
  } catch (error) {
    console.error('  ❌ 测试失败:', error.message);
    throw error;
  }
}

async function run() {
  try {
    await testVPN();
    console.log('\n✅ VPN 模式测试成功！');
    console.log('结论：可以使用 VPN 模式连接 WhatsApp，无需配置代理');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ VPN 模式测试失败！');
    console.error('错误:', error.message);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

run();
