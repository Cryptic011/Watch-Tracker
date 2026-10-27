import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const core=fs.readFileSync(new URL('../assets/js/app-core.js',import.meta.url),'utf8');
const catalogue=fs.readFileSync(new URL('../assets/js/catalogue.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../supabase/functions/watchlog-reminders/index.ts',import.meta.url),'utf8');

test('Summer dates, clock labels and editor round trips stay GMT on devices in other zones',()=>{
 const previous=process.env.TZ;
 try{
  for(const zone of ['Europe/London','America/Los_Angeles','Asia/Tokyo']){
   process.env.TZ=zone;
   const c=vm.createContext({Date,Intl,navigator:{language:'en-GB'},document:{documentElement:{}}});
   vm.runInContext(core.slice(core.indexOf('  const DEVICE_TIME_ZONE='),core.indexOf('  function localDatePattern(')),c);
   vm.runInContext(catalogue.slice(0,catalogue.indexOf('  function dateOnlyInput(')),c);
   assert.equal(c.formatLocalDateTime('2026-06-01T08:00:00Z'),'01/06/2026, 08:00',zone);
   assert.equal(c.formatLocalDateTime('2026-06-01T08:00'),'01/06/2026, 08:00',zone);
   assert.equal(c.formatLocalDate('2026-06-01T23:30:00Z'),'01/06/2026',zone);
   assert.equal(c.localISODate(new Date('2026-06-01T23:30:00Z')),'2026-06-01',zone);
   assert.equal(c.toLocalInput('2026-06-01T08:00:00Z'),'2026-06-01T08:00',zone);
   assert.equal(c.storedDateFromInput('2026-06-01T08:00'),'2026-06-01T08:00:00.000Z',zone);
   assert.equal(c.dateFromLocalValue('2026-06-01').toISOString(),'2026-06-01T12:00:00.000Z',zone);
  }
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('Reminder clocks ignore old device-zone preferences for time entries without offsets',()=>{
 const c=vm.createContext({Date,Intl});
 const from=worker.indexOf('function zonedLocalToUtc('),to=worker.indexOf('function episodeUtcValue(');
 vm.runInContext(stripTypeScriptTypes(worker.slice(from,to)),c);
 for(const zone of ['Europe/London','America/Los_Angeles','Asia/Tokyo']){
  assert.equal(c.scheduledEventTime('2026-06-01T08:00',zone),Date.parse('2026-06-01T08:00:00Z'));
  assert.equal(c.scheduledEventTime('2026-06-01',zone),Date.parse('2026-06-01T12:00:00Z'));
 }
});

test('Settings has no region selector and old saved preferences do not change GMT or UK listings',()=>{
 const source=fs.readFileSync(new URL('../assets/js/region-settings.js',import.meta.url),'utf8');
 const c=vm.createContext({localStorage:{getItem(){throw Error('Old device preferences must not be used');}}});
 vm.runInContext(source.slice(0,source.indexOf('let regionalRefreshAt=')),c);
 assert.equal(c.releaseViewingCountry(),'GB');
 assert.equal(c.reminderViewingLocale(),'en-GB');
 assert.doesNotMatch(source,/release-viewing-region|watchlog_release_country|createElement|Intl\.DisplayNames/);
});
