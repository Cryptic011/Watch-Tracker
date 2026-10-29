import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderPlan} from '../native/reminder-plan.mjs';

const now=Date.parse('2026-10-26T12:00:00Z');
const series={id:'one',title:'A show',type:'Series',status:'Watching',releaseSchedule:{},curSeason:1,scheduledEpisodeReleases:[{season:1,number:2,raw:'2026-10-28T12:00:00Z'}]};
test('iPhone reminders schedule day, six-hour and release alerts for confirmed episodes',()=>{
  const plan=reminderPlan([series],'account',{now});
  assert.equal(plan.length,3);assert.equal(plan[0].at,Date.parse('2026-10-27T12:00:00Z'));
  assert.match(plan[0].body,/S1 E2 out in 1 day/);assert.match(plan[2].body,/out now/);
  assert.ok(plan.every(row=>row.accountId==='account'&&row.itemId==='one'));
});
test('uncertain dates, unknown offsets and unconfirmed streaming do not produce notifications',()=>{
  for(const raw of ['2026-10-28','2026-10-28T12:00:00','bad-date'])assert.deepEqual(reminderPlan([{...series,scheduledEpisodeReleases:[{season:1,number:2,raw}]}],'account',{now}),[]);
  assert.deepEqual(reminderPlan([series],'account',{now,resolveEvent:(_item,event)=>({...event,streamingUnconfirmed:true})}),[]);
  assert.deepEqual(reminderPlan([{...series,releaseSchedule:null}],'account',{now}),[]);
});
test('explicit opt-out and past releases cancel alerts; archiving keeps reminder preferences',()=>{
  assert.deepEqual(reminderPlan([{...series,hideFromWeeklyReleases:true}],'account',{now}),[]);
  assert.equal(reminderPlan([{...series,archived:true}],'account',{now}).length,3);
  assert.deepEqual(reminderPlan([series],'account',{now:Date.parse('2026-10-29T12:00:00Z')}),[]);
});
test('scheduled releases win over stale next pointers, and repeated source episodes are deduplicated',()=>{
  const item={...series,nextEpisodeNum:2,nextEpisodeDate:'2026-10-29T12:00:00Z',recurringWeeklySchedule:{episodes:series.scheduledEpisodeReleases}};
  const plan=reminderPlan([item,item],'account',{now});assert.equal(plan.length,3);assert.equal(plan[2].at,Date.parse('2026-10-28T12:00:00Z'));
});
test('iPhone keeps the earliest 60 future notifications and leaves room for a test notification',()=>{
  const items=Array.from({length:50},(_,n)=>({...series,id:String(n),scheduledEpisodeReleases:[{season:1,number:n+1,raw:new Date(now+(n+2)*86400000).toISOString()}]}));
  const plan=reminderPlan(items,'account',{now});assert.equal(plan.length,60);
  assert.equal(new Set(plan.map(row=>row.id)).size,60);assert.ok(plan.every((row,i)=>i===0||row.at>=plan[i-1].at));
});
test('film alerts follow Planned/Saved status and all plans retain account identity',()=>{
  const film={id:'film',title:'A film',type:'Film',filmReleaseDate:'2026-10-28T12:00:00Z',releaseSchedule:{},status:'Planned'};
  assert.equal(reminderPlan([film],'A',{now}).length,3);
  assert.deepEqual(reminderPlan([{...film,status:'Watched'}],'A',{now}),[]);
  assert.ok(reminderPlan([film],'B',{now}).every(row=>row.accountId==='B'));
});
