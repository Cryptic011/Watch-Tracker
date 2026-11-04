import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/sync.js',import.meta.url),'utf8');
const segment=source.slice(source.indexOf('  function sameSyncValue('),source.indexOf('  function replayLocalChanges('));
test('Independent collection additions on two devices both survive reconciliation',()=>{
 const context=vm.createContext({canonicalRecordJSON:value=>JSON.stringify(value),toMillis:value=>Date.parse(value)||0});
 vm.runInContext(segment,context);
 const base={id:'show',lists:['Original']},local={...base,lists:['Original','Device A']},remote={...base,lists:['Original','Device B']};
 const result=context.mergeRecordChanges(base,local,remote);
 assert.deepEqual([...result.lists].sort(),['Device A','Device B','Original']);
});
