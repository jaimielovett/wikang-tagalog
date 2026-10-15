//! The companion's outbox: lessons made on this computer wait here until they reach the learner's
//! account (src/lib/companion.ts sends them in the web's lesson shape, then deletes them here).

use anyhow::Result;
use rusqlite::Connection;
use serde_json::{json, Value};

/// The lessons on this computer, in the web's shape (`media_url`: where the web can play them from).
pub fn lessons(c: &Connection) -> Result<Vec<Value>> {
    let mut st = c.prepare(
        "SELECT id,lang,title,collection,kind,source,text,media_path,timings,video_path,hue,word_count,
                duration,timing_v,created_at,remote_media
         FROM lessons ORDER BY id",
    )?;
    let rows = st.query_map([], |r| {
        Ok(json!({
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
            "duration": r.get::<_, f64>(12)?,
            "timing_v": r.get::<_, i64>(13)?,
            "created_at": r.get::<_, i64>(14)?,
            "media_url": r.get::<_, Option<String>>(15)?,
        }))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lesson_from_youtube_leaves_with_its_address() {
        let dir = std::env::temp_dir().join(format!("wt-outbox-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = crate::db::open(&dir.join("learning.db")).unwrap();
        c.execute(
            "INSERT INTO lessons(lang,title,collection,kind,source,text,media_path,timings,hue,word_count,created_at)
             VALUES('tl','Adobo','','video','https://www.youtube.com/watch?v=abcdefghijk','Magandang araw.','C:/m/1.m4a','[[0,8,0,1]]',1,2,1)",
            [],
        )
        .unwrap();
        c.execute("UPDATE lessons SET remote_media='https://www.youtube.com/watch?v=abcdefghijk'", []).unwrap();
        let out = lessons(&c).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["media_url"], "https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(out[0]["media_path"], "C:/m/1.m4a");
        assert_eq!(out[0]["timings"], "[[0,8,0,1]]");
        drop(c);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
