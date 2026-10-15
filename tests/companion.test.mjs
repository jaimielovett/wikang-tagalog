import test from 'node:test';
import assert from 'node:assert/strict';
import {accountLesson,planFor} from '../src/lib/companion-plan.ts';
import {remoteMedia} from '../src/lib/remote-media.ts';

const made=(extra)=>({id:4,lang:'tl',title:'Adobo',collection:'',kind:'video',source:'',text:'Magandang araw.',media_path:'C:/media/4.m4a',timings:'[[0,8,0,1]]',video_path:null,hue:3,word_count:2,duration:61,timing_v:2,created_at:1760000000,...extra});

test('a YouTube video plays from YouTube on the web: nothing is uploaded',()=>{
 const p=planFor(made({source:'https://www.youtube.com/watch?v=abcdefghijk',media_url:'https://www.youtube.com/watch?v=abcdefghijk',video_path:'C:/media/4.mp4'}));
 assert.deepEqual(p,{media_url:'https://www.youtube.com/watch?v=abcdefghijk',kind:'video',upload:null});
});
test('a podcast episode plays from its own address',()=>{
 assert.deepEqual(planFor(made({kind:'audio',source:'https://pod.example/ep1',media_url:'https://cdn.example/ep1.mp3'})),{media_url:'https://cdn.example/ep1.mp3',kind:'audio',upload:null});
});
test('a recording from the computer keeps a private copy of its sound, as audio',()=>{
 assert.deepEqual(planFor(made({source:'C:/Users/me/clip.mp4'})),{media_url:null,kind:'audio',upload:{from:'C:/media/4.m4a',ext:'m4a',type:'audio/mp4'}});
 // a page that isn't a sound file (a podcast's web page) can't be played from: its sound is kept too
 assert.equal(planFor(made({source:'https://pod.example/ep1',media_url:'https://pod.example/ep1'})).upload.ext,'m4a');
 assert.throws(()=>planFor(made({media_path:'C:/media/4.xyz'})),/can't be kept online/);
});
test('a text lesson travels as text',()=>{
 assert.deepEqual(planFor(made({kind:'text',media_path:null,timings:null})),{media_url:null,kind:'text',upload:null});
});
test('the account gets the web\'s lesson: no computer paths, the private copy playable there',()=>{
 const l=accountLesson(made({source:'C:/Users/me/clip.mp4'}),1760000000123000,'learner-media:user-1/1760000000123000.m4a','audio');
 assert.equal(l.id,1760000000123000);assert.equal(l.media_path,null);assert.equal(l.video_path,null);assert.equal(l.cover_path,null);
 assert.equal(l.timings,'[[0,8,0,1]]');assert.equal(l.position,0);assert.equal(l.completed,false);
 assert.deepEqual(remoteMedia(l),{kind:'private',path:'user-1/1760000000123000.m4a'});
 assert.equal('media_url' in accountLesson(made({kind:'text'}),1,null,'text'),false);
});
