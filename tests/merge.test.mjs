import test from 'node:test';
import assert from 'node:assert/strict';
import {hasLearning,mergeGuest} from '../src/lib/web/merge.ts';

const day=(words,secs)=>({day:'2026-10-14',lang:'tl',words_read:words,known_added:0,lingqs:0,listen_secs:0,learn_secs:secs,goal_met:false});
const lesson=(id,title,text=title)=>({id,lang:'tl',title,text,collection:'',kind:'text',source:''});
const term=(status,updated_at)=>({term:'bahay',status,translation:'',note:'',lemma:'',context:'',updated_at});
const db=(over={})=>({settings:{lang:'tl'},lessons:[],terms:{},activity:{},nextId:1,installed:[],...over});

test('only guests with learning are merged',()=>{
 assert.equal(hasLearning(undefined),false);
 assert.equal(hasLearning(db()),false);
 assert.equal(hasLearning(db({settings:{onboarded:'1'}})),true);
});

test('guest learning joins a new account, welcome and all',()=>{
 const guest=db({settings:{onboarded:'1',daily_goal:'20',last_lesson:'1'},lessons:[lesson(1,'Ang parola sa isla')],nextId:2,terms:{'tl|bahay':term(4,10)}});
 const merged=mergeGuest(db(),guest);
 assert.equal(merged.settings.onboarded,'1');
 assert.equal(merged.settings.daily_goal,'20');
 assert.equal(merged.lessons.length,1);
 assert.equal(merged.settings.last_lesson,String(merged.lessons[0].id));
 assert.equal(merged.terms['tl|bahay'].status,4);
});

test('an existing account keeps its lessons and settings, gains the guest\'s, and remaps references',()=>{
 const account=db({settings:{onboarded:'1',daily_goal:'10'},lessons:[lesson(1,'Ang parola sa isla'),lesson(2,'Mine')],nextId:3,terms:{'tl|bahay':term(2,50)},activity:{'2026-10-14|tl':day(100,60)}});
 const guest=db({settings:{onboarded:'1',daily_goal:'20','catalogue_abc':'2','published_2':'abc'},lessons:[lesson(1,'Ang parola sa isla'),lesson(2,'Guest story')],nextId:3,
  terms:{'tl|bahay':term(4,99)},activity:{'2026-10-14|tl':day(40,30)},playlists:[{id:1,lang:'tl',name:'Guest list',lessons:[1,2],current:2,created_at:0}],
  chats:[{id:1,lang:'tl',title:'',lesson_id:2,created_at:0,updated_at:0,messages:[]}]});
 const merged=mergeGuest(account,guest);
 assert.deepEqual(merged.lessons.map(l=>l.title),['Ang parola sa isla','Mine','Guest story']);
 assert.deepEqual(merged.lessons.slice(0,2).map(l=>l.id),[1,2],'the account keeps its lessons and ids');
 const guestStory=merged.lessons[2].id;
 assert.ok(guestStory>Date.UTC(2026,0)*1000,'a guest lesson gets an id from the clock');
 assert.ok(merged.nextId>guestStory);
 assert.equal(merged.settings.daily_goal,'10');
 assert.equal(merged.settings.catalogue_abc,String(guestStory));
 assert.equal(merged.settings[`published_${guestStory}`],'abc');
 assert.equal(merged.settings.published_2,undefined);
 assert.equal(merged.terms['tl|bahay'].status,4);
 assert.equal(merged.activity['2026-10-14|tl'].words_read,140);
 assert.equal(merged.activity['2026-10-14|tl'].learn_secs,90);
 assert.deepEqual(merged.playlists[0].lessons,[1,guestStory]);
 assert.equal(merged.playlists[0].current,guestStory);
 assert.equal(merged.chats[0].lesson_id,guestStory);
 assert.equal(account.lessons.length,2,'the account input is untouched');
});
