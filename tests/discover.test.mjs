import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,isTagalog,titleLevels,grade,plain,readSource,refreshDiscover} from '../server/discover.mjs';

const rss=`<?xml version="1.0"?><rss><channel><title>Bandera</title>
<item><title>Arnold Clavio kinasuhan ng cyber libel</title><link>https://bandera.inquirer.net/1</link><guid>b-1</guid>
<pubDate>Tue, 14 Oct 2026 08:00:00 +0800</pubDate><description><![CDATA[<p>Kinasuhan ng cyber libel ang <b>broadcaster</b> ayon sa mga ulat &amp; mga saksi.</p><img src="http://img.example.org/a.jpg">]]></description></item>
<item><title>Lumang balita na may larawan ng mga artista</title><link>https://bandera.inquirer.net/0</link><pubDate>Mon, 13 Oct 2026 08:00:00 +0800</pubDate>
<media:content url="https://img.example.org/b.jpg" medium="image"/></item>
<item><title>No link at all</title></item>
</channel></rss>`;
const youtube=`<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Language Crush Tagalog</title>
<entry><yt:videoId>abcdefghijk</yt:videoId><title>Tagalog for Beginners (A1-A2): Greetings</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
<published>2026-10-02T10:00:00+00:00</published><media:group><media:thumbnail url="https://i1.ytimg.com/vi/abcdefghijk/hqdefault.jpg" width="480"/><media:description>Kumusta! Salamat sa panonood.</media:description></media:group></entry>
<entry><yt:videoId>bad</yt:videoId><title>Broken id</title></entry></feed>`;
const podcast=`<rss><channel><itunes:image href="https://img.example.org/show.jpg"/>
<item><title>Episode 1</title><guid>ep1</guid><enclosure url="http://cdn.example.org/ep1.mp3" type="audio/mpeg"/><itunes:duration>12:30</itunes:duration></item>
<item><title>Notes only</title><link>https://example.org/notes</link></item></channel></rss>`;

