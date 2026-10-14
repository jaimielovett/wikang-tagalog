//! Item-by-item sync with the learner's account: the database read and written in the web
//! app's record shapes (src/lib/web/sync.ts), with this computer's own ids. The TypeScript side
//! (src/lib/desktop-sync.ts) maps them to the account's ids and runs the shared sync engine.

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{db, text};

/// Everything that syncs, as the web stores it (lessons, playlists and chats with this computer's ids).
pub fn export(c: &Connection) -> Result<Value> {
    let mut settings = Map::new();
    let mut st = c.prepare("SELECT key, value FROM settings")?;
    for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = r?;
        settings.insert(k, Value::String(v));
    }

    let mut lessons = Vec::new();
    let mut st = c.prepare(
        "SELECT id,lang,title,collection,kind,source,text,media_path,timings,video_path,hue,word_count,page,completed,
                position,anchor,duration,cover_path,timing_v,created_at,opened_at,remote_media
         FROM lessons ORDER BY id",
    )?;
    let rows = st.query_map([], |r| {
        let mut l = json!({
            "id": r.get::<_, i64>(0)?,
            "lang": r.get::<_, String>(1)?,
            "title": r.get::<_, String>(2)?,
            "collection": r.get::<_, String>(3)?,
            "kind": r.get::<_, String>(4)?,
            "source": r.get::<_, String>(5)?,
            "text": r.get::<_, String>(6)?,
            "media_path": r.get::<_, Option<String>>(7)?,
            "timings": r.get::<_, Option<String>>(8)?,
            "video_path": r.get::<_, Option<String>>(9)?,
            "hue": r.get::<_, i64>(10)?,
            "word_count": r.get::<_, i64>(11)?,
            "page": r.get::<_, i64>(12)?,
            "completed": r.get::<_, i64>(13)? != 0,
            "position": r.get::<_, f64>(14)?,
            "anchor": r.get::<_, i64>(15)?,
            "duration": r.get::<_, f64>(16)?,
            "cover_path": r.get::<_, Option<String>>(17)?,
            "timing_v": r.get::<_, i64>(18)?,
            "created_at": r.get::<_, i64>(19)?,
        });
        if let Some(o) = r.get::<_, Option<i64>>(20)? {
            l["opened_at"] = json!(o);
        }
        if let Some(m) = r.get::<_, Option<String>>(21)? {
            l["media_url"] = json!(m);
        }
        Ok(l)
    })?;
    for r in rows {
        lessons.push(r?);
    }

    let mut terms = Map::new();
    let mut st = c.prepare("SELECT lang,term,status,translation,note,lemma,context,updated_at FROM terms")?;
    for r in st.query_map([], |r| {
        Ok((
            format!("{}|{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?),
            json!({
                "term": r.get::<_, String>(1)?,
                "status": r.get::<_, i64>(2)?,
                "translation": r.get::<_, String>(3)?,
                "note": r.get::<_, String>(4)?,
                "lemma": r.get::<_, String>(5)?,
                "context": r.get::<_, String>(6)?,
                "updated_at": r.get::<_, i64>(7)?,
            }),
        ))
    })? {
        let (k, v) = r?;
        terms.insert(k, v);
    }

    let mut activity = Map::new();
    let mut st = c.prepare("SELECT day,lang,words_read,known_added,lingqs,listen_secs,learn_secs,goal_met FROM activity")?;
    for r in st.query_map([], |r| {
        let (day, lang): (String, String) = (r.get(0)?, r.get(1)?);
        Ok((
            format!("{day}|{lang}"),
            json!({
                "day": day, "lang": lang,
                "words_read": r.get::<_, i64>(2)?, "known_added": r.get::<_, i64>(3)?, "lingqs": r.get::<_, i64>(4)?,
                "listen_secs": r.get::<_, i64>(5)?, "learn_secs": r.get::<_, i64>(6)?, "goal_met": r.get::<_, i64>(7)? != 0,
            }),
        ))
    })? {
        let (k, v) = r?;
        activity.insert(k, v);
    }

    let mut playlists = Vec::new();
    let mut st = c.prepare("SELECT id,lang,name,current_id,created_at FROM playlists ORDER BY id")?;
    let mut items = c.prepare("SELECT lesson_id FROM playlist_items WHERE playlist_id=?1 ORDER BY position")?;
    let rows: Vec<(i64, String, String, Option<i64>, i64)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, lang, name, current, created_at) in rows {
        let lessons: Vec<i64> = items.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        playlists.push(json!({ "id": id, "lang": lang, "name": name, "lessons": lessons, "current": current, "created_at": created_at }));
    }

    let mut chats = Vec::new();
    let mut st = c.prepare("SELECT id,lang,title,lesson_id,created_at,updated_at FROM chats ORDER BY id")?;
    let mut msgs = c.prepare("SELECT id,role,content,thought,thought_secs,created_at FROM chat_messages WHERE chat_id=?1 ORDER BY id")?;
    let rows: Vec<(i64, String, String, Option<i64>, i64, i64)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, lang, title, lesson_id, created_at, updated_at) in rows {
        let messages: Vec<Value> = msgs
            .query_map([id], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?, "role": r.get::<_, String>(1)?, "content": r.get::<_, String>(2)?,
                    "thought": r.get::<_, String>(3)?, "thought_secs": r.get::<_, f64>(4)?, "created_at": r.get::<_, i64>(5)?,
                }))
            })?
            .collect::<rusqlite::Result<_>>()?;
        chats.push(json!({ "id": id, "lang": lang, "title": title, "lesson_id": lesson_id, "created_at": created_at, "updated_at": updated_at, "messages": messages }));
    }

    Ok(json!({ "settings": settings, "lessons": lessons, "terms": terms, "activity": activity, "playlists": playlists, "chats": chats }))
}

