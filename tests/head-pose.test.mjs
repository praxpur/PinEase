import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require=createRequire(import.meta.url)
function moduleFor(path,mocks={}) {
  const source=readFileSync(new URL(path,import.meta.url),'utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const exports={};vm.runInNewContext(code,{exports,require:name=>mocks[name]??require(name)});return exports
}
const {readHeadPose,calibrateHeadPose}=moduleFor('../src/lib/head-pose.ts')
const {visionPlan}=moduleFor('../src/lib/vision-options.ts')
function matrix(pitch,yaw,roll){
  const [x,y,z]=[pitch,yaw,roll].map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z)
  return {rows:4,columns:4,data:[cy*cz,cy*sz,-sy,0,cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx,0,cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx,0,2,3,4,1]}
}
const face=Array.from({length:478},()=>({x:.5,y:.5,z:0}));face[33]={x:.4,y:.4,z:0};face[263]={x:.6,y:.4,z:0};face[61]={x:.44,y:.6,z:0};face[291]={x:.56,y:.6,z:0}
const nose={x:.5,y:.5,z:0,visibility:.99,presence:.99}
function angles(value,expected){for(const key of ['pitch','yaw','roll'])assert.ok(Math.abs(value[key]-expected[key])<1e-8,key)}
test('MediaPipe column-major transform recovers combined XYZ rotations and ignores translation',()=>{
  angles(readHeadPose(matrix(17,-22,8),face,nose,100),{pitch:17,yaw:-22,roll:8})
  angles(readHeadPose(matrix(0,0,0),face,nose,100),{pitch:0,yaw:0,roll:0})
})
test('head pose rejects bad matrices, unrelated faces and weak body association',()=>{
  assert.equal(readHeadPose(matrix(0,0,0),face,{...nose,visibility:.2},0),null)
  assert.equal(readHeadPose(matrix(0,0,0),face,{...nose,x:.9},0),null)
  const invalid=matrix(0,0,0);invalid.data[4]=.5
  assert.equal(readHeadPose(invalid,face,nose,0),null)
  assert.equal(readHeadPose(matrix(0,0,0),undefined,nose,0),null)
})
test('face reference requires 20 stable samples over six seconds without long gaps',()=>{
  const samples=Array.from({length:31},(_,i)=>({...readHeadPose(matrix(10,5,-3),face,nose,i*200)}))
  const reference=calibrateHeadPose(samples);angles(reference,{pitch:10,yaw:5,roll:-3})
  assert.equal(calibrateHeadPose(samples.slice(0,19)),null)
  assert.equal(calibrateHeadPose(samples.slice(10)),null)
  assert.equal(calibrateHeadPose(samples.map((s,i)=>({...s,yaw:i%2?20:-20}))),null)
  assert.equal(calibrateHeadPose(samples.map((s,i)=>({...s,observedAt:i>15?s.observedAt+2000:s.observedAt}))),null)
})
test('model preferences and independent face features produce the correct plan',()=>{
  const summary=p=>Array.from(visionPlan(p,false,true).attempts,v=>v.model+v.delegate).join(',')
  assert.equal(summary('auto'),'fullGPU,fullCPU,liteGPU,liteCPU')
  assert.equal(summary('full'),'fullGPU,fullCPU')
  assert.equal(summary('lite'),'liteGPU,liteCPU')
  assert.equal(visionPlan('auto',false,true).useFace,true)
  assert.equal(visionPlan('auto',true,false).useFace,true)
  assert.equal(visionPlan('auto',false,false).useFace,false)
})

function workerHarness({failPose=[],failFace=[]}={}){
  const attempts=[],faceAttempts=[],posts=[]
  const scope={postMessage:message=>posts.push(message)}
  const poseNose={...nose}
  const mockPose={detectForVideo:()=>({landmarks:[[poseNose]]}),close(){}}
  const mockFace={detectForVideo:()=>({faceLandmarks:[face],faceBlendshapes:[{categories:[{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.9}]}],facialTransformationMatrixes:[matrix(10,5,-3)]}),close(){}}
  const sdk={FilesetResolver:{forVisionTasks:async()=>({wasmLoaderPath:'wasm.js'})},PoseLandmarker:{createFromOptions:async(_files,options)=>{const key=options.baseOptions.modelAssetPath.split('/').at(-1)+':'+options.baseOptions.delegate;attempts.push(key);if(failPose.includes(key))throw Error(key);return mockPose}},FaceLandmarker:{createFromOptions:async(_files,options)=>{faceAttempts.push(options);if(failFace.includes(options.baseOptions.delegate))throw Error('face');return mockFace}}}
  let source=readFileSync(new URL('../src/workers/vision.worker.ts',import.meta.url),'utf8').replace("await import(/* @vite-ignore */ files.wasmLoaderPath)","await Promise.resolve({default: () => {}})")
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const blink=moduleFor('../src/domain/blink.ts')
  const modules={'@mediapipe/tasks-vision':sdk,'@/lib/head-pose':{readHeadPose},'@/lib/vision-options':{visionPlan},'@/domain/blink':blink}
  vm.runInNewContext(code,{self:scope,exports:{},require:name=>modules[name]??require(name),performance:{now:()=>100},console:{warn(){},error(){}}})
  return{scope,posts,attempts,faceAttempts}
}
test('worker: head pose works independently of blink; face GPU falls back to CPU',async()=>{
  const w=workerHarness({failFace:['GPU']})
  await w.scope.onmessage({data:{type:'init',assets:'http://localhost/',blink:false,headPose:true,preference:'auto'}})
  const ready=w.posts.at(-1);assert.equal(ready.type,'ready');assert.equal(ready.headPoseAvailable,true);assert.equal(ready.blink,false)
  assert.equal(w.faceAttempts.length,2);assert.equal(w.faceAttempts[1].baseOptions.delegate,'CPU');assert.equal(w.faceAttempts[1].outputFacialTransformationMatrixes,true);assert.equal(w.faceAttempts[1].outputFaceBlendshapes,false)
  const bitmap={width:640,height:480,close(){this.closed=true}}
  await w.scope.onmessage({data:{type:'frame',bitmap,timestamp:100}})
  const frame=w.posts.at(-1);assert.equal(frame.type,'frame');angles(frame.headPose,{pitch:10,yaw:5,roll:-3});assert.equal(frame.blink,null);assert.equal(bitmap.closed,true)
})
test('worker: Lite fallback is explicit, strict Full does not silently use Lite, and face failure leaves body available',async()=>{
  const failures=['pose_landmarker_full.task:GPU','pose_landmarker_full.task:CPU']
  const auto=workerHarness({failPose:failures,failFace:['GPU','CPU']})
  await auto.scope.onmessage({data:{type:'init',assets:'http://localhost/',blink:true,headPose:true,preference:'auto'}})
  const ready=auto.posts.at(-1);assert.equal(ready.model,'lite');assert.equal(ready.headPoseAvailable,false);assert.equal(ready.blink,false);assert.match(ready.warning,/Lite/)
  const bitmap={width:640,height:480,close(){}};await auto.scope.onmessage({data:{type:'frame',bitmap,timestamp:100}});assert.equal(auto.posts.at(-1).type,'frame')
  const strict=workerHarness({failPose:failures});await strict.scope.onmessage({data:{type:'init',assets:'http://localhost/',blink:false,preference:'full'}})
  assert.equal(strict.posts.at(-1).type,'error');assert.equal(strict.attempts.length,2);assert.equal(strict.attempts.some(v=>v.includes('lite')),false)
})