test('feeds become items: articles need a page, podcasts a sound, videos a valid id',()=>{
 const articles=parseFeed(rss,'https://bandera.inquirer.net/feed','articles');
 assert.deepEqual(articles.map(i=>i.title),['Arnold Clavio kinasuhan ng cyber libel','Lumang balita na may larawan ng mga artista']);
 assert.equal(articles[0].image,'https://img.example.org/a.jpg','image upgraded to HTTPS');
 assert.equal(articles[0].summary,'Kinasuhan ng cyber libel ang broadcaster ayon sa mga ulat & mga saksi.');
 assert.equal(articles[1].image,'https://img.example.org/b.jpg');
 const videos=parseFeed(youtube,'https://www.youtube.com/feeds/videos.xml?channel_id=x','youtube');
 assert.equal(videos.length,1);assert.equal(videos[0].url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(videos[0].summary,'Kumusta! Salamat sa panonood.');
 const episodes=parseFeed(podcast,'https://example.org/feed','podcast');
 assert.equal(episodes.length,1);assert.equal(episodes[0].url,'https://cdn.example.org/ep1.mp3');assert.equal(episodes[0].duration,750);assert.equal(episodes[0].image,'https://img.example.org/show.jpg');assert.equal(episodes[0].kind,'audio');
});

test('only Tagalog articles are kept; levels come from the source, narrowed by learner titles',()=>{
 assert.equal(isTagalog('Arnold Clavio kinasuhan ng cyber libel ng veteran broadcaster ayon sa mga ulat'),true);
 assert.equal(isTagalog('Walang pasok: Oct. 15 in-person classes suspended over poor air quality'),false);
 assert.deepEqual(titleLevels('Tagalog for Beginners (A1-A2)'),[1,2]);
 assert.deepEqual(titleLevels('Intermediate Tagalog conversation'),[3,4]);
 assert.equal(titleLevels('walang karne? pwede ba?'),null);
 assert.deepEqual(grade({lo:2,hi:4,grade_titles:true},'Super easy Tagalog'),[1,1],'a title that departs from the source wins');
 assert.deepEqual(grade({lo:3,hi:5,grade_titles:false},'Beginner news'),[3,5]);
 assert.equal(plain('<p>'+'salita '.repeat(80)+'</p>',40).endsWith('…'),true);
});

test('a refresh reads every source, keeps going past a dead feed, and reports it',async()=>{
 const feeds={'https://bandera.inquirer.net/feed':rss,'https://example.org/english':`<rss><channel><item><title>Classes suspended over poor air quality in Manila</title><link>https://example.org/e</link><description>Officials said schools will close.</description></item></channel></rss>`};
 const fetcher=async(url)=>{if(!feeds[url])throw new Error('The site did not respond.');return {status:200,url,body:feeds[url]};};
 const calls=[];
 const rpc=async(name,body)=>{calls.push([name,body]);return name==='discover_begin_refresh'?[
  {id:'tl-bandera',kind:'articles',url:'https://bandera.inquirer.net/feed',lo:3,hi:5},
  {id:'en-news',kind:'articles',url:'https://example.org/english',lo:3,hi:5},
  {id:'dead',kind:'articles',url:'https://example.org/dead',lo:3,hi:5}]:null;};
 const result=await refreshDiscover({rpc,fetcher});
 assert.deepEqual(result,{refreshed:true,sources:3,failed:['dead']});
 const stored=Object.fromEntries(calls[1][1].results.map(r=>[r.source_id,r]));
 assert.equal(stored['tl-bandera'].items.length,2);assert.match(stored['tl-bandera'].items[0].id,/^[0-9a-f]{32}$/);
 assert.equal(stored['en-news'].items.length,0,'English articles are left out');
 assert.match(stored.dead.error,/did not respond/);
 assert.deepEqual(await refreshDiscover({rpc:async()=>null,fetcher}),{refreshed:false,sources:0,failed:[]});
 await assert.rejects(readSource({id:'x',kind:'articles',url:'https://example.org/page',lo:1,hi:5},async(url)=>({status:200,url,body:'<html>not a feed</html>'})),/not a feed/);
});

test('a pasted address leads to its feed: the feed itself, a page linking to it, a usual path, or a YouTube channel',async()=>{
 const {findSource,learnerSources,pastedUrl}=await import('../server/discover.mjs');
 const pages={
  'https://news.example.org/feed':{status:200,body:rss},
  'https://blog.example.org/':{status:200,body:'<html><head><link rel="alternate" type="application/rss+xml" title="Feed" href="/rss/"></head></html>'},
  'https://blog.example.org/rss/':{status:200,body:rss},
  'https://guarded.example.org/':{status:403,body:'Forbidden'},
  'https://guarded.example.org/feed':{status:200,body:rss},
  'https://pod.example.org/show':{status:200,body:podcast},
  'https://www.youtube.com/@ninongry':{status:200,body:'<link rel="canonical" href="https://www.youtube.com/channel/UCvQrjgLj841wiQAKDgtKFOw">'},
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCvQrjgLj841wiQAKDgtKFOw':{status:200,body:youtube},
  'https://nofeed.example.org/':{status:200,body:'<html>No feed here</html>'},
 };
 const fetcher=async(url)=>{const page=pages[url];if(!page)return {status:404,url,body:''};return {...page,url};};
 assert.deepEqual(await findSource('https://news.example.org/feed',fetcher),{kind:'articles',url:'https://news.example.org/feed',name:'Bandera'});
 assert.equal((await findSource('http://blog.example.org/',fetcher)).url,'https://blog.example.org/rss/','follows the page\'s feed link, over HTTPS');
 assert.equal((await findSource('guarded.example.org',fetcher)).url,'https://guarded.example.org/feed','tries the usual feed path');
 assert.equal((await findSource('https://pod.example.org/show',fetcher)).kind,'podcast');
 assert.deepEqual(await findSource('https://www.youtube.com/@ninongry',fetcher),{kind:'youtube',url:'UCvQrjgLj841wiQAKDgtKFOw',name:'Language Crush Tagalog'});
 await assert.rejects(findSource('https://nofeed.example.org/',fetcher),/No feed was found/);
 assert.throws(()=>pastedUrl('javascript:alert(1)'),/Paste the address/);
 // what learners send to be read is checked before it costs anything
 const ok={id:'mine-abc123',kind:'articles',url:'https://news.example.org/feed',lo:3,hi:5,grade_titles:false};
 assert.equal(learnerSources([ok]).length,1);
 assert.throws(()=>learnerSources(Array(11).fill(ok)),/between one and ten/);
 for(const bad of [{...ok,id:'tl-bandera'},{...ok,url:'http://news.example.org/feed'},{...ok,kind:'youtube',url:'https://youtube.com/@x'},{...ok,lo:4,hi:2}])assert.throws(()=>learnerSources([bad]),/Invalid source/);
});
