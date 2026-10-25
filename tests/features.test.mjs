import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

async function sourceModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { BlinkTracker, readBlinkScore } = await sourceModule('../src/domain/blink.ts')
const { cuePlan, playReminder } = await sourceModule('../src/lib/audio.ts')

test('blink: counts close/reopen cycles; rate remains unknown until 20 seconds of observation', () => {
  const tracker = new BlinkTracker()
  assert.equal(tracker.update(.1, 0).rate, null)
  let result
  for (let t = 50; t <= 21000; t += 50) {
    result = tracker.update(t % 3000 >= 1000 && t % 3000 <= 1100 ? .9 : .1, t)
    if (t < 20000) assert.equal(result.rate, null)
  }
  assert.equal(result.count, 7)
  assert.equal(result.seconds, 21)
  assert.equal(result.rate, 20)
})

test('blink: no blink or observation time is invented across loss of face or slow samples', () => {
  const tracker = new BlinkTracker()
  tracker.update(.1, 0); tracker.update(.9, 50); tracker.update(null, 100)
  assert.equal(tracker.update(.1, 5000).count, 0)
  assert.equal(tracker.snapshot(5000).seconds, .05)
  tracker.reset()
  for (let t = 0; t <= 21000; t += 50) tracker.update(.1, t)
  assert.equal(tracker.snapshot(21000).rate, 0)
  assert.equal(tracker.update(.1, 23000).rate, null)
  assert.equal(tracker.snapshot(85000).seconds, 0)
  assert.equal(tracker.snapshot(85000).rate, null)
})

test('blink: sustained closure, invalid scores and slow capture do not create a plausible rate', () => {
  const tracker = new BlinkTracker()
  for (let t = 0; t <= 2000; t += 50) tracker.update(.9, t)
  assert.equal(tracker.update(.1, 2050).count, 0)
  tracker.reset()
  for (let t = 0; t <= 30000; t += 200) assert.equal(tracker.update(t % 400 ? .1 : .9, t).rate, null)
  assert.equal(tracker.update(NaN, 31000).fresh, false)
  tracker.reset(); assert.equal(tracker.snapshot(32000).count, 0)
})

test('blink: requires bilateral finite scores and visible, separated eyes', () => {
  const points = Array.from({length: 478}, () => ({x: .5, y: .5}))
  points[33].x = .4; points[263].x = .6
  const categories = [{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.9}]
  assert.ok(Math.abs(readBlinkScore(points,categories) - .85) < .0001)
  assert.equal(readBlinkScore(undefined,categories),null)
  assert.equal(readBlinkScore(points,categories.slice(0,1)),null)
  points[263].x = 1.1; assert.equal(readBlinkScore(points,categories),null)
  points[263].x = .41; assert.equal(readBlinkScore(points,categories),null)
})

test('audio: configurable strength, repeat bounds, envelopes and cleanup', () => {
  assert.ok(cuePlan(80,2).gain > cuePlan(30,2).gain)
  assert.equal(cuePlan(0,1).gain,0)
  assert.equal(cuePlan(1000,10).count,3)
  const tones = [], gains = []
  const context = {currentTime:10,destination:{},createOscillator:()=>{
    const node={frequency:{setValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{node.cleaned=true},start:time=>node.startAt=time,stop:time=>node.stopAt=time}
    tones.push(node);return node
  },createGain:()=>{const values=[];const node={gain:{setValueAtTime:v=>values.push(v),linearRampToValueAtTime:v=>values.push(v),exponentialRampToValueAtTime:v=>values.push(v)},connect:()=>{},disconnect:()=>{node.cleaned=true},values};gains.push(node);return node}}
  playReminder(context,70,3)
  assert.equal(tones.length,3)
  assert.ok(tones[1].startAt > tones[0].stopAt)
  for (let i=0;i<tones.length;i++) {assert.ok(Math.max(...gains[i].values)<=.6);tones[i].onended();assert.equal(tones[i].cleaned,true);assert.equal(gains[i].cleaned,true)}
})

const require = createRequire(import.meta.url)
function component(path, mocks={}) {
  const source = readFileSync(new URL(path, import.meta.url),'utf8')
  const { descriptor } = parse(source)
  const code = compileScript(descriptor,{id:'test-component',inlineTemplate:true}).content
  const compiled = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports={}
  vm.runInNewContext(compiled,{exports,require:name=>mocks[name]??require(name),console})
  return exports.default
}
const Illustration=component('../src/components/PostureIllustration.vue')
test('illustration: front and side render different SVG drawings and accessible labels',async()=>{
  const front=await renderToString(createSSRApp(Illustration,{view:'front'}))
  const side=await renderToString(createSSRApp(Illustration,{view:'side'}))
  assert.match(front,/正面舒适坐姿示意/);assert.match(side,/侧面舒适坐姿示意/)
  assert.notEqual(front,side)
  assert.match(await renderToString(createSSRApp(Illustration,{view:'front',bad:true})),/正面低头坐姿示意/)
})
test('camera: mode selector remains present with idle, live and calibrating controls',async()=>{
  for(const phase of ['idle','monitoring','calibrating']) {
    const store={settings:{view:'side',showPreview:true,showSkeleton:true},phase,running:phase!=='idle',busy:false,demo:false,stream:null,landmarks:[],calibrationProgress:0}
    const Camera=component('../src/components/CameraPreview.vue',{'@/stores/monitor':{useMonitorStore:()=>store},'./PostureIllustration.vue':{default:Illustration,__esModule:true}})
    const html=await renderToString(createSSRApp(Camera))
    assert.match(html,/aria-label="监测模式"/)
    if(phase==='calibrating')assert.match(html,/<select[^>]*disabled/)
    else assert.doesNotMatch(html,/<select[^>]*disabled/)
    if(phase==='monitoring') {assert.match(html,/暂停/);assert.match(html,/结束/)}
    if(phase==='idle')assert.match(html,/侧面舒适坐姿示意/)
  }
})


test('legacy sound preferences receive defaults and imported values are bounded', () => {
  function cjs(path, mocks={}) {
    const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    const exports={};vm.runInNewContext(code,{exports,require:name=>mocks[name]??require(name)});return exports
  }
  const types=cjs('../src/domain/types.ts')
  const {sanitizeSettings}=cjs('../src/lib/storage.ts',{'@/domain/types':types})
  const old=sanitizeSettings({soundEnabled:true})
  assert.equal(old.soundVolume,70);assert.equal(old.soundRepeats,2);assert.equal(old.soundEnabled,true)
  const invalid=sanitizeSettings({soundVolume:500,soundRepeats:-5})
  assert.equal(invalid.soundVolume,100);assert.equal(invalid.soundRepeats,1)
  assert.equal(sanitizeSettings({soundVolume:NaN}).soundVolume,70)
  assert.equal(Object.hasOwn(sanitizeSettings({funEnabled:false}), 'funEnabled'),false)
})
