import { readAppSource } from "./app-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

process.env.TZ = "Europe/London";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readAppSource();

test("PWA and iOS home screen use the supplied Watch Logger icon", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const appIcon = fs.readFileSync(path.join(root, "assets/img/app-icon.png"));
  const touchIcon = fs.readFileSync(path.join(root, "assets/img/apple-touch-icon.png"));
  assert.match(html, /apple-touch-icon[^>]+apple-touch-icon\.png\?v=1/);
  assert.match(html, /rel="icon"[^>]+app-icon\.png\?v=3/);
  assert.equal(new URL(manifest.icons[0].src,"https://example.test/Watched-Tracker/manifest.webmanifest").pathname,"/Watched-Tracker/assets/img/app-icon.png");
  assert.equal(new URL(manifest.start_url,"https://example.test/manifest.webmanifest").pathname,"/");
  assert.equal(manifest.icons[0].purpose, "any");
  assert.deepEqual([appIcon.readUInt32BE(16), appIcon.readUInt32BE(20)], [512, 512]);
  assert.deepEqual([touchIcon.readUInt32BE(16), touchIcon.readUInt32BE(20)], [180, 180]);
});

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Expected ${name} in index.html`);
  const signatureEnd = /\)\s*\{/.exec(source.slice(start));
  assert.ok(signatureEnd, `Expected a body for ${name}`);
  const bodyStart = start + signatureEnd.index + signatureEnd[0].lastIndexOf("{");
  let depth = 0;
  let state = "code";
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") { if (char === "\n") state = "code"; continue; }
    if (state === "block") { if (char === "*" && next === "/") { state = "code"; index++; } continue; }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") { index++; continue; }
      if ((state === "single" && char === "'") || (state === "double" && char === '"') || (state === "template" && char === "`")) state = "code";
      continue;
    }
    if (char === "/" && next === "/") { state = "line"; index++; continue; }
    if (char === "/" && next === "*") { state = "block"; index++; continue; }
    if (char === "'") { state = "single"; continue; }
    if (char === '"') { state = "double"; continue; }
    if (char === "`") { state = "template"; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(source.slice(start-6,start)==="async "?start-6:start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadFunctions(names, setup = "") {
  const context = vm.createContext({ console });
  const declarations = names.map(name => extractFunction(html, name)).join("\n");
  vm.runInContext(`${setup}\n${declarations}\nthis.api={${names.join(",")}};`, context);
  return context.api;
}

test("Current ordering is chronological and keeps TBA below genuinely current titles", () => {
  const api = loadFunctions([
    "toMillis", "addedSortTime", "releaseSortInfo", "compareReleaseRecency",
    "isEpisodeTrackable", "positiveEpisodeMap", "releasedEpisodeCounts",
    "currentSortInfo", "upcomingSortInfo", "compareCurrentOrder",
  ], "const titleCollator=new Intl.Collator('en-GB',{sensitivity:'base',numeric:true});");
  const now = new Date("2026-08-31T16:50:00Z").getTime();
  const rows = [
    { title: "House of the Dragon", type: "Series", nextSeasonNum: 4, nextSeasonDate: "" },
    { title: "Chicago Fire", type: "Series", nextSeasonNum: 15, nextSeasonDate: "2026-10-08T02:00" },
    { title: "CIA", type: "Series", nextSeasonNum: 2, nextSeasonDate: "2026-10-06T02:00" },
    { title: "Unknown", type: "Series", nextEpisodeNum: 6, nextEpisodeDate: "2026-09-06T13:00" },
    { title: "Reacher", type: "Series", nextEpisodeNum: 6, nextEpisodeDate: "2026-09-02T13:00" },
  ];
  rows.sort((a, b) => api.compareCurrentOrder(a, b, now));
  assert.deepEqual(rows.map(row => row.title), ["Reacher", "Unknown", "CIA", "Chicago Fire", "House of the Dragon"]);

  const current = { title: "Aired yesterday", type: "Series", airedEpisodeCounts: { 1: 4 }, latestEpisodeDate: "2026-08-30T20:00:00+01:00" };
  const tba = { title: "Renewed", type: "Series", nextSeasonNum: 2, nextSeasonDate: "" };
  assert.ok(api.compareCurrentOrder(current, tba, now) < 0);

  const yesterday = { title: "Yesterday", type: "Series", latestEpisodeDate: "2026-08-30T20:00:00+01:00" };
  const today = { title: "Today", type: "Series", latestEpisodeDate: "2026-08-31T15:00:00+01:00" };
  const older = { title: "Older", type: "Series", latestEpisodeDate: "2026-07-10T20:00:00+01:00" };
  const upcoming = { title: "Upcoming", type: "Series", nextEpisodeDate: "2026-09-01T20:00:00+01:00" };
  const timeline = [tba, upcoming, yesterday, older, today].sort((a,b) => api.compareCurrentOrder(a,b,now));
  assert.deepEqual(timeline.map(item => item.title), ["Today", "Yesterday", "Upcoming", "Older", "Renewed"]);
});

test("Current airing shows use next release, independent of status and watched date", () => {
  const api=loadFunctions(["isEpisodeTrackable","currentSortInfo","compareCurrentOrder"], "const titleCollator=new Intl.Collator('en-GB');");
  const now=new Date("2026-09-05T17:22:00+01:00").getTime();
  const reacher={title:"Reacher",type:"Series",latestEpisodeDate:"2026-09-02T13:00",nextEpisodeDate:"2026-09-09T13:00",nextEpisodeNum:7,date:"2026-09-04"};
  const lioness={title:"Lioness",type:"Series",latestEpisodeDate:"2026-08-30T13:00",nextEpisodeDate:"2026-09-06T13:00",nextEpisodeNum:6,date:"2026-08-30"};
  const premiere={title:"Premiere",type:"Series",nextSeasonDate:"2026-09-26T02:00"};
  for(const status of ["Planned","Watching","Watched"]){
    const rows=[{...reacher,status},{...lioness,status},premiere].sort((a,b)=>api.compareCurrentOrder(a,b,now));
    assert.deepEqual(rows.map(row=>row.title),["Lioness","Reacher","Premiere"]);
  }
  assert.equal(api.currentSortInfo({...lioness,nextEpisodeDate:"2026-09-04T13:00"},now).kind,"aired");
});

test("Upcoming TV releases remain visible for 24 hours after their release time", () => {
  const api = loadFunctions(["upcomingSortInfo", "dateOnlyInput"]);
  const dateOnlyItem = { type: "Series", nextSeasonNum: 3, nextSeasonDate: api.dateOnlyInput("2026-09-02") };
  const evening = new Date("2026-09-02T20:00:00+01:00").getTime();
  const nextDay = new Date("2026-09-03T00:01:00+01:00").getTime();
  const nextDayAfter24Hours = new Date("2026-09-03T12:01:00+01:00").getTime();
  assert.equal(dateOnlyItem.nextSeasonDate, "2026-09-02T12:00");
  assert.equal(api.upcomingSortInfo(dateOnlyItem, evening).rank, 2);
  assert.equal(api.upcomingSortInfo(dateOnlyItem, evening).dateOnly, true);
  assert.equal(api.upcomingSortInfo(dateOnlyItem, nextDay).rank, 2);
  assert.equal(api.upcomingSortInfo(dateOnlyItem, nextDayAfter24Hours).rank, 0);

  const timedItem = { type: "Series", nextSeasonNum: 3, nextSeasonDate: "2026-09-02T20:00:00+01:00" };
  const before24Hours = new Date("2026-09-03T19:59:00+01:00").getTime();
  const after24Hours = new Date("2026-09-03T20:01:00+01:00").getTime();
  assert.equal(api.upcomingSortInfo(timedItem, before24Hours).rank, 2);
  assert.equal(api.upcomingSortInfo(timedItem, after24Hours).rank, 0);

  const airedEpisodeStillRetained = {
    type: "Series",
    nextEpisodeNum: 8,
    nextEpisodeDate: "2026-09-10T20:00:00+01:00",
    scheduledEpisodeReleases: [
      { season: 3, number: 7, raw: "2026-09-09T20:00:00+01:00" },
    ],
  };
  const oneMinuteBeforeRetentionEnds = new Date("2026-09-10T19:59:00+01:00").getTime();
  const oneMinuteAfterRetentionEnds = new Date("2026-09-10T20:01:00+01:00").getTime();
  assert.equal(api.upcomingSortInfo(airedEpisodeStillRetained, oneMinuteBeforeRetentionEnds).rank, 2);
  assert.equal(api.upcomingSortInfo(airedEpisodeStillRetained, oneMinuteBeforeRetentionEnds).number, 7);
  assert.equal(api.upcomingSortInfo(airedEpisodeStillRetained, oneMinuteAfterRetentionEnds).rank, 2);
  assert.equal(api.upcomingSortInfo(airedEpisodeStillRetained, oneMinuteAfterRetentionEnds).number, 8);

  const timeline = loadFunctions(["currentSortInfo", "isEpisodeTrackable"]);
  const currentApi = timeline.currentSortInfo;
  const currentAtAir = currentApi({
    type: "Series",
    nextEpisodeNum: 8,
    nextEpisodeDate: "2026-09-10T21:00:00+01:00",
    scheduledEpisodeReleases: [
      { season: 3, number: 7, raw: "2026-09-10T20:00:00+01:00" },
    ],
  }, new Date("2026-09-10T20:30:00+01:00").getTime());
  assert.equal(currentAtAir.phase, 4);

  assert.equal(timeline.currentSortInfo(dateOnlyItem, evening).phase, 2);
  assert.equal(timeline.currentSortInfo(dateOnlyItem, nextDay).phase, 0);
});

test("Announced episode totals do not become released episodes", () => {
  const api = loadFunctions(["isEpisodeTrackable", "positiveEpisodeMap", "toMillis", "normalizeReleasedEpisodeMap", "releasedEpisodeMap", "releasedEpisodeCounts", "normalizeWatchedEpisodeMap"]);
  const unreleased = { type:"Series", episodeCounts:{1:8}, nextSeasonNum:1, nextSeasonDate:"2099-01-01" };
  assert.equal(Object.keys(api.releasedEpisodeCounts(unreleased)).length, 0);
  const partial = { type:"Series", episodeCounts:{1:8}, airingSeason:1, latestEpisodeNum:3, latestEpisodeDate:"2026-01-01T20:00:00Z" };
  const counts = api.releasedEpisodeCounts(partial);
  assert.equal(counts[1],3);
  assert.equal(JSON.stringify(api.normalizeWatchedEpisodeMap({1:[1,3,4],2:[1]}, counts)), '{"1":[1,3]}');
});

test("Browser scripts parse and notification links stay within the site", () => {
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for(const [,source] of scripts)new vm.Script(source);
  const worker=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  new vm.Script(worker);
  const context=vm.createContext({URL,self:{registration:{scope:"https://example.test/Watched-Tracker/"}}});
  vm.runInContext(extractFunction(worker,"notificationUrlWithinScope"),context);
  assert.equal(context.notificationUrlWithinScope("https://evil.example/"),"https://example.test/Watched-Tracker/");
  assert.equal(context.notificationUrlWithinScope("../other/"),"https://example.test/Watched-Tracker/");
  assert.equal(context.notificationUrlWithinScope("./?item=123"),"https://example.test/Watched-Tracker/?item=123");
});

test("Legacy auto-planning restores the user's status", () => {
  const api = loadFunctions(["toMillis", "isEpisodeTrackable", "positiveEpisodeMap", "releasedEpisodeCounts", "knownSeasonTotal", "upcomingSortInfo", "migratePlannedStatuses"]);
  const [row] = api.migratePlannedStatuses([{
    id: "show-1", title: "Example", type: "Series", status: "Planned",
    statusBeforeUpcoming: "Watching", autoPlanned: true,
    nextSeasonNum: 2, nextSeasonDate: "2099-01-01T12:00",
    totalSeasons: 2, watchedSeasons: 1, curSeason: 1,
  }]).rows;
  assert.equal(row.status, "Watching");
  assert.equal("autoPlanned" in row, false);
  assert.equal("statusBeforeUpcoming" in row, false);
});

test("Local search ranks exact, prefix, and typo matches", () => {
  const api = loadFunctions(["normalizeTitle", "levenshteinNormalized", "mediaSearchInfo", "librarySearchScore"], "const mediaSearchTextCache=new WeakMap();");
  const query = api.normalizeTitle("Reacher");
  const tokens = query.split(" ");
  const exact = api.librarySearchScore({ title: "Reacher", platform: "Prime Video" }, query, tokens);
  const prefix = api.librarySearchScore({ title: "Reacher: Origins", platform: "" }, query, tokens);
  const platform = api.librarySearchScore({ title: "Other", platform: "Reacher" }, query, tokens);
  const typo = api.librarySearchScore({ title: "Reacher", platform: "" }, api.normalizeTitle("Reacer"), ["reacer"]);
  const alias = api.librarySearchScore({ title: "Other", alternateTitles: ["The Reacher"], platform: "" }, query, tokens);
  assert.ok(exact > prefix && prefix > platform && typo > 0 && alias > 0);
});

test("Conflict replay preserves remote work while applying local edits and deletes", () => {
  const { replayLocalChanges } = loadFunctions(["toMillis","canonicalRecordJSON","sameSyncValue","mergeEpisodeSetChanges","mergeEpisodeHistory","mergeRecordChanges","replayLocalChanges"]);
  const base = [{ id: "a", title: "A", updatedAt: "1" }, { id: "b", title: "B", updatedAt: "1" }];
  const local = [{ id: "a", title: "A edited", updatedAt: "2" }, { id: "c", title: "C", updatedAt: "2" }];
  const remote = [{ id: "a", title: "A", updatedAt: "1" }, { id: "b", title: "B remote", updatedAt: "2" }, { id: "d", title: "D", updatedAt: "2" }];
  const result = replayLocalChanges(base, local, remote);
  const byId = new Map(result.map(row => [row.id, row]));
  assert.equal(byId.get("a").title, "A edited");
  assert.equal(byId.has("b"), false);
  assert.equal(byId.get("c").title, "C");
  assert.equal(byId.get("d").title, "D");
});

test("No-op record comparison ignores only updatedAt", () => {
  const api = loadFunctions(["canonicalRecordJSON", "sameRecordWithoutUpdateTime"]);
  const a = { id: "1", title: "Show", nested: { b: 2, a: 1 }, updatedAt: "old" };
  const b = { nested: { a: 1, b: 2 }, title: "Show", id: "1", updatedAt: "new" };
  assert.equal(api.sameRecordWithoutUpdateTime(a, b), true);
  assert.equal(api.sameRecordWithoutUpdateTime(a, { ...b, title: "Changed" }), false);
});

test("Only explicitly released episode numbers are trackable", () => {
  const api=loadFunctions(["isEpisodeTrackable","positiveEpisodeMap","toMillis","normalizeReleasedEpisodeMap","releasedEpisodeMap","releasedEpisodeCounts","normalizeWatchedEpisodeMap","progressWatchedEpisodeMap"]);
  const item={type:"Series",episodeScheduleVerified:true,releasedEpisodes:{1:[1,3]},airedEpisodeCounts:{1:3}};
  assert.deepEqual(JSON.parse(JSON.stringify(api.releasedEpisodeMap(item))),{1:[1,3]});
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeWatchedEpisodeMap({1:[1,2,3]},api.releasedEpisodeMap(item)))),{1:[1,3]});
  assert.deepEqual(JSON.parse(JSON.stringify(api.progressWatchedEpisodeMap(api.releasedEpisodeMap(item),0,1,3))),{1:[1,3]});
});

