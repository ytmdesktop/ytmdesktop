const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const loader = require('./theme-loader.cjs');
const load = loader();
const model = load('src/shared/themes/model.ts');
const engine = load('src/shared/themes/css.ts');
const { CSSLayers } = load('src/main/integrations/custom-css/layers.ts');
const clone = x => JSON.parse(JSON.stringify(x));
const preset = id => ({...model.defaultSelection(),mode:'preset',presetId:id});
class View extends EventEmitter {
  constructor(){super();this.css=new Map();this.serial=0;this.dead=false;}
  isDestroyed(){return this.dead;}
  getURL(){return 'https://music.youtube.com/';}
  async insertCSS(css){const key=String(++this.serial);this.css.set(key,css);return key;}
  async removeInsertedCSS(key){this.css.delete(key);}
}

test('eight distinct presets, original has no layer, eight tokens and round-trip validation', () => {
  assert.equal(model.colorKeys.length,8);
  assert.equal(model.presets.length,8);
  const outputs=model.presets.map(p=>engine.generateCSS(preset(p.id)));
  assert.equal(new Set(outputs).size,8);
  outputs.forEach(css=>{require('postcss').parse(css);assert.match(css,/ytmusic-nav-bar/);assert.doesNotMatch(css,/color-mix\(/);});
  assert.equal(engine.generateCSS(model.defaultSelection()),'');
  const custom={...preset('deep-indigo'),mode:'custom'};
  assert.equal(engine.generateCSS(custom),engine.generateCSS(preset('deep-indigo')));
  assert.deepEqual(model.validateSelection(clone(custom)),custom);
  for(const p of model.presets) assert.ok(model.contrast(p.tokens.text,p.tokens.background)>4.5);
  assert.throws(()=>model.validateSelection({...custom,tokens:{...custom.tokens,accent:'red; color:evil'}}));
  assert.throws(()=>model.validateSelection({...custom,effects:{...custom.effects,blur:Infinity}}));
  for(const key of model.colorKeys) assert.notEqual(engine.generateCSS({...custom,tokens:{...custom.tokens,[key]:'#abcdef'}}),outputs[0]);
});
test('migration retains legacy flags externally and keeps saved custom separate from active preset', () => {
  const state=model.normalizeState(undefined);assert.equal(state.selection.mode,'original');assert.equal(state.selection.overrides,true);
  state.custom.tokens.accent='#123456';state.selection=preset('ocean-blue');
  assert.equal(model.normalizeState(clone(state)).custom.tokens.accent,'#123456');
  assert.equal(model.normalizeState({selection:{bad:true},imports:[]}).selection.mode,'original');
});
test('resource policy rejects escaped and commented URLs/imports, accepts self-contained source',()=>{
  for(const css of ['@import "https://x";', 'a{background:url(file:///secret)}','a{background:u\\72l(https://x)}','@im/**/port "x";', 'a{background:image-set("x" 1x)}','a{behavior:expression(x)}']) assert.throws(()=>engine.validateCSS(css));
  engine.validateCSS('a{color:#123456;background:linear-gradient(red,blue)}');
});
test('serialized insertion cleans delayed stale keys across rapid changes and view replacement',async()=>{
  const layers=new CSSLayers();const a=new View();let release;const old=a.insertCSS.bind(a);
  a.insertCSS=async css=>{await new Promise(r=>release=r);return old(css);};
  const first=layers.set(a,['old']);await new Promise(r=>setImmediate(r));
  const b=new View();const second=layers.set(b,['preset','override']);release();await Promise.all([first,second]);
  assert.equal(a.css.size,0);assert.deepEqual([...b.css.values()],['preset','override']);
  await Promise.all([layers.set(b,['one']),layers.set(b,['two']),layers.set(b,[])]);assert.equal(b.css.size,0);
  await layers.set(null,[]);
});

test('real service: imports, duplicate hash, preview/cancel, persistence, export, invalid files and sender validation',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ytmd-theme-test-'));
  let handler;let chosen;let destination;
  const wc={mainFrame:{}};const win={webContents:wc,isDestroyed:()=>false};
  const electron={app:{getPath:()=>dir},ipcMain:{handle:(_name,fn)=>handler=fn},dialog:{showOpenDialog:async()=>({canceled:!chosen,filePaths:[chosen]}),showSaveDialog:async()=>({canceled:!destination,filePath:destination})}};
  const Service=loader({electron})('src/main/integrations/custom-css/index.ts').default;
  const appearance={customCSSEnabled:true,customCSSPath:path.join(dir,'legacy.css'),zoom:130};
  await fs.writeFile(appearance.customCSSPath,'body{--legacy:1}');
  const store={get:key=>key.split('.').reduce((v,k)=>v?.[k],{appearance}),set:(key,value)=>{assert.equal(key,'appearance.theme');appearance.theme=clone(value);}};
  const view=new View();const service=new Service();service.registerIPC(()=>win,store);service.provide(store,{webContents:view});
  const event={sender:wc,senderFrame:wc.mainFrame};const call=(a,v,x)=>handler(event,a,v,x);
  t.after(()=>{service.watch(null);return fs.rm(dir,{recursive:true,force:true});});
  assert.equal((await handler({sender:{},senderFrame:{}},'get')).ok,false);
  assert.equal(appearance.customCSSEnabled,true);assert.equal(appearance.zoom,130);
  view.getURL=()=>'';
  await call('apply',preset('deep-indigo'));assert.equal(view.css.size,0,'empty startup view must not enqueue CSS');
  view.getURL=()=>'https://music.youtube.com/';
  await call('apply',preset('deep-indigo'));assert.equal(view.css.size,2);
  await call('preview',{...preset('ocean-blue'),overrides:false});assert.equal(view.css.size,1);assert.equal(appearance.theme.selection.presetId,'deep-indigo');
  await call('cancel');assert.equal(view.css.size,2);
  for(let i=1;i<=2;i++){chosen=path.join(dir,`import${i}.css`);await fs.writeFile(chosen,`body{--import:${i}}`);assert.equal((await call('import')).ok,true);}
  await call('import');assert.equal(appearance.theme.imports.length,2);
  const id=appearance.theme.imports[0].id;
  await call('apply',{...model.defaultSelection(),mode:'imported',importId:id,overrides:false});assert.deepEqual([...view.css.values()],['body{--import:1}']);
  await call('rename',id,'Renamed');assert.equal(appearance.theme.imports[0].name,'Renamed');
  assert.equal((await call('rename',id,'')).ok,false);
  await call('remove',id);assert.equal(appearance.theme.selection.mode,'original');assert.equal(view.css.size,0);
  assert.equal(await fs.readFile(path.join(dir,'import1.css'),'utf8'),'body{--import:1}');
  const custom={...preset('deep-indigo'),mode:'custom',tokens:{...model.indigo,accent:'#123456'}};
  await call('apply',custom);await call('apply',preset('rose'));assert.equal(appearance.theme.custom.tokens.accent,'#123456');
  destination=path.join(dir,'export.css');await call('export',custom);assert.equal(await fs.readFile(destination,'utf8'),engine.generateCSS(custom));
  for(const [name,data] of [['bad.txt','a{}'],['large.css',' '.repeat(engine.MAX_CSS_BYTES+1)],['remote.css','@import "x";'],['utf.css',Buffer.from([0xff,0xfe])]]){chosen=path.join(dir,name);await fs.writeFile(chosen,data);assert.equal((await call('import')).ok,false,name);}
  chosen=path.join(dir,'missing.css');assert.equal((await call('import')).ok,false);
  await call('apply',{...model.defaultSelection(),overrides:false});assert.equal(view.css.size,0);
  await call('apply',custom);await call('preview',preset('ocean-blue'));service.cancelPreview();await service.render();assert.equal(appearance.theme.selection.mode,'custom');
  service.watch(null);
  const reopened=new Service();reopened.registerIPC(()=>win,store);reopened.provide(store,{webContents:view});await reopened.render();assert.equal((await call('get')).state.selection.tokens.accent,'#123456');
  reopened.watch(null);
});
