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
function storeHarness({pending=false,saveGate=null,model='lite',headAvailable=false}={}) {
  let now=0,id=0
  const intervals=new Map(),instances=[]
  const storage={loadData:async()=>({settings:{},calibrations:[],sessions:[]}),saveSettings:async()=>{},saveSession:async record=>{if(record.endedAt!==null&&saveGate)await saveGate.promise},saveCalibration:async()=>{}}
  class FakeCamera {
    constructor(onFrame){this.deliver=onFrame;this.task=deferred();this.stream={id:instances.length};this.video={videoWidth:640,videoHeight:480};instances.push(this)}
    open(){return pending?this.task.promise:Promise.resolve({cameraId:'test-camera',delegate:'CPU',model,blink:false,headPoseAvailable:headAvailable})}
    close(){this.closed=true}
  }
  const pinia=require('pinia');pinia.setActivePinia(pinia.createPinia())
  const load=loader({'@/lib/storage':{...storage,sanitizeSettings:value=>({...load('src/domain/types.ts').DEFAULT_SETTINGS,...value})},'@/lib/vision':{VisionCamera:FakeCamera,cameraError:error=>error.message}},
    {window:{setTimeout:()=>++id,clearTimeout:()=>{},setInterval:fn=>{intervals.set(++id,fn);return id},clearInterval:n=>intervals.delete(n)},document:{hidden:false},navigator:{mediaDevices:{}},performance:{now:()=>now},crypto:{randomUUID:()=>String(++id)},clearInterval:n=>intervals.delete(n)})
  const store=load('src/stores/monitor.ts').useMonitorStore()
  return{store,instances,emit(time,landmarks,headPose=null){now=time;instances.at(-1).deliver({type:'frame',timestamp:time,landmarks,width:640,height:480,blink:null,headPose,inferenceMs:1})},async tick(ms=1000){now+=ms;for(const fn of [...intervals.values()])fn();await Promise.resolve()}}
}

test('vertical posture update requires recalibration once while preserving old profiles and history', async () => {
  for (const featureVersion of [undefined, 2]) {
    const { store } = storeHarness()
    store.profiles = [{ id: 'test-camera:front', cameraId: 'test-camera', view: 'front', aspect: 4 / 3, side: 'left', createdAt: 1000, sampleCount: 40,
      ...(featureVersion ? { featureVersion } : {}), baseline: { side: 'left', neck: 0, torso: 0, drop: -.5, shift: 0, shoulders: 0, scale: .3 } }]
    await store.startCamera()
    assert.equal(store.profiles.length, 1)
    assert.equal(store.phase, featureVersion ? 'monitoring' : 'ready')
    if (!featureVersion) assert.match(store.reason, /重新校准/)
    await store.endSession()
  }
})

test('switching from a Lite calibration to Full requires recalibration without deleting history', async () => {
  const h = storeHarness({model:'full'})
  h.store.profiles = [{id:'test-camera:front',cameraId:'test-camera',view:'front',aspect:4/3,side:'left',createdAt:1000,sampleCount:40,featureVersion:2,poseModel:'lite',baseline:{side:'left',neck:0,torso:null,drop:-.5,shift:0,shoulders:0,scale:.3}}]
  await h.store.startCamera()
  assert.equal(h.store.phase,'ready')
  assert.match(h.store.reason,/模型已切换/)
  assert.equal(h.store.profiles.length,1)
  await h.store.endSession()
})

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
  const vertical = { ...profile, featureVersion: 2, baseline: { ...profile.baseline, neck: 15, headPitch: 8, neckHeight: .5, torsoHeight: 1.2 } }
  assert.equal(validCalibration(vertical), true)
  for (const invalid of [{ headPitch: NaN }, { headPitch: 120 }, { neckHeight: -1 }, { torsoHeight: Infinity }]) {
    assert.equal(validCalibration({ ...vertical, baseline: { ...vertical.baseline, ...invalid } }), false)
  }
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


