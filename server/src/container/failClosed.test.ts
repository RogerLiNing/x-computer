import {describe,it,expect,vi} from 'vitest';import {createApp} from '../app.js';import {createDatabase} from '../db/database.js';
const fixture=vi.hoisted(()=>({container:{enabled:true,browserEnabled:false,browserNetworkMode:'none',browserDnsMode:'system'}}));
vi.mock('../config/defaultConfig.js',()=>({loadDefaultConfig:()=>fixture,getToolLoadingMode:()=>'all',clearDefaultConfigCache:()=>{}}));
vi.mock('./UserContainerManager.js',()=>({UserContainerManager:class{async ensureImageExists(){throw new Error('Docker unavailable in fixture');}}}));
vi.mock('../db/database.js',()=>({createDatabase:vi.fn()}));
describe('required container isolation',()=>{
 it('fails before opening a database instead of enabling host execution',async()=>{
  await expect(createApp({workspaceRoot:'/tmp/x-security-container-fixture',databaseType:'sqlite',useContainerIsolation:true})).rejects.toThrow('拒绝降级');
  expect(createDatabase).not.toHaveBeenCalled();
 });
 it.each([['host','system'],['none','invalid']])('rejects invalid browser configuration before database access: %s / %s',async(network,dns)=>{
  fixture.container.browserEnabled=true;fixture.container.browserNetworkMode=network;fixture.container.browserDnsMode=dns;
  try{await expect(createApp({workspaceRoot:'/tmp/x-security-container-fixture',databaseType:'sqlite'})).rejects.toThrow(/浏览器/);expect(createDatabase).not.toHaveBeenCalled();}
  finally{fixture.container.browserEnabled=false;fixture.container.browserNetworkMode='none';fixture.container.browserDnsMode='system';}
 });

});
