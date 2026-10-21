const vm=require('node:vm'), fs=require('node:fs'), assert=require('node:assert/strict');
const path=require('node:path');
const root=path.join(__dirname,'..');
function element(){return {value:'',textContent:'',className:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return []},appendChild(){},addEventListener(){}};}
let nodes=new Map(), timers=[], sources=[];
const doc={createElement:element,getElementById(id){if(!nodes.has(id)) nodes.set(id,element());return nodes.get(id)},querySelectorAll(){return []},addEventListener(){},documentElement:{style:{setProperty(){}}},body:element()};
const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}});
class Audio {
 constructor(){this.currentTime=0;this.state='suspended';this.destination={};}
 async resume(){this.state='running'}
 createGain(){return {gain:param(),connect(){return this},disconnect(){}}}
 createOscillator(){return this.source(true)}
 createBufferSource(){return this.source(false)}
 source(tone){const s={tone,frequency:param(),playbackRate:param(),connect(){return this},disconnect(){},start(time){this.time=time;sources.push(this)},stop(){this.stopped=true}};return s;}
 createBuffer(channels,length,rate){const data=new Float32Array(length);return {duration:length/rate,getChannelData(){return data}}}
}
const context={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,Float32Array,Map,Set,performance:{now:()=>0},atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),document:doc,navigator:{},localStorage:{setItem(){},getItem(){return null}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},AudioContext:Audio,OfflineAudioContext:Audio,alert:message=>{throw Error(message)}};
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'voice-bank.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'voice-warm.js'),'utf8'),context);
let script=fs.readFileSync(path.join(root,'app.js'),'utf8').replace('return { init, getDefaultState };',`return { init, getDefaultState, encodeSettingsCompact, decodeSettingsCompact, validateSettings, setupAudioContext, scheduleSpeech, scheduler, stopMetronome, handleStartStop, renderPatternStep, encodeWAV, handlePatternKeyPress, initPatternConfig, getState:()=>state, setState:s=>state=s, getContext:()=>audioContext, getPreferences:()=>preferences, getQueue:()=>visualQueue, cacheDomElements, setChannel, channelEnabled, shouldSpeak, applyBulk };`);
vm.runInContext(script+'\nglobalThis.testApp=App;',context);
const app=context.testApp;app.cacheDomElements();app.setState({...app.getDefaultState(),isRunning:false});app.initPatternConfig();
const state=app.getState();state.patternConfig[0].tts='say "hello" & <world> 🐒 '.repeat(10);state.soundParams.cow.emoji='"<🐮>';state.soundParams.cow.vol=1;state.displayMode='beat';
const decoded=app.decodeSettingsCompact(app.encodeSettingsCompact());assert.equal(decoded.patternConfig[0].tts,state.patternConfig[0].tts);assert.equal(decoded.soundParams.cow.emoji,state.soundParams.cow.emoji);assert.equal(decoded.soundParams.cow.vol,1);assert.equal(decoded.displayMode,'beat');
for(const change of [s=>s.b=NaN,s=>s.m=9,s=>s.soundParams.cow.vol=5,s=>s.patternConfig[0].animal='constructor',s=>s.preferences.volume=-1]){const bad=JSON.parse(JSON.stringify(decoded));change(bad);assert.throws(()=>app.validateSettings(bad));}
assert.equal(app.decodeSettingsCompact('RT4.invalid'),null);
// Recreate original compact wire format including fixed 32-slot padding.
const pad=(n,l)=>String(n).padStart(l,'0');let old='1204'+'8b5cf6'+'64748b';for(let i=0;i<6;i++)old+='0500'+'40'+'0070'+'0'+'001'+'060';old+='11'.repeat(16)+'00'.repeat(16);for(let i=0;i<16;i++){const t=encodeURIComponent(i===0?'one':'and');old+=pad(t.length,2)+t;}const legacy=app.decodeSettingsCompact(Buffer.from(old).toString('base64url'));assert.equal(legacy.patternConfig[0].tts,'one');assert.equal(legacy.patternConfig[15].tts,'and');
const cell=element();cell.id='step-0';state.patternEditMode='tts';app.renderPatternStep(cell,state.patternConfig[0]);assert.ok(cell.innerHTML.includes('&quot;'));assert.ok(!cell.innerHTML.includes('<world>'));
let prevented=false;app.handlePatternKeyPress({target:{matches:()=>true},key:' ',preventDefault(){prevented=true}});assert.equal(prevented,false);
// Independent switches preserve speech text and the other two channels.
const step=state.patternConfig[0], originalWords=step.tts;
step.behavior='both';app.setChannel(step,'speech',false,0);
assert.equal(step.tts,originalWords);assert.equal(step.behavior,'both');assert.equal(app.shouldSpeak(0),false);
app.setChannel(step,'speech',true,0);assert.equal(app.shouldSpeak(0),true);
app.setChannel(step,'sound',false,0);assert.equal(step.behavior,'display');assert.equal(step.speechEnabled,true);
app.setChannel(step,'visual',false,0);assert.equal(step.behavior,'off');assert.equal(step.tts,originalWords);
step.animal='none';app.setChannel(step,'sound',true,0);assert.equal(step.behavior,'hear');assert.equal(step.animal,'cow');
app.setChannel(step,'speech',false,0);app.getPreferences().voice='warm';
const saved=app.decodeSettingsCompact(app.encodeSettingsCompact());assert.equal(saved.preferences.voice,'warm');assert.equal(saved.patternConfig[0].speechEnabled,false);assert.equal(saved.patternConfig[0].tts,originalWords);
const oldSettings=JSON.parse(JSON.stringify(saved));oldSettings.preferences.speech='beats';oldSettings.patternConfig.forEach(s=>delete s.speechEnabled);
const migrated=app.validateSettings(oldSettings);assert.equal(migrated.preferences.speech,'all');assert.equal(migrated.patternConfig[0].speechEnabled,true);assert.equal(migrated.patternConfig[1].speechEnabled,false);
app.getPreferences().speech='off';app.setChannel(step,'speech',true,0);assert.equal(app.shouldSpeak(0),false);app.getPreferences().speech='all';

