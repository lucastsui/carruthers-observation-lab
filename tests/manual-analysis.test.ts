import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoAnalysis } from '../lib/auto-analysis.ts';
import { DEFAULT_ROI } from '../lib/research.ts';

void test('public analysis waits for explicit submit and cancels on changed selection', async () => {
  const calls: string[]=[];
  const states: string[]=[];
  const a=new AutoAnalysis({manual:true,pollMs:1,transport:async <T>(path:string) => {calls.push(path);return {id:'j',status:path==='cancel'?'cancelled':'running',completed:0,total:1} as T;},onState:s=>states.push(s.phase),onResult:()=>{}});
  const selection={frame_ids:['one'],roi:DEFAULT_ROI,exclude_interpolated:true};
  a.setSelection(selection);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(calls.length,0);
  assert.equal(states.at(-1),'idle');
  a.retry();
  await new Promise(r=>setTimeout(r,10));
  assert.equal(calls[0],'jobs');
  a.setSelection({...selection,frame_ids:['two']});
  await new Promise(r=>setTimeout(r,20));
  assert.ok(calls.includes('cancel'));
  assert.equal(calls.filter(p=>p==='jobs').length,1);
  a.dispose();
});