const episodeToggleFunctions=["isEpisodeTrackable","positiveEpisodeMap","toMillis","normalizeReleasedEpisodeMap","releasedEpisodeMap","releasedEpisodeCounts","normalizeWatchedEpisodeMap","legacyWatchedEpisodeMap","watchedEpisodeMap","highestWatchedEpisode","fullyWatchedSeasonCount","applyEpisodeToggle"];

test("Marking any episode includes earlier released episodes in that season only", () => {
  const api=loadFunctions(episodeToggleFunctions,'function localISODate(){return "2026-10-22";}');
  const released=Array.from({length:20},(_,index)=>index+1);
  for(const type of ["Series","Anime"])for(const season of [1,2,9])for(const episode of [1,3,15,20]){
    const item={type,status:"Planned",episodeScheduleVerified:true,releasedEpisodes:{1:released,2:released,9:released},episodeCounts:{1:20,2:20,9:20},watchedEpisodes:{1:[20],2:[20],9:[20]}};
    const result=api.applyEpisodeToggle(item,season,episode,true,{id:"mark",kind:"mark",season,episode,watchedAt:"2026-10-22T12:00:00Z"});
    for(const number of [1,2,9])assert.deepEqual(JSON.parse(JSON.stringify(result.watchedEpisodes[number])),number===season?[...new Set([...released.filter(value=>value<=episode),20])]:[20]);
    assert.deepEqual(item.watchedEpisodes,{1:[20],2:[20],9:[20]},"original watch map is not mutated");
    assert.equal(result.status,"Watching");
  }
});

