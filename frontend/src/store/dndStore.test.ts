import {describe,it,expect} from 'vitest';
import {getDndGeneration,beginDndUpdate,endDndUpdate,applyDndPreferences,setDndEnabled,isDndActive,isDndUpdating,setDndPreferences} from './dndStore';

describe('shared DND preference ownership',()=>{
 it('invalidates both windows initial reads and reads begun during a manual save',()=>{
  setDndPreferences({enabled:false,quietHoursStart:null,quietHoursEnd:null});const initialA=getDndGeneration(),initialB=getDndGeneration();
  const update=beginDndUpdate()!;setDndEnabled(true);const duringSave=getDndGeneration();
  expect(isDndUpdating()).toBe(true);expect(beginDndUpdate()).toBeNull();
  expect(applyDndPreferences({enabled:false},initialA)).toBe(false);endDndUpdate(update);
  expect(applyDndPreferences({enabled:false},initialB)).toBe(false);expect(applyDndPreferences({enabled:false},duringSave)).toBe(false);expect(isDndActive()).toBe(true);expect(isDndUpdating()).toBe(false);
  expect(applyDndPreferences({enabled:false},getDndGeneration())).toBe(true);expect(isDndActive()).toBe(false);
 });
});
