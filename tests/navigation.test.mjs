import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/navigation.js',import.meta.url),'utf8');
function router(){const c=vm.createContext({window:{},URLSearchParams});vm.runInContext(source,c);return c;}
test('App URLs round-trip titles, collections, Library filters and sort order',()=>{
 const c=router(),page={tab:'library',category:'Series',scope:'list:My shows & films',query:'NCIS',filter:'Watching',sort:'title'};
 const hash=c.appPageHash(page),parsed=c.parseAppHash(hash);
 for(const [key,value] of Object.entries(page))assert.equal(parsed[key],value);
 const title=c.parseAppHash(c.appPageHash({...page,title:'a/b c'}));assert.equal(title.title,'a/b c');
});
test('Search and Settings have their own restorable URLs',()=>{
 const c=router();
 assert.equal(c.appPageHash({tab:'settings',settings:'account'}),'#/settings/account');
 const parsed=c.parseAppHash(c.appPageHash({tab:'search',searchText:'The Batman',searchFormat:'Film'}));
 assert.equal(parsed.tab,'search');assert.equal(parsed.searchText,'The Batman');assert.equal(parsed.searchFormat,'Film');
 assert.equal(c.parseAppHash('#/settings/unknown').settings,'');assert.equal(c.parseAppHash('#/title/%E0%A4').title,'');
});
