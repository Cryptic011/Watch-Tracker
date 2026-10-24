import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readAppSource} from './app-source.mjs';
const html=readAppSource(),suite=fs.readFileSync(new URL('./app-behavior.test.mjs',import.meta.url),'utf8');
const helper=suite.slice(suite.indexOf('function extractFunction'),suite.indexOf('test("Current'));
const {extractFunction}=new Function('html','assert','vm',helper+'\nreturn {extractFunction};')(html,assert,vm);
export function duplicateRuntime(extra={}){
 const context=vm.createContext({console,nowISO:()=>new Date().toISOString(),uuid:()=>crypto.randomUUID(),...extra});
 const names=['toMillis','normalizeTitle','mediaIdentityKind','identityReleaseYear','itemsAreDuplicate','findTrackedDuplicate','mergeEpisodeCountMaps','mergeEpisodeHistories','duplicateRecordQuality','mergeDuplicateItems','deduplicateLibrary','isEpisodeTrackable','positiveEpisodeMap','normalizeReleasedEpisodeMap','releasedEpisodeMap','normalizeWatchedEpisodeMap','legacyWatchedEpisodeMap','watchedEpisodeMap','highestWatchedEpisode','fullyWatchedSeasonCount','knownSeasonTotal','migratePlannedStatuses','watchedSortTime','upcomingSortInfo'];
 vm.runInContext(names.map(name=>extractFunction(html,name)).join('\n'),context);return context;
}
