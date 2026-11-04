import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../supabase/functions/watchlog-pin/title-details.mjs',import.meta.url),'utf8');
const slice=source.slice(source.indexOf('function isReleaseSpecificText'),source.indexOf('function aboutPageDescription'));
const context=vm.createContext({text:value=>String(value||'').trim()});vm.runInContext(slice,context);
test('NBC premiere promotions cannot become the Chicago Fire show synopsis',()=>{
 assert.equal(context.isWholeTitleSynopsis('Chicago Fire – Premieres Wednesday, October 1 at 9/8c. Taylor Kinney stars in the high-octane drama about Chicago firefighters.'),false);
 assert.equal(context.isWholeTitleSynopsis('The firefighters, rescue squad and paramedics of Chicago Firehouse 51 risk their lives to protect the people of their city.'),true);
});
