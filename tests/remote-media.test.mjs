import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteMedia,youtubeId} from '../src/lib/remote-media.ts';

test('YouTube addresses of every shape give the video id',()=>{
 for(const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3','https://youtu.be/dQw4w9WgXcQ','https://m.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/embed/dQw4w9WgXcQ','https://music.youtube.com/watch?v=dQw4w9WgXcQ'])
  assert.equal(youtubeId(u),'dQw4w9WgXcQ',u);
 for(const u of ['https://example.com/watch?v=dQw4w9WgXcQ','C:/media/1.mp4','',null,'https://www.youtube.com/@channel'])assert.equal(youtubeId(u),null,String(u));
});

test('a lesson without media here plays from YouTube or the episode address, files on this device first',()=>{
 assert.deepEqual(remoteMedia({media_path:null,source:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}),{kind:'youtube',id:'dQw4w9WgXcQ'});
 assert.deepEqual(remoteMedia({media_path:null,source:'https://pod.example/ep',media_url:'https://cdn.example/ep1.mp3?x=1'}),{kind:'audio',url:'https://cdn.example/ep1.mp3?x=1'});
 assert.equal(remoteMedia({media_path:'C:/media/1.m4a',source:'https://youtu.be/dQw4w9WgXcQ'}),null);
 assert.equal(remoteMedia({media_path:null,source:'C:/Users/me/clip.mp4'}),null);
 assert.equal(remoteMedia({media_path:null,source:'https://pod.example/episode-page'}),null);
});
