#!/usr/bin/env python3
"""Package the existing web app for Odoo Website's built-in HTTP actions.

Only public, fixed build files are served. No Odoo records, incoming request
bodies, authentication secrets, or remotely supplied executable code are read.
Import the generated CSV through Settings > Technical > Server Actions.
"""
import argparse
import base64
import csv
from html.parser import HTMLParser
from html import escape
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/website/action/watchlog/'


class HomepageXML(HTMLParser):
    VOID = set('area base br col embed hr img input link meta param source track wbr'.split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.output = ['<t name="Watch Tracker" t-name="website.homepage">']

    def handle_starttag(self, tag, attrs):
        attributes = ''.join(' ' + key + '="' + escape(value if value is not None else key, quote=True) + '"' for key, value in attrs)
        self.output.append('<' + tag + attributes + ('/>' if tag in self.VOID else '>'))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag not in self.VOID:
            self.output.append('</' + tag + '>')

    def handle_data(self, data):
        self.output.append(escape(data, quote=False))

    def xml(self):
        return ''.join(self.output) + '</t>'


def replace_once(value, old, new):
    if value.count(old) != 1:
        raise ValueError('Hosting adapter source changed: ' + old[:90])
    return value.replace(old, new, 1)


def build(output):
    output = Path(output).resolve()
    runtime = output / 'runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    for name in ['index.html', 'library-gallery.js', 'library-gallery.css',
                 'manifest.webmanifest', 'sw.js', 'release-notes.json']:
        shutil.copyfile(ROOT / name, runtime / name)
    shutil.copytree(ROOT / 'assets', runtime / 'assets', dirs_exist_ok=True)
    # CI generates the Pages build before running tests; rebuild from its
    # current HTML too, without embedding stale metadata or editing the source.
    index = runtime / 'index.html'
    index.write_text(re.sub(r'<script>window\.WATCHLOG_BUILD=[\s\S]*?</script>',
                            '<script src="build-info.js"></script>', index.read_text()))
    env = dict(os.environ)
    env['GIT_DIR'] = subprocess.check_output(['git', 'rev-parse', '--absolute-git-dir'], cwd=ROOT, text=True).strip()
    env['GIT_WORK_TREE'] = str(ROOT)
    subprocess.run(['node', str(ROOT / 'scripts/build-info.mjs')], cwd=runtime, env=env, check=True)
    (runtime / 'release-notes.json').unlink()

    html = (runtime / 'index.html').read_text()
    html = replace_once(html, '<head>', '<head>\n  <base href="' + PREFIX + '">')
    (runtime / 'index.html').write_text(html)
    manifest = json.loads((runtime / 'manifest.webmanifest').read_text())
    manifest.update(id='/', start_url='/', scope='/')
    (runtime / 'manifest.webmanifest').write_text(json.dumps(manifest))
    for name, old, new in [
        ('assets/js/features.js', "scope:'./'", "scope:'/'"),
        ('assets/js/reminders.js', 'scope:"./"', 'scope:"/"'),
    ]:
        path = runtime / name
        path.write_text(replace_once(path.read_text(), old, new))

    worker = (runtime / 'sw.js').read_text()
    worker = replace_once(worker, 'const NAVIGATION_CACHE=', 'const SHELL_BASE=new URL(' + json.dumps(PREFIX) + ',self.location.origin);\nconst NAVIGATION_CACHE=')
    worker = replace_once(worker, 'const scope=new URL(self.registration.scope);', 'const scope=SHELL_BASE;')
    worker = worker.replace('new URL("asset-manifest.json",self.registration.scope)', 'new URL("asset-manifest.json",SHELL_BASE)')
    worker = worker.replace('new URL(path,self.registration.scope)', 'new URL(path,SHELL_BASE)')
    worker = worker.replace('new URL("index.html",self.registration.scope)', 'new URL("index.html",SHELL_BASE)')
    worker = worker.replace('new URL("./index.html",self.registration.scope)', 'new URL("index.html",SHELL_BASE)')
    worker = replace_once(worker, 'if(request.mode==="navigate"){', '''if(request.mode==="navigate"){
    // This worker controls the app at the origin root but must never cache,
    // replace, or interfere with Odoo administration, login, or other pages.
    const navigationPath=new URL(request.url).pathname;
    if(!["/","/index.html",SHELL_BASE.pathname.slice(0,-1),SHELL_BASE.pathname,SHELL_BASE.pathname+"index.html"].includes(navigationPath))return;
    const navigationRequest=new Request(new URL("index.html",SHELL_BASE),{cache:"no-store"});''')
    worker = replace_once(worker, 'fetch(request,{cache:"no-store",signal:controller.signal})', 'fetch(navigationRequest,{cache:"no-store",signal:controller.signal})')
    (runtime / 'sw.js').write_text(worker)

    # A public, read-only deployment check: it never signs in, requests push
    # permission, or reads account/library state. Keep it out of app navigation.
    (runtime / 'hosting-check.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><title>Watch Tracker hosting check</title>
<h1>Watch Tracker hosting check</h1><pre id="checks">Checking public hosting and offline installation…</pre>
<script>
(async()=>{
 const result={}; const prefix='/website/action/watchlog/';
 try{
  const response=await fetch(prefix+'sw.js',{cache:'no-store'});
  result.workerFile=response.ok&&/javascript/.test(response.headers.get('content-type')||'');
  result.workerScope=response.headers.get('service-worker-allowed');
  const manifest=await(await fetch(prefix+'asset-manifest.json',{cache:'no-store'})).json();
  const files=await Promise.all(manifest.assets.map(async name=>{
   const response=await fetch(prefix+name,{cache:'no-store'});
   return {name,ok:response.ok,type:response.headers.get('content-type')};
  }));
  result.assetCount=files.length;result.missingAssets=files.filter(file=>!file.ok);
  const registration=await navigator.serviceWorker.register(prefix+'sw.js',{scope:'/',updateViaCache:'none'});
  await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Worker installation timed out')),20000))]);
  result.activeWorker=registration.active?.scriptURL;result.scope=registration.scope;
  const cache=await caches.open('watchlog-shell-'+manifest.version);
  const cached=await Promise.all(manifest.assets.map(name=>cache.match(new URL(prefix+name,location.origin).href)));
  result.offlineAssetsReady=cached.filter(Boolean).length===manifest.assets.length;
  result.cachedAssets=cached.filter(Boolean).length;
  result.pass=result.workerFile&&result.workerScope==='/'&&result.missingAssets.length===0&&result.offlineAssetsReady;
 }catch(error){result.error=error.message;result.pass=false;}
 document.getElementById('checks').textContent=JSON.stringify(result,null,2);
})();
</script></html>''')

    parser = HomepageXML()
    parser.feed(html)
    (output / 'homepage.xml').write_text(parser.xml())
    import xml.etree.ElementTree as ET
    ET.fromstring(parser.xml())

    mime_types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
                  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'}
    files = {str(path.relative_to(runtime)): [mime_types[path.suffix], base64.b64encode(path.read_bytes()).decode()]
             for path in sorted(runtime.rglob('*')) if path.is_file()}
    worker_csp = "default-src 'none'; connect-src 'self' https://static.tvmaze.com https://image.tmdb.org https://m.media-amazon.com https://*.mzstatic.com"
    code = '''# Watch Tracker public build files only. This action never reads or writes Odoo records.
files = ''' + json.dumps(files, separators=(',', ':')) + '''
prefix = '/website/action/watchlog/'
path = request.httprequest.path
key = path[len(prefix):] if path.startswith(prefix) else 'index.html' if path == prefix[:-1] else ''
key = key or 'index.html'
asset = files.get(key)
if asset:
    headers = [('Content-Type', asset[0]), ('Cache-Control', 'no-cache'), ('X-Content-Type-Options', 'nosniff')]
    if key == 'sw.js':
        headers.append(('Service-Worker-Allowed', '/'))
        headers.append(('Content-Security-Policy', ''' + repr(worker_csp) + '''))
    response = request.make_response(b64decode(asset[1]), headers=headers)
else:
    response = request.make_response('Not found', headers=[('Content-Type', 'text/plain'), ('Cache-Control', 'no-store')], status=404)
'''
    compile(code, 'odoo-public-assets', 'exec')
    (output / 'public-assets.py').write_text(code)
    with (output / 'server-actions.csv').open('w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['id', 'name', 'model_id/id', 'state', 'website_published', 'website_path', 'code'])
        writer.writerow(['__import__.watchlog_public_assets', 'Watch Tracker public app files',
                         'base.model_ir_filters', 'code', 'True', 'watchlog', code])
    (output / 'deployment.json').write_text(json.dumps({'prefix': PREFIX, 'fileCount': len(files),
                                                      'sourceSha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()}))
    print(json.dumps({'output': str(output), 'files': len(files), 'importBytes': (output / 'server-actions.csv').stat().st_size}))


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--output', default=str(ROOT / 'odoo-dist'))
    build(args.parse_args().output)