test("Episode catch-up skips unreleased numbers and rejects unavailable targets", () => {
  const api=loadFunctions(episodeToggleFunctions,'function localISODate(){return "2026-10-22";}');
  const item={type:"Series",status:"Watching",episodeScheduleVerified:true,releasedEpisodes:{4:[1,3,5,6],5:[1,2]},watchedEpisodes:{5:[2]}};
  const result=api.applyEpisodeToggle(item,4,5,true,{kind:"mark",watchedAt:"2026-10-22T12:00:00Z"});
  assert.deepEqual(JSON.parse(JSON.stringify(result.watchedEpisodes)),{4:[1,3,5],5:[2]});
  assert.equal(result.curSeason,4);assert.equal(result.curEp,5);
  assert.equal(api.applyEpisodeToggle(item,4,7,true,{}),item);
});

test("Unmarking remains individual and Undo can restore a watched episode without filling gaps", () => {
  const api=loadFunctions(episodeToggleFunctions,'function localISODate(){return "2026-10-22";}');
  const item={type:"Series",status:"Watching",episodeScheduleVerified:true,releasedEpisodes:{3:[1,2,3,4],4:[1]},watchedEpisodes:{3:[1,2,3],4:[1]}};
  const unmarked=api.applyEpisodeToggle(item,3,2,false,{kind:"unmark",watchedAt:"2026-10-22T12:00:00Z"});
  assert.deepEqual(JSON.parse(JSON.stringify(unmarked.watchedEpisodes)),{3:[1,3],4:[1]});
  const restored=api.applyEpisodeToggle({...item,watchedEpisodes:{}},3,3,true,{kind:"mark",watchedAt:"2026-10-22T12:00:00Z"},false);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.watchedEpisodes)),{3:[3]});
});

