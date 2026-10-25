import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Account & Sync belongs to Settings, never the Library view',()=>{
 const html=read('index.html').replaceAll('&amp;','&');
 const library=html.slice(html.indexOf('<div id="library-view"'),html.indexOf('<div id="settings-view"'));
 const settings=html.slice(html.indexOf('<div id="settings-view"'),html.indexOf('<section id="discovery-view"'));
 assert.doesNotMatch(library,/Account & Sync|id="profile-card"|id="sync-now"|id="logout-btn"/);
 assert.match(settings,/Account & Sync/);assert.match(settings,/id="sync-now"/);assert.match(settings,/id="logout-btn"/);
});

test('Settings is consolidated into General, Release Reminders, and Account & Sync sections',()=>{
 const html=read('index.html').replaceAll('&amp;','&'),core=read('assets/js/app-core.js');
 const settings=html.slice(html.indexOf('<div id="settings-view"'),html.indexOf('<section id="discovery-view"'));
 const positions=['General','Release Reminders','Account & Sync'].map(label=>settings.indexOf(label));
 assert.ok(positions.every(p=>p>=0),'all static settings sections exist');
 assert.deepEqual([...positions].sort((a,b)=>a-b),positions,'static sections retain requested order');
 assert.match(core,/settingsView\.appendChild\(maintenanceAdminSection\)/);
 assert.match(core,/maintenanceAdminSection\.after\(whatsNewButton\)/);
 assert.doesNotMatch(core,/maintenanceAdminSection\.before\(whatsNewButton\)/);
});

test('Settings categories use scalable icons and Prior Releases reserves readable metadata width',()=>{
 const html=read('index.html'),dashboard=read('assets/js/dashboard.js'),css=read('assets/css/dashboard.css'),appCss=read('assets/css/app.css'),core=read('assets/js/app-core.js');
 assert.match(html,/settings-category-icon[^>]*aria-hidden="true"><svg viewBox=/);
 assert.ok(dashboard.includes("<strong class=\"release-show-title\"><span>${esc(event.item.title)}</span>${scheduleProgressMarker(event.item,progressMarkers)}</strong><span>${esc(event.label)}"));
 assert.match(css,/\.prior-releases \.release-tba-item\{grid-template-columns:minmax\(0,1fr\) minmax\(145px,40%\)/);
 assert.match(appCss,/\.settings-category-icon svg\{width:24px;height:24px;fill:none;stroke:currentColor/);
 assert.match(appCss,/\.settings-category-row\[data-settings-open="general"\] \.settings-category-icon\{background:linear-gradient/);
 assert.match(css,/@media\(max-width:390px\)\{\.prior-releases \.release-tba-item\{grid-template-columns:minmax\(0,1fr\) minmax\(132px,42%\)/);
 assert.match(html,/id="maintenance-settings-button"[^>]*data-settings-open="maintenance"/);
 assert.match(core,/selected\.dataset\.authorized!=="true"/);
 assert.match(core,/maintenanceAdminSection\.dataset\.settingsPanel="maintenance"/);
 assert.match(read('assets/js/reminders.js'),/maintenanceAdminSection\.dataset\.authorized="true"[\s\S]*maintenance-settings-button/);
});

test('Settings surfaces share the Changelog theme colour rather than fixed lighter greys',()=>{
 const css=read('assets/css/app.css');
 assert.ok(css.includes('.settings-category-menu,.settings-quick-actions{background:var(--card)'));
 assert.ok(css.includes('.settings-detail-panel>.profile-card{border-radius:25px;background:var(--card)'));
 assert.ok(!css.includes('background:#292929')&&!css.includes('background:#2b2b2d'));
});

test('A compact search action replaces the labelled Add button and separate Search tab',()=>{
 const html=read('index.html');
 assert.match(html,/id="add-btn"[^>]*aria-label="Search and add titles"/);
 assert.doesNotMatch(html,/data-tab="search"|aria-label="Add show or film"/);
 assert.match(html,/id="discovery-view"[^>]*role="dialog"/);
 assert.match(html,/id="close-title-search"/);
});


test('Verified fixes are committed in source, not injected during deployment',()=>{
 const html=read('index.html'),editor=read('assets/js/editor.js'),sync=read('assets/js/sync.js'),css=read('assets/css/app.css'),workflow=read('.github/workflows/pages.yml');
 assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/);
 assert.match(editor,/available\.length\?Math\.max\(0,\.\.\.available\.filter\(episode=>episode<=requested\)\):requested/);
 assert.match(sync,/toMillis\(raw\.updatedAt\|\|raw\.date\)>toMillis\(prev\.updatedAt\|\|prev\.date\)/);
 assert.match(css,/max-height:90vh;max-height:90dvh/);
 assert.doesNotMatch(workflow,/apply_fixes\.py/);
});