test('store: short landmark gaps pause candidate hold and confirmed recovery; long gaps reset the hold', async () => {
  const point=(x,y,confidence=.99)=>({x,y,z:0,visibility:confidence,presence:confidence})
  const frame=y=>{const points=Array.from({length:33},()=>point(0,0,0));points[0]=point(.5,y);points[11]=point(.35,.6);points[12]=point(.65,.6);return points}
  const {observe}=loader()('src/domain/posture.ts')
  const normal=frame(.35),bad=frame(.5)
  const base=observe(normal,640,480,'front').features
  const h=storeHarness()
  h.store.profiles=[{id:'test-camera:front',cameraId:'test-camera',view:'front',aspect:4/3,side:base.side,createdAt:1000,sampleCount:40,featureVersion:2,poseModel:'lite',baseline:base}]
  await h.store.startCamera();assert.equal(h.store.phase,'monitoring')
  h.emit(100,bad);assert.equal(h.store.state,'candidate_bad')
  h.emit(3000,bad);h.emit(3100,[]);assert.equal(h.store.state,'unknown')
  h.emit(3400,bad);h.emit(6401,bad);assert.equal(h.store.state,'bad')
  h.emit(6500,[]);h.emit(6800,normal);assert.equal(h.store.state,'bad')
  h.emit(8801,normal);assert.equal(h.store.state,'normal')
  await h.store.endSession()
  const second=storeHarness();second.store.profiles=[{id:'test-camera:front',cameraId:'test-camera',view:'front',aspect:4/3,side:base.side,createdAt:1000,sampleCount:40,featureVersion:2,poseModel:'lite',baseline:base}]
  await second.store.startCamera();second.emit(100,bad);second.emit(3000,bad);second.emit(3100,[]);second.emit(4001,bad);second.emit(7000,bad)
  assert.equal(second.store.state,'candidate_bad')
  await second.store.endSession()
})


test('side calibration requires time coverage for the chosen ear and shoulder, not only both sides combined',async()=>{
  const point=(x,y,q)=>({x,y,z:0,visibility:q,presence:q})
  const frame=side=>{const points=Array.from({length:33},()=>point(0,0,0));points[0]=point(.6,.3,.9);points[7]=point(.57,.3,side==='left'?.95:.7);points[8]=point(.57,.3,side==='right'?.95:.7);points[11]=point(.5,.5,side==='left'?.95:.7);points[12]=point(.5,.5,side==='right'?.95:.7);return points}
  const h=storeHarness();await h.store.updateSettings({view:'side'});await h.store.startCamera();h.store.beginCalibration()
  for(let i=0;i<19;i++)h.emit(100+i*300,frame('right'))
  for(let i=0;i<20;i++)h.emit(7000+i*50,frame('left'))
  await h.tick(50)
  assert.equal(h.store.phase,'ready');assert.match(h.store.reason,/持续时间不足/)
  await h.store.endSession()
})

test('store calibrates and exposes head pose independently of blink and clears stale data',async()=>{
  const point=(x,y,q=0)=>({x,y,z:0,visibility:q,presence:q})
  const body=Array.from({length:33},()=>point(0,0));body[0]=point(.5,.35,.99);body[11]=point(.35,.6,.99);body[12]=point(.65,.6,.99)
  const h=storeHarness({headAvailable:true});await h.store.updateSettings({headPoseEnabled:true});await h.store.startCamera();h.store.beginCalibration()
  for(let i=0;i<=30;i++){const t=100+i*250;h.emit(t,body,{pitch:10,yaw:5,roll:-3,faceCenterX:.5,faceCenterY:.4,faceWidth:.2,observedAt:t})}
  await h.tick(400)
  assert.equal(h.store.phase,'monitoring');assert.ok(h.store.profile.faceBaseline);assert.equal(h.store.headPoseAvailable,true)
  h.emit(8050,body,{pitch:15,yaw:8,roll:-1,faceCenterX:.5,faceCenterY:.4,faceWidth:.2,observedAt:8050})
  assert.equal(h.store.headPoseDelta.pitch,5);assert.equal(h.store.headPoseDelta.yaw,3);assert.equal(h.store.headPoseDelta.roll,2)
  await h.tick(2000);assert.equal(h.store.headPoseDelta,null)
  await h.store.endSession()
})


test('new monitored sessions record candidate time separately from confirmed bad time',async()=>{
  const point=(x,y,q)=>({x,y,z:0,visibility:q,presence:q})
  const body=y=>{const p=Array.from({length:33},()=>point(0,0,0));p[0]=point(.5,y,.99);p[11]=point(.35,.6,.99);p[12]=point(.65,.6,.99);return p}
  const base=loader()('src/domain/posture.ts').observe(body(.35),640,480,'front').features
  const h=storeHarness();h.store.profiles=[{id:'test-camera:front',cameraId:'test-camera',view:'front',aspect:4/3,side:base.side,createdAt:1000,sampleCount:40,featureVersion:2,poseModel:'lite',baseline:base}]
  await h.store.startCamera();assert.equal(h.store.session.accountingVersion,2)
  h.emit(100,body(.5));await h.tick(1000)
  assert.ok(h.store.session.candidateSeconds>0);assert.equal(h.store.session.badSeconds,0)
  await h.store.endSession()
})