test("Schedule analysis records released episode identities instead of filling gaps", () => {
  const api=loadFunctions(["episodeAirTime","analyzeTVSchedule"]);
  const episodes=[
    {season:1,number:1,airstamp:"2026-09-01T19:00:00Z"},
    {season:1,number:2,airstamp:"2026-09-10T19:00:00Z"},
    {season:1,number:3,airstamp:"2026-09-03T19:00:00Z"},
  ];
  const result=api.analyzeTVSchedule([],episodes,{},new Date("2026-09-06T12:00:00Z").getTime());
  assert.deepEqual(JSON.parse(JSON.stringify(result.releasedEpisodes)),{1:[1,3]});
  assert.equal(result.nextEpisode.number,2);
});

test("Episode artwork uses each episode image and excludes the series poster",()=>{
  const api=loadFunctions(["officialEpisodeImageMap"]);
  const poster="https://static.tvmaze.com/uploads/images/original_untouched/1/poster.jpg";
  const still="https://static.tvmaze.com/uploads/images/original_untouched/1/episode.jpg";
  const medium="https://static.tvmaze.com/uploads/images/medium_landscape/1/episode-2.jpg";
  const images=api.officialEpisodeImageMap([
    {season:1,number:1,image:{original:still}},
    {season:1,number:2,image:{medium}},
    {season:1,number:3,image:null},
    {season:1,number:4,image:{original:poster}},
    {season:1,number:6,image:{medium:"https://static.tvmaze.com/uploads/images/medium_landscape/1/poster.jpg"}},
    {season:0,number:1,image:{original:still}},
    {season:1,number:5,image:{original:"https://example.com/unverified.jpg"}}
  ],{original:poster});
  assert.deepEqual(JSON.parse(JSON.stringify(images)),{1:{1:still,2:medium}});
});

