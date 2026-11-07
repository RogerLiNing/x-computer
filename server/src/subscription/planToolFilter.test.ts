import { describe, expect, it } from 'vitest';
import { filterToolsByPlan, type LLMToolDef } from './planToolFilter.js';

const tools: LLMToolDef[] = [
  'x.create_app',
  'x.list_apps',
  'x.get_app_logs',
  'capability.search',
  'capability.load',
  'x.notify_user',
  'x.record_done',
  'x.schedule_run',
  'read_recent_assistant_chat',
  'memory_search',
  'file.read',
  'file.extract_text',
  'server.deploy',
  'x.create_agent',
  'x.dispatch_agent',
  'x.get_agent_run',
  'x.dispatch_team',
  'x.dispatch_group',
  'x.run_agent',
  'x.run_team',
  'x.run_group',
].map((name) => ({
  name,
  description: name,
  parameters: {},
}));

describe('filterToolsByPlan', () => {
  it('allows all six approval-gated send tools on a basic plan', () => {
    const sends = ['email','qq','whatsapp','telegram','discord','slack'].map(channel => ({
      name: `x.send_${channel}`, description: '', parameters: {},
    }));
    expect(filterToolsByPlan(sends, ['basic_features'])).toEqual(sends);
  });
  it('allows pure reminder creation on the basic plan',()=>{
    const tool={name:'x.schedule_reminder',description:'reminder',parameters:{}};expect(filterToolsByPlan([tool],['basic_features'])).toEqual([tool]);
  });
  it('keeps local Office creation and reading available without a paid plan',()=>{
    const office=['office.create_docx','office.read_docx','office.create_xlsx','office.read_xlsx','office.create_pptx','office.read_pptx'].map(name=>({name,description:name,parameters:{}}));
    expect(filterToolsByPlan(office,['basic_features'])).toEqual(office);
    expect(filterToolsByPlan(office,[])).toEqual(office);
  });
  it('allows safe Office copy edits on the basic plan',()=>{
    const edit={name:'office.edit_copy',description:'XML copy edit',parameters:{}};
    expect(filterToolsByPlan([edit],['basic_features'])).toEqual([edit]);
  });
  it('keeps the X core runtime usable on the basic plan', () => {
    expect(filterToolsByPlan(tools, ['basic_features']).map((tool) => tool.name)).toEqual([
      'x.create_app',
  'x.list_apps',
  'x.get_app_logs',
  'capability.search',
      'capability.load',
      'x.notify_user',
      'x.record_done',
      'x.schedule_run',
      'read_recent_assistant_chat',
      'memory_search',
      'file.read',
      'file.extract_text',
      'x.create_agent',
      'x.dispatch_agent',
      'x.get_agent_run',
      'x.dispatch_team',
      'x.dispatch_group',
      'x.run_agent',
      'x.run_team',
      'x.run_group',
    ]);
  });

  it('continues to block advanced plugin tools on the basic plan', () => {
    const names = filterToolsByPlan(tools, ['basic_features']).map((tool) => tool.name);
    expect(names).not.toContain('server.deploy');
  });

  it('allows every tool when advanced tools are enabled', () => {
    expect(filterToolsByPlan(tools, ['advanced_tools'])).toEqual(tools);
  });
});