const beforeBulk=state.patternConfig.map(s=>({tts:s.tts,behavior:s.behavior}));
for (const mode of ['on','off','beats','eighths']) {
 app.applyBulk('speech',mode);
 state.patternConfig.forEach((step,i)=>{assert.equal(step.speechEnabled,mode==='on'||(mode==='beats'&&i%4===0)||(mode==='eighths'&&i%2===0));assert.equal(step.tts,beforeBulk[i].tts);assert.equal(step.behavior,beforeBulk[i].behavior);});
}

(async()=>{
 await app.setupAudioContext();assert.equal(app.getContext().state,'running');
 // All standard spoken subdivisions are independently scheduled, even at 300 BPM.
 for (const voice of ['clear','warm']) for (const bpm of [60,120,180,300]){app.getPreferences().voice=voice;const interval=60/bpm/4;for(const word of ['one','e','and','a']){assert.equal(app.scheduleSpeech(word,1,interval),true);const source=sources.at(-1);assert.ok(source.buffer.duration/source.playbackRate.value <= interval*.9+1e-8);assert.equal(source.time,1)}}
 app.getPreferences().voice='device:test';assert.equal(app.scheduleSpeech('one',1,.5),false);app.getPreferences().voice='clear';
 state.isRunning=true;state.bpm=120;state.nextNoteTime=0;state.current16thNote=0;state.patternConfig=Array.from({length:16},(_,i)=>({animal:'cow',behavior:'both',tts:i%4===0?'one':'and'}));app.getPreferences().speech='all';app.getContext().currentTime=10;
 sources=[];app.scheduler();assert.ok(sources.length<=4,'stall must not burst overdue notes');assert.ok(sources.every(s=>s.time>=10));
 const tones=sources.filter(s=>s.tone), speech=sources.filter(s=>!s.tone);assert.equal(tones[0].time,speech[0].time,'voice and tone use identical audio timestamp');
 app.stopMetronome();assert.ok(sources.every(s=>s.stopped));assert.equal(app.getQueue().length,0);
 // A second tap cancels asynchronous resume and cannot start a stale transport.
 sources=[];const first=app.handleStartStop();await app.handleStartStop();await first;assert.equal(state.isRunning,false);
 const wav=app.encodeWAV(new Float32Array([0,1,-1]),1,44100,1,16);assert.equal(new DataView(wav).getUint32(40,true),6);assert.equal(wav.byteLength,50);
 console.log('PASS: settings round-trip, legacy import, validation, escaping, typing, audio resume, both voices at 60–300 BPM, device fallback, independent switches, speech text preservation, voice/switch sharing and legacy migration, stall recovery, voice/tone synchronization, stop cancellation, rapid start/stop, WAV encoding.');
})().catch(e=>{console.error(e);process.exitCode=1});