test("Episode artwork lookup rejects mismatched IDs and ambiguous titles",async()=>{
  const api=loadFunctions(["officialEpisodeImageMap","officialSeasonImageMap","fetchOfficialTrackerArtwork"],`
    const trackerArtworkCache=new Map();
    function cachedMetadataRequest(cache,key,task){return task();}
    function normalizeTitle(value){return String(value||"").toLowerCase();}
    async function fetchJSONWithTimeout(url){
      if(url.includes("/search/shows?"))return [{show:{id:12,name:"Twin"}},{show:{id:13,name:"Twin"}}];
      if(url.endsWith("/episodes"))throw new Error("A mismatched show must not load episodes");
      return {id:12,name:"Twin",externals:{imdb:"tt1111111"}};
    }
  `);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.fetchOfficialTrackerArtwork({title:"Twin",tvmazeShowId:"12",imdbId:"tt2222222"}))),{});
  assert.deepEqual(JSON.parse(JSON.stringify(await api.fetchOfficialTrackerArtwork({title:"Twin"}))),{});
});

test("Season artwork comes only from the matching season record",()=>{
  const api=loadFunctions(["officialSeasonImageMap"]);
  const images=api.officialSeasonImageMap([
    {number:1,image:{original:"https://static.tvmaze.com/season-one.jpg"}},
    {number:2,image:null},
    {number:3,image:{medium:"https://static.tvmaze.com/season-three.jpg"}},
    {number:0,image:{original:"https://static.tvmaze.com/specials.jpg"}},
    {number:4,image:{original:"https://example.com/unverified.jpg"}}
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(images)),{1:"https://static.tvmaze.com/season-one.jpg",3:"https://static.tvmaze.com/season-three.jpg"});
});

