import {cpSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'www');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
for(const entry of ['index.html','library-gallery.js','library-gallery.css','assets','manifest.webmanifest'])cpSync(path.join(root,entry),path.join(out,entry),{recursive:true});
let sha='';
try{sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
if(!sha)try{sha=readFileSync(path.join(root,'SOURCE_COMMIT'),'utf8').trim();}catch{}
if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('A source commit is required for the iOS build.');
writeFileSync(path.join(out,'build-info.js'),'window.WATCHLOG_BUILD='+JSON.stringify({sha,count:0,releaseNumber:null,commits:[],platform:'ios'})+';\n');
let html=readFileSync(path.join(out,'index.html'),'utf8');
html=html.replace('</head>','<style>'+readFileSync(path.join(root,'native/controls.css'),'utf8')+'</style>\n</head>');
// Native builds contain their own shell; website deployments cannot replace it.
html=html.replace('<script src="assets/js/deployment-channel.js"></script>','');
html=html.replace('<script src="assets/js/editor.js?v=27"></script>','<script src="assets/js/editor.js?v=27"></script>\n  <script src="native.js"></script>');
if(!html.includes('src="native.js"'))throw new Error('Native script insertion marker changed.');
writeFileSync(path.join(out,'index.html'),html);
const featurePath=path.join(out,'assets/js/features.js');
writeFileSync(featurePath,readFileSync(featurePath,'utf8').replace('if(navigator.serviceWorker){',"if(window.location.protocol!=='capacitor:'&&navigator.serviceWorker){"));
await build({entryPoints:[path.join(root,'native/bridge.js')],bundle:true,format:'iife',platform:'browser',target:'safari17',outfile:path.join(out,'native.js'),legalComments:'eof'});
console.log(`iOS web assets built from ${sha.slice(0,7)}.`);