/// One change from the account. `key` is a setting's name, a word's "lang|term", a day's "day|lang",
/// or a lesson's, playlist's or chat's id on this computer ("new:…" when it has none yet).
#[derive(Deserialize)]
pub struct Change {
    kind: String,
    key: String,
    data: Option<Value>,
}

/// A lesson, playlist or chat created here for an account record: its id on this computer.
#[derive(Serialize)]
pub struct Created {
    key: String,
    id: i64,
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or_default().to_string()
}
fn os(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}
fn n(v: &Value, k: &str) -> i64 {
    v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f.round() as i64))).unwrap_or(0)
}
fn f(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn local_id(key: &str) -> Option<i64> {
    key.parse().ok()
}

/// Applies the account's changes in one transaction. Media files downloaded on this computer
/// stay attached to their lesson when the account's copy has none.
pub fn apply(c: &mut Connection, changes: &[Change]) -> Result<Vec<Created>> {
    let tx = c.transaction()?;
    let mut created = Vec::new();
    for ch in changes {
        match (ch.kind.as_str(), &ch.data) {
            ("setting", Some(v)) => {
                tx.execute(
                    "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![ch.key, v.as_str().unwrap_or_default()],
                )?;
            }
            ("setting", None) => {
                tx.execute("DELETE FROM settings WHERE key=?1", [&ch.key])?;
            }
            ("lesson", Some(v)) => {
                let text_ = s(v, "text");
                let lang = s(v, "lang");
                let words = if v.get("word_count").is_some() { n(v, "word_count") } else { text::word_count(&text_, &lang) as i64 };
                let opened: Option<i64> = v.get("opened_at").and_then(|x| x.as_f64()).map(|x| x.round() as i64);
                match local_id(&ch.key) {
                    Some(id) => {
                        tx.execute(
                            "UPDATE lessons SET lang=?2,title=?3,collection=?4,kind=?5,source=?6,text=?7,
                               media_path=COALESCE(?8,media_path),timings=?9,video_path=COALESCE(?10,video_path),hue=?11,word_count=?12,
                               page=?13,completed=?14,position=?15,anchor=?16,duration=?17,cover_path=COALESCE(?18,cover_path),
                               timing_v=?19,opened_at=COALESCE(?20,opened_at),remote_media=COALESCE(?21,remote_media)
                             WHERE id=?1",
                            params![
                                id, lang, s(v, "title"), s(v, "collection"), s(v, "kind"), s(v, "source"), text_,
                                os(v, "media_path"), os(v, "timings"), os(v, "video_path"), n(v, "hue"), words,
                                n(v, "page"), b(v, "completed") as i64, f(v, "position"), n(v, "anchor"), f(v, "duration"),
                                os(v, "cover_path"), n(v, "timing_v"), opened, os(v, "media_url")
                            ],
                        )?;
                    }
                    None => {
                        tx.execute(
                            "INSERT INTO lessons(lang,title,collection,kind,source,text,media_path,timings,video_path,hue,word_count,page,
                               completed,position,anchor,duration,cover_path,timing_v,created_at,opened_at,remote_media)
                             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
                            params![
                                lang, s(v, "title"), s(v, "collection"), s(v, "kind"), s(v, "source"), text_,
                                os(v, "media_path"), os(v, "timings"), os(v, "video_path"), n(v, "hue"), words,
                                n(v, "page"), b(v, "completed") as i64, f(v, "position"), n(v, "anchor"), f(v, "duration"),
                                os(v, "cover_path"), n(v, "timing_v"),
                                if v.get("created_at").is_some() { n(v, "created_at") } else { db::now() }, opened, os(v, "media_url")
                            ],
                        )?;
                        created.push(Created { key: ch.key.clone(), id: tx.last_insert_rowid() });
                    }
                }
            }
            ("lesson", None) => {
                if let Some(id) = local_id(&ch.key) {
                    tx.execute("DELETE FROM lessons WHERE id=?1", [id])?;
                }
            }
            ("term", Some(v)) => {
                let (lang, term) = ch.key.split_once('|').ok_or_else(|| anyhow!("invalid word key"))?;
                let at = n(v, "updated_at");
                tx.execute(
                    "INSERT INTO terms(lang,term,status,translation,note,lemma,context,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
                     ON CONFLICT(lang,term) DO UPDATE SET status=excluded.status,translation=excluded.translation,note=excluded.note,
                       lemma=excluded.lemma,context=excluded.context,updated_at=excluded.updated_at",
                    params![lang, term, n(v, "status"), s(v, "translation"), s(v, "note"), s(v, "lemma"), s(v, "context"), at],
                )?;
            }
            ("term", None) => {
                if let Some((lang, term)) = ch.key.split_once('|') {
                    tx.execute("DELETE FROM terms WHERE lang=?1 AND term=?2", params![lang, term])?;
                }
            }
            ("activity", Some(v)) => {
                let (day, lang) = ch.key.split_once('|').ok_or_else(|| anyhow!("invalid day key"))?;
                tx.execute(
                    "INSERT INTO activity(day,lang,words_read,known_added,lingqs,listen_secs,learn_secs,goal_met) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                     ON CONFLICT(day,lang) DO UPDATE SET words_read=excluded.words_read,known_added=excluded.known_added,lingqs=excluded.lingqs,
                       listen_secs=excluded.listen_secs,learn_secs=excluded.learn_secs,goal_met=excluded.goal_met",
                    params![day, lang, n(v, "words_read"), n(v, "known_added"), n(v, "lingqs"), n(v, "listen_secs"), n(v, "learn_secs"), b(v, "goal_met") as i64],
                )?;
            }
            ("activity", None) => {
                if let Some((day, lang)) = ch.key.split_once('|') {
                    tx.execute("DELETE FROM activity WHERE day=?1 AND lang=?2", params![day, lang])?;
                }
            }
            ("playlist", Some(v)) => {
                let current = v.get("current").and_then(Value::as_i64);
                let id = match local_id(&ch.key) {
                    Some(id) => {
                        tx.execute("UPDATE playlists SET lang=?2,name=?3,current_id=?4 WHERE id=?1", params![id, s(v, "lang"), s(v, "name"), current])?;
                        id
                    }
                    None => {
                        tx.execute(
                            "INSERT INTO playlists(lang,name,current_id,created_at) VALUES(?1,?2,?3,?4)",
                            params![s(v, "lang"), s(v, "name"), current, n(v, "created_at")],
                        )?;
                        let id = tx.last_insert_rowid();
                        created.push(Created { key: ch.key.clone(), id });
                        id
                    }
                };
                tx.execute("DELETE FROM playlist_items WHERE playlist_id=?1", [id])?;
                let lessons = v.get("lessons").and_then(Value::as_array).cloned().unwrap_or_default();
                for (pos, l) in lessons.iter().filter_map(Value::as_i64).enumerate() {
                    // a lesson this computer doesn't have (yet) is skipped
                    tx.execute(
                        "INSERT OR IGNORE INTO playlist_items(playlist_id,lesson_id,position) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM lessons WHERE id=?2)",
                        params![id, l, pos as i64],
                    )?;
                }
            }
            ("playlist", None) => {
                if let Some(id) = local_id(&ch.key) {
                    tx.execute("DELETE FROM playlists WHERE id=?1", [id])?;
                }
            }
            ("chat", Some(v)) => {
                let lesson = v.get("lesson_id").and_then(Value::as_i64);
                let lesson = match lesson {
                    Some(l) if tx.query_row("SELECT 1 FROM lessons WHERE id=?1", [l], |_| Ok(())).optional()?.is_some() => Some(l),
                    _ => None,
                };
                let id = match local_id(&ch.key) {
                    Some(id) => {
                        tx.execute(
                            "UPDATE chats SET lang=?2,title=?3,lesson_id=?4,updated_at=?5 WHERE id=?1",
                            params![id, s(v, "lang"), s(v, "title"), lesson, n(v, "updated_at")],
                        )?;
                        id
                    }
                    None => {
                        tx.execute(
                            "INSERT INTO chats(lang,title,lesson_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5)",
                            params![s(v, "lang"), s(v, "title"), lesson, n(v, "created_at"), n(v, "updated_at")],
                        )?;
                        let id = tx.last_insert_rowid();
                        created.push(Created { key: ch.key.clone(), id });
                        id
                    }
                };
                tx.execute("DELETE FROM chat_messages WHERE chat_id=?1", [id])?;
                for m in v.get("messages").and_then(Value::as_array).cloned().unwrap_or_default() {
                    // the message keeps its id from the other device, so both write the same record
                    tx.execute(
                        "INSERT OR REPLACE INTO chat_messages(id,chat_id,role,content,thought,thought_secs,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                        params![m.get("id").and_then(Value::as_i64), id, s(&m, "role"), s(&m, "content"), s(&m, "thought"), f(&m, "thought_secs"), n(&m, "created_at")],
                    )?;
                }
            }
            ("chat", None) => {
                if let Some(id) = local_id(&ch.key) {
                    tx.execute("DELETE FROM chats WHERE id=?1", [id])?;
                }
            }
            (other, _) => return Err(anyhow!("unknown record kind {other}")),
        }
    }
    tx.commit()?;
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let dir = std::env::temp_dir().join(format!("wikang-sync-{}-{}", std::process::id(), db::now()));
        std::fs::create_dir_all(&dir).unwrap();
        db::open(&dir.join("learning.db")).unwrap()
    }

    #[test]
    fn a_lesson_from_the_account_round_trips_and_keeps_local_media() {
        let mut c = conn();
        let change = |key: &str, data: Value| Change { kind: "lesson".into(), key: key.into(), data: Some(data) };
        let lesson = json!({"lang":"tl","title":"Aralin","collection":"","kind":"video","source":"https://www.youtube.com/watch?v=abcdefghijk",
            "text":"May bahay.","media_path":null,"timings":"[[0,3,0,1]]","video_path":null,"hue":40,"word_count":2,"page":0,"completed":false,
            "position":0,"anchor":0,"duration":12.5,"cover_path":null,"timing_v":2,"created_at":1760000000,"media_url":"https://www.youtube.com/watch?v=abcdefghijk"});
        let made = apply(&mut c, &[change("new:1", lesson.clone())]).unwrap();
        assert_eq!(made.len(), 1);
        let id = made[0].id;
        // this computer downloaded the video: the account's copy without it must not remove it
        c.execute("UPDATE lessons SET media_path='C:/media/a.m4a', video_path='C:/media/a.mp4' WHERE id=?1", [id]).unwrap();
        let mut newer = lesson.clone();
        newer["title"] = json!("Bagong pamagat");
        apply(&mut c, &[change(&id.to_string(), newer)]).unwrap();
        let out = export(&c).unwrap();
        let l = &out["lessons"][0];
        assert_eq!(l["title"], "Bagong pamagat");
        assert_eq!(l["media_path"], "C:/media/a.m4a");
        assert_eq!(l["media_url"], "https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(l["timings"], "[[0,3,0,1]]");
    }

    #[test]
    fn words_days_playlists_and_chats_apply_and_export() {
        let mut c = conn();
        let ch = |kind: &str, key: &str, data: Value| Change { kind: kind.into(), key: key.into(), data: Some(data) };
        let made = apply(&mut c, &[ch("lesson", "new:9", json!({"lang":"tl","title":"Una","text":"Isa dalawa.","kind":"text"}))]).unwrap();
        let l = made[0].id;
        apply(
            &mut c,
            &[
                ch("term", "tl|bahay", json!({"term":"bahay","status":4,"translation":"house","note":"","lemma":"","context":"","updated_at":1760000000.4})),
                ch("activity", "2026-10-14|tl", json!({"day":"2026-10-14","lang":"tl","words_read":120,"known_added":3,"lingqs":0,"listen_secs":60,"learn_secs":300,"goal_met":true})),
                ch("playlist", "new:5", json!({"lang":"tl","name":"Practice","lessons":[l, 999],"current":l,"created_at":1})),
                ch("chat", "new:7", json!({"lang":"tl","title":"Tanong","lesson_id":l,"created_at":1,"updated_at":2,
                    "messages":[{"id":1760000000001i64,"role":"user","content":"Kumusta?","thought":"","thought_secs":0,"created_at":1}]})),
                ch("setting", "daily_goal", json!("20")),
            ],
        )
        .unwrap();
        let out = export(&c).unwrap();
        assert_eq!(out["terms"]["tl|bahay"]["status"], 4);
        assert_eq!(out["activity"]["2026-10-14|tl"]["words_read"], 120);
        assert_eq!(out["activity"]["2026-10-14|tl"]["goal_met"], true);
        assert_eq!(out["playlists"][0]["lessons"], json!([l]), "a lesson this computer lacks is left out");
        assert_eq!(out["chats"][0]["messages"][0]["id"], 1760000000001i64);
        assert_eq!(out["settings"]["daily_goal"], "20");
        apply(&mut c, &[Change { kind: "term".into(), key: "tl|bahay".into(), data: None }]).unwrap();
        assert!(export(&c).unwrap()["terms"].get("tl|bahay").is_none());
    }
}