test("Season artwork remains available when the episode endpoint fails",async()=>{
  const api=loadFunctions(["officialEpisodeImageMap","officialSeasonImageMap","fetchOfficialTrackerArtwork"],`
    const trackerArtworkCache=new Map();
    function cachedMetadataRequest(cache,key,task){return task();}
    async function fetchJSONWithTimeout(url){
      if(url.endsWith("/episodes"))throw new Error("Episode endpoint unavailable");
      if(url.endsWith("/seasons"))return [{number:1,image:{original:"https://static.tvmaze.com/season-one.jpg"}}];
      return {id:12,externals:{imdb:"tt1111111"}};
    }
  `);
  const artwork=await api.fetchOfficialTrackerArtwork({title:"Twin",tvmazeShowId:"12",imdbId:"tt1111111"});
  assert.deepEqual(JSON.parse(JSON.stringify(artwork.seasonImages)),{1:"https://static.tvmaze.com/season-one.jpg"});
  assert.equal(artwork.details.source,"TVMaze");
});

test("TVMaze release timestamps are stored in UTC", () => {
  const api=loadFunctions(["episodeReleaseTimestamp"]);
  assert.equal(api.episodeReleaseTimestamp({airstamp:"2026-09-06T20:00:00+01:00"}),"2026-09-06T19:00:00.000Z");
  assert.equal(api.episodeReleaseTimestamp({airdate:"2026-09-06"}),"2026-09-06");
});

test("Reminder backend refreshes schedules before scanning and uses revision checks", () => {
  const source=fs.readFileSync(path.join(root,"supabase/functions/watchlog-reminders/index.ts"),"utf8");
  assert.match(source,/refreshServerEpisodeSchedules\(libraryRows \|\| \[\], Date\.now\(\)\)/);
  assert.match(source,/p_revision:revision/);
  assert.match(source,/nextEpisodeDate: episodeUtcValue\(next\)/);
  assert.match(source,/releasedEpisodes,/);
});

