import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require=createRequire(import.meta.url)
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
function loader(mocks={},globals={}) {
  const cache=new Map()
  const load=file=>{
    file=path.resolve(root,file)
    if(cache.has(file))return cache.get(file)
    const source=readFileSync(file,'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/')).replaceAll('import.meta.url',JSON.stringify('http://localhost/src/lib/vision.ts'))
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    const exports={};cache.set(file,exports)
    vm.runInNewContext(code,{exports,console,URL,DOMException,setTimeout,clearTimeout,...globals,require:name=>{
      if(Object.hasOwn(mocks,name))return mocks[name]
      if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts')
      if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'))
      return require(name)
    }},{filename:file})
    return exports
  }
  return load
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function storeHarness({pending=false,saveGate=null}={}) {
  let now=0,id=0
  const intervals=new Map(),instances=[]
  const storage={loadData:async()=>({settings:{},calibrations:[],sessions:[]}),saveSettings:async()=>{},saveSession:async record=>{if(record.endedAt!==null&&saveGate)await saveGate.promise},saveCalibration:async()=>{}}
  class FakeCamera {
    constructor(){this.task=deferred();this.stream={id:instances.length};this.video={videoWidth:640,videoHeight:480};instances.push(this)}
    open(){return pending?this.task.promise:Promise.resolve({cameraId:'test-camera',delegate:'CPU',blink:false})}
    close(){this.closed=true}
  }
  const pinia=require('pinia');pinia.setActivePinia(pinia.createPinia())
  const load=loader({'@/lib/storage':{...storage,sanitizeSettings:value=>({...load('src/domain/types.ts').DEFAULT_SETTINGS,...value})},'@/lib/vision':{VisionCamera:FakeCamera,cameraError:error=>error.message}},
    {window:{setTimeout:()=>++id,clearTimeout:()=>{},setInterval:fn=>{intervals.set(++id,fn);return id},clearInterval:n=>intervals.delete(n)},document:{hidden:false},navigator:{mediaDevices:{}},performance:{now:()=>now},crypto:{randomUUID:()=>String(++id)},clearInterval:n=>intervals.delete(n)})
  const store=load('src/stores/monitor.ts').useMonitorStore()
  return{store,instances,async tick(ms=1000){now+=ms;for(const fn of [...intervals.values()])fn();await Promise.resolve()}}
}

test('session: completing an old save cannot erase a newly started session',async()=>{
  const gate=deferred(),h=storeHarness({saveGate:gate})
  await h.store.startCamera();const old=h.store.session.id
  const ending=h.store.endSession()
  await h.store.startCamera();const next=h.store.session.id;assert.notEqual(next,old)
  gate.resolve();await ending
  assert.equal(h.store.session.id,next)
  assert.equal(h.store.phase,'ready')
})

test('session: rejected obsolete camera startup cannot clear a newer stream',async()=>{
  const h=storeHarness({pending:true})
  const first=h.store.startCamera();await h.store.endSession()
  const second=h.store.startCamera()
  h.instances[1].task.resolve({cameraId:'new',delegate:'CPU',blink:false});await second
  const stream=h.store.stream
  h.instances[0].task.reject(new Error('old cancelled'));await first
  assert.equal(h.store.stream,stream);assert.equal(h.store.error,'')
})

test('session: lock/background pause cancels a camera still loading',async()=>{
  const h=storeHarness({pending:true}),opening=h.store.startCamera()
  h.store.pause('locked')
  h.instances[0].task.resolve({cameraId:'old',delegate:'CPU',blink:false});await opening
  assert.equal(h.store.phase,'idle');assert.equal(h.store.stream,null)
  assert.equal(h.instances[0].closed,true)
})

test('reminders: editing volume does not postpone a due sedentary reminder',async()=>{
  const h=storeHarness();await h.store.updateSettings({sitMinutes:10});await h.store.startDemo()
  for(let i=0;i<599;i++)await h.tick()
  assert.equal(h.store.restOpen,false)
  await h.store.updateSettings({soundVolume:50})
  await h.tick()
  assert.equal(h.store.restOpen,true);assert.equal(h.store.restKind,'break')
})

