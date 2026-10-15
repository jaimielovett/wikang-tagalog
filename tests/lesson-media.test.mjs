import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingToShare,soundFrom,privateAddress} from '../src/lib/lesson-media.ts';

const timed='[[0,5,0,1]]';
test('only a recording this computer alone has goes to private storage',()=>{
 assert.deepEqual(recordingToShare({media_path:'C:/data/media/1.m4a',media_url:null,source:'C:/Users/me/clip.mp3'}),{ext:'m4a',type:'audio/mp4'});
 assert.deepEqual(recordingToShare({media_path:'/Users/me/Library/media/2.mp3',source:''}),{ext:'mp3',type:'audio/mpeg'},'a voice made by the app');
 // from YouTube or a podcast: the other computer fetches it from there
 assert.equal(recordingToShare({media_path:'C:/data/media/3.m4a',media_url:'https://www.youtube.com/watch?v=abcdefghijk',source:'https://www.youtube.com/watch?v=abcdefghijk'}),null);
 assert.equal(recordingToShare({media_path:'C:/data/media/4.m4a',source:'https://pod.example/ep1'}),null);
 // already shared, a published lesson, a text, an unknown format
 assert.equal(recordingToShare({media_path:'C:/data/media/5.m4a',media_url:'learner-media:u/5.m4a',source:'C:/x.mp3'}),null);
 assert.equal(recordingToShare({media_path:'https://cdn.example/signed.m4a',source:''}),null);
 assert.equal(recordingToShare({media_path:null,source:''}),null);
 assert.equal(recordingToShare({media_path:'C:/data/media/6.xyz',source:'C:/x.xyz'}),null);
});
test('a lesson arriving without its sound knows where to get it',()=>{
 assert.deepEqual(soundFrom({media_path:null,media_url:'https://www.youtube.com/watch?v=abcdefghijk',source:'https://www.youtube.com/watch?v=abcdefghijk',timings:timed}),{url:'https://www.youtube.com/watch?v=abcdefghijk',direct:false});
 assert.deepEqual(soundFrom({media_path:null,media_url:'https://cdn.example/ep1.mp3',source:'https://pod.example/ep1',timings:timed}),{url:'https://cdn.example/ep1.mp3',direct:true});
 assert.deepEqual(soundFrom({media_path:null,media_url:privateAddress('u-1/abc.m4a'),source:'C:/Users/me/clip.mp3',timings:timed}),{private:'u-1/abc.m4a'});
 assert.deepEqual(soundFrom({media_path:null,source:'https://vimeo.com/123',timings:timed}),{url:'https://vimeo.com/123',direct:false});
 // already here, a text lesson, or a recording never shared: nothing to fetch
 assert.equal(soundFrom({media_path:'C:/data/media/1.m4a',source:'https://www.youtube.com/watch?v=abcdefghijk',timings:timed}),null);
 assert.equal(soundFrom({media_path:null,source:'https://news.example/article',timings:null}),null);
 assert.equal(soundFrom({media_path:null,source:'C:/Users/me/clip.mp3',timings:timed}),null);
});