test("Reminder migrations provision the service-role push schema", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260917030532_create_push_backend.sql"), "utf8");
  for (const table of ["watchlog_push_config", "watchlog_push_subscriptions", "watchlog_push_deliveries", "watchlog_push_tests"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(migration, /unique \(subscription_id, event_key\)/);
  assert.match(migration, /insert into public\.watchlog_push_config/);
});

test("Production surface contains no executable third-party catalogue scripts", () => {
  assert.doesNotMatch(html, /document\.createElement\(["']script["']\)/);
  const policy=html.match(/Content-Security-Policy" content="([^"]+)/)[1];
  assert.doesNotMatch(policy, /sg\.media-imdb\.com/);
  assert.doesNotMatch(policy.match(/script-src[^;]*/)[0], /https:/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /pinApi\("catalog_search"/);
});

test("HTML ids are unique and Pages uploads only runtime files", () => {
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /uses: actions\/checkout@v6/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|configure-pages|upload-pages-artifact|deploy-pages)@v[1-4](?:\b|\.)/);
  assert.match(workflow, /uses: actions\/configure-pages@v6/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /uses: actions\/deploy-pages@v5/);
  assert.match(workflow, /path: _site/);
  assert.match(workflow, /cp index\.html build-info\.js library-gallery\.js library-gallery\.css manifest\.webmanifest sw\.js asset-manifest\.json _site\//);
});

test("Backend requires revisions and provides an owned catalogue gateway", () => {
  const source = fs.readFileSync(path.join(root, "supabase/functions/watchlog-pin/index.ts"), "utf8");
  assert.match(source, /action === "catalog_search"/);
  assert.match(source, /code:\s*"revision_conflict"/);
  assert.match(source, /p_revision:body\.expectedRevision/);
  assert.match(source, /watchlog_record_pin_failure/);
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260904000200_harden_watchlog_sync.sql"), "utf8");
  assert.match(migration, /add column if not exists revision bigint/);
  assert.match(migration, /create or replace function public\.watchlog_record_pin_failure/);
});


test("Reminder reconciliation migration matches the production migration history", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.ok(migrations.includes("20260920012827_reconcile_reminder_backend_schema.sql"));
  assert.ok(!migrations.includes("20260920004500_reconcile_reminder_backend.sql"));
});

test("App update checks are event-driven and preserve active edits", () => {
  const source = fs.readFileSync(path.join(root, "assets/js/app-core.js"), "utf8");
  assert.doesNotMatch(source, /APP_UPDATE_CHECK_MS|setInterval\([^\n]*checkForAppUpdate/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /appHasUnsavedWork\(\)/);
  assert.match(source, /pendingAppUpdate=true/);
  assert.match(source, /saveBeforeAppRefresh\(\)/);
});

test("Reminders belong to Release Reminders and open in a dialog", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const core = fs.readFileSync(path.join(root, "assets/js/app-core.js"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "assets/js/dashboard.js"), "utf8");
  assert.match(index, /id="private-reminder-history"[^>]*>[\s\S]*<h3>Reminders<\/h3>[\s\S]*id="refresh-reminder-history"[^>]*>View reminders<\/button>/);
  assert.match(index, /<h2>Reminders<\/h2>/);
  assert.match(index, /id="reminder-history-dialog"/);
  assert.match(dashboard, /reminder-history-dialog[\s\S]*showModal\(\)/);
  assert.match(core, /document\.querySelector\('#settings-view \[data-settings-panel="reminders"\]'\)\?\.appendChild\(reminderActivitySection\)/);
  assert.doesNotMatch(core, /settingsView\.appendChild\(reminderActivitySection\)/);
});


test("Matching TVMaze identities suppress duplicate series even when legacy IMDb IDs differ", () => {
  const api=loadFunctions(["normalizeTitle","mediaIdentityKind","identityReleaseYear","itemsAreDuplicate","findTrackedDuplicate"]);
  const old={id:"ncis-1",type:"Series",title:"NCIS: New York",tvmazeShowId:"99001",imdbId:"tt1111111",releaseYear:"2026"};
  const duplicate={id:"ncis-2",type:"Series",title:"NCIS: New York",tvmazeShowId:"99001",imdbId:"tt2222222",releaseYear:"2026"};
  const separate={...duplicate,tvmazeShowId:"99002"};
  assert.equal(api.itemsAreDuplicate(old,duplicate),true);
  assert.equal(api.findTrackedDuplicate(duplicate,[old])?.id,"ncis-1");
  assert.equal(api.itemsAreDuplicate(old,separate),false);
});

test("Recently refreshed historical shows with empty episode lists are retried", () => {
  const api=loadFunctions(["isEpisodeTrackable","positiveEpisodeMap","normalizeReleasedEpisodeMap","toMillis","seriesMetadataRefreshCandidate"],`
    const metadataRefreshAttemptAt=new Map();
    const SERIES_REFRESH_RETRY_MS=30000;
    const SERIES_METADATA_STALE_MS=86400000;
  `);
  const now=new Date("2026-10-24T12:00:00Z").getTime();
  const ncis={id:"ncis",type:"Series",title:"NCIS",tvmazeShowId:"60",releaseYear:"2003",
    totalSeasons:23,seriesReleaseDate:"2003-09-23",latestEpisodeDate:"2026-10-21",
    episodeScheduleVerified:true,releasedEpisodes:{},metadataUpdatedAt:"2026-10-24T11:59:00Z"};
  assert.ok(api.seriesMetadataRefreshCandidate(ncis,now),"empty historical schedules need repair");
  assert.equal(api.seriesMetadataRefreshCandidate({...ncis,releasedEpisodes:{1:[1]}},now),null);
});

test("Unverified empty episode responses never delete existing watched history", () => {
  const api=loadFunctions(["isEpisodeTrackable","positiveEpisodeMap","normalizeReleasedEpisodeMap","toMillis","releasedEpisodeMap","sanitizeUnreleasedEpisodeProgress"]);
  const item={type:"Series",title:"NCIS",episodeScheduleVerified:true,releasedEpisodes:{},
    airedEpisodeCounts:{1:20},curSeason:1,curEp:3,watchedEpisodes:{1:[1,2,3]},
    episodeHistory:[{season:1,episode:3,kind:"mark"}]};
  assert.equal(api.sanitizeUnreleasedEpisodeProgress(item),item);
});

test("Verified TVMaze episode recovery uses documented embedded fallback", () => {
  const catalogue=fs.readFileSync(path.join(root,"assets/js/catalogue.js"),"utf8");
  assert.match(catalogue,/\?embed=episodes/);
  assert.match(catalogue,/Array\.isArray\(embedded\?\._embedded\?\.episodes\)/);
  assert.match(catalogue,/const episodeAvailable=episodes\.length>0/);
  const gallery=fs.readFileSync(path.join(root,"library-gallery.js"),"utf8");
  assert.match(gallery,/data-gallery-retry-episodes/);
  assert.match(gallery,/api\.refreshEpisodes\?\.\(item/);
});

test("IMDb cross-check never attaches a near-match ID to a different selected programme",async()=>{
  const api=loadFunctions(["normalizeTitle","imdbSeriesCrossCheck"],`
    async function searchIMDbOne(){return [{title:"A Different Show",format:"Series",imdbId:"tt9999999",year:"2026"}];}
    function bestIMDbSeriesMatch(rows){return rows[0];}
  `);
  const result=await api.imdbSeriesCrossCheck("Selected Show",{year:"2026"});
  assert.equal(result.confirmed,null);
  assert.equal(result.imdbId,"");
  assert.equal(result.match,null);
});

test("TVMaze identity verification rejects nonmatching series even if the franchise is related",()=>{
  const api=loadFunctions(["normalizeTitle","tvMazeShowMatchesSelection"]);
  const show={name:"NCIS: Other City",premiered:"2026-10-01",externals:{imdb:"tt1234567"}};
  assert.equal(api.tvMazeShowMatchesSelection(show,"NCIS",{year:"2026"}),false);
  assert.equal(api.tvMazeShowMatchesSelection(show,"NCIS: Other City",{year:"2025"}),false);
  assert.equal(api.tvMazeShowMatchesSelection(show,"NCIS: Other City",{year:"2026"}),true);
});

test("Duplicate cleanup merges released episodes and watched progress without dropping history",()=>{
  const api=loadFunctions([
    "normalizeTitle","mediaIdentityKind","identityReleaseYear","itemsAreDuplicate","positiveEpisodeMap",
    "normalizeReleasedEpisodeMap","mergeEpisodeCountMaps","mergeEpisodeHistories","duplicateRecordQuality",
    "mergeDuplicateItems","deduplicateLibrary"
  ],`
    function toMillis(value){return Date.parse(value||"")||0;}
    function nowISO(){return "2026-10-24T12:00:00Z";}
    function uuid(){return "generated-id";}
    function watchedSortTime(item){return toMillis(item.date);}
    function upcomingSortInfo(){return {rank:0,time:Infinity};}
    function watchedEpisodeMap(item){return item.watchedEpisodes||{};}
    function normalizeWatchedEpisodeMap(map,releases){
      const output={};
      for(const [season,episodes] of Object.entries(map||{})){
        const available=new Set(Array.isArray(releases?.[season])?releases[season]:Array.from({length:Number(releases?.[season]||0)},(_,i)=>i+1));
        const filtered=episodes.filter(episode=>available.has(episode));
        if(filtered.length)output[season]=filtered;
      }
      return output;
    }
    function highestWatchedEpisode(map){
      const pairs=Object.entries(map||{}).flatMap(([season,episodes])=>episodes.map(episode=>({season:Number(season),episode})));
      return pairs.sort((a,b)=>b.season-a.season||b.episode-a.episode)[0]||null;
    }
    function fullyWatchedSeasonCount(){return 0;}
    function migratePlannedStatuses(rows){return {rows};}
  `);
  const a={id:"series-a",title:"Test Series",type:"Series",status:"Watching",
    tvmazeShowId:"600",imdbId:"tt1000000",episodeScheduleVerified:true,
    releasedEpisodes:{1:[1,2,3]},watchedEpisodes:{1:[1,2]},
    episodeHistory:[{id:"event-a",kind:"mark",season:1,episode:2,watchedAt:"2026-10-21T12:00:00Z"}],
    updatedAt:"2026-10-22T12:00:00Z"};
  const b={id:"series-b",title:"Test Series",type:"Series",status:"Watching",
    tvmazeShowId:"600",imdbId:"tt2000000",episodeScheduleVerified:true,
    releasedEpisodes:{},watchedEpisodes:{1:[3]},
    episodeHistory:[{id:"event-b",kind:"mark",season:1,episode:3,watchedAt:"2026-10-23T12:00:00Z"}],
    updatedAt:"2026-10-23T12:00:00Z"};
  const output=api.deduplicateLibrary([a,b]);
  assert.equal(output.items.length,1);
  assert.equal(output.removedCount,1);
  const item=output.items[0];
  assert.deepEqual(JSON.parse(JSON.stringify(item.releasedEpisodes)),{1:[1,2,3]});
  assert.deepEqual(JSON.parse(JSON.stringify(item.watchedEpisodes)),{1:[1,2,3]});
  assert.equal(item.episodeHistory.length,2);
  assert.deepEqual(a.watchedEpisodes,{1:[1,2]});
});