function cameraHarness() {
  let preview=null,intervalId=0
  const sent=[],fallbacks=[]
  const video=()=>({srcObject:null,muted:false,playsInline:false,paused:true,readyState:4,currentTime:1,videoWidth:640,videoHeight:480,
    async play(){this.paused=false},pause(){this.paused=true},setAttribute(){},remove(){this.removed=true}})
  class Worker {
    postMessage(message){sent.push(message);if(message.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready',delegate:'CPU',blink:false}}))}
    terminate(){this.terminated=true}
  }
  const streams=[]
  const load=loader({}, {window:{location:{href:'http://localhost/'},isSecureContext:true,setTimeout:()=>1,setInterval:()=>++intervalId,clearInterval:()=>{}},
    navigator:{mediaDevices:{getUserMedia:async()=>{const track={stop(){this.stopped=true},getSettings:()=>({deviceId:'camera'})};const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(stream);return stream}}},
    document:{createElement:()=>video(),body:{append:node=>fallbacks.push(node)}},Worker,
    createImageBitmap:async()=>({close(){}}),performance:{now:()=>100},queueMicrotask,clearTimeout:()=>{}})
  const {VisionCamera}=load('src/lib/vision.ts')
  return{camera:()=>new VisionCamera(()=>{},()=>{},()=>preview),setPreview:value=>{preview=value},video,sent,fallbacks,streams}
}

test('camera: navigation without a preview continues capture through an owned fallback',async()=>{
  const h=cameraHarness(),preview=h.video();h.setPreview(preview)
  const camera=h.camera();await camera.open('','user',false,12)
  preview.srcObject=null;h.setPreview(null)
  await camera.capture()
  assert.equal(h.fallbacks.length,1)
  assert.equal(h.sent.at(-1).type,'frame')
  camera.close();assert.equal(h.fallbacks[0].removed,true);assert.equal(h.streams[0].getTracks()[0].stopped,true)
})

test('camera: closing an old owner leaves the new preview and stream attached',async()=>{
  const h=cameraHarness(),preview=h.video();h.setPreview(preview)
  const first=h.camera();await first.open('','user',false,12)
  const second=h.camera();await second.open('','user',false,12)
  const stream=preview.srcObject;first.close()
  assert.equal(preview.srcObject,stream);assert.equal(preview.paused,false)
  second.close();assert.equal(preview.srcObject,null)
})

test('history: a segment crossing midnight is shared between both local days',()=>{
  const {dailyStats}=loader()('src/lib/format.ts')
  const today=new Date();today.setHours(0,0,0,0);const midnight=today.getTime()
  const record={segments:[{startedAt:midnight-30000,endedAt:midnight+30000,seconds:60,state:'normal'}],reminders:[]}
  const stats=dailyStats([record],2)
  assert.equal(stats[0].goodSeconds,30);assert.equal(stats[1].goodSeconds,30)
})

test('backup: invalid dates, impossible durations and side profiles without a neck are rejected',()=>{
  const {validSession,validCalibration}=loader()('src/lib/storage.ts')
  const record={id:'valid',mode:'real',view:'front',startedAt:1000,endedAt:2000,goodSeconds:1,badSeconds:0,unknownSeconds:0,absentSeconds:0,pausedSeconds:0,segments:[{startedAt:1000,endedAt:2000,seconds:1,state:'normal',reason:''}],reminders:[]}
  assert.equal(validSession(record),true)
  assert.equal(validSession({...record,goodSeconds:1e100}),false)
  assert.equal(validSession({...record,endedAt:500}),false)
  assert.equal(validSession({...record,startedAt:1e20}),false)
  assert.equal(validSession({...record,segments:[{...record.segments[0],seconds:1e100}]}),false)
  const profile={id:'side',view:'side',cameraId:'camera',aspect:1.3,createdAt:1000,sampleCount:20,side:'left',baseline:{side:'left',neck:null,torso:null,drop:0,shift:0,shoulders:0,scale:0}}
  assert.equal(validCalibration(profile),false)
  assert.equal(validCalibration({...profile,baseline:{...profile.baseline,neck:15}}),true)
})

const {isTrustedUrl,canRequest,canCheck}=require('../electron/permissions.cjs')
test('desktop: camera and notifications work only for the app or configured local development origin',()=>{
  assert.equal(isTrustedUrl('app://pinease/index.html'),true)
  assert.equal(isTrustedUrl('app://pinease.evil/index.html'),false)
  assert.equal(isTrustedUrl('https://example.com/'),false)
  assert.equal(isTrustedUrl('http://localhost:5180/','http://localhost:5180/'),true)
  assert.equal(isTrustedUrl('http://localhost:5181/','http://localhost:5180/'),false)
  assert.equal(isTrustedUrl('https://example.com/','https://example.com/'),false)
  assert.equal(canRequest('notifications'),true)
  assert.equal(canRequest('media',{mediaTypes:['video']}),true)
  assert.equal(canRequest('media',{mediaTypes:['video','audio']}),false)
  assert.equal(canRequest('display-capture'),false)
  assert.equal(canCheck('media',{mediaType:'video'}),true)
  assert.equal(canCheck('media',{mediaType:'audio'}),false)
  assert.equal(canCheck('notifications',{isMainFrame:false}),false)
})
