//! Prepare browser-compatible media and stream it directly to Supabase Storage.
//! Only an authenticated admin may upload, and local files come from a lesson in this app's database.
use std::path::{Path, PathBuf};
use tauri::{State, ipc::Channel};
use serde_json::{json, Value};
use tokio_util::io::ReaderStream;
use crate::{db, state::AppState, media::ImportEvent, text};

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "mp4" => "video/mp4", "m4a" => "audio/mp4", "jpg" | "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", _ => "application/octet-stream",
    }
}
fn ensure_local(path: &str, data_dir: &Path) -> Result<PathBuf, String> {
    let file=std::fs::canonicalize(path).map_err(|_| "Lesson media is missing. Reimport it before publishing.".to_owned())?;
    let root=std::fs::canonicalize(data_dir).map_err(|e|e.to_string())?;
    if !file.starts_with(root) {return Err("Only media stored in this app can be published.".into());}
    Ok(file)
}
async fn encode(input: &Path, output: &Path, video: bool) -> Result<(), String> {
    let executable=["/opt/homebrew/bin/ffmpeg","/usr/local/bin/ffmpeg"].into_iter().find(|p|Path::new(p).is_file()).unwrap_or("ffmpeg");
    let mut cmd=crate::proc::tokio_command(executable);
    cmd.args(["-hide_banner","-loglevel","error","-nostdin","-y","-i"]).arg(input);
    if video {cmd.args(["-an","-c:v","libx264","-preset","fast","-crf","23","-pix_fmt","yuv420p","-movflags","+faststart"]);}
    else {cmd.args(["-vn","-c:a","aac","-b:a","128k","-movflags","+faststart"]);}
    let result=cmd.arg(output).output().await.map_err(|_|"Install FFmpeg to prepare web media (brew install ffmpeg on Mac).".to_owned())?;
    if !result.status.success() {return Err("Could not prepare browser-compatible media. Check that the lesson plays locally.".into());}
    Ok(())
}
async fn upload(client:&reqwest::Client, base:&str, key:&str, token:&str, path:&Path, object:&str) -> Result<(),String> {
    let file=tokio::fs::File::open(path).await.map_err(|e|e.to_string())?;
    let length=file.metadata().await.map_err(|e|e.to_string())?.len();
    let body=reqwest::Body::wrap_stream(ReaderStream::new(file));
    let response=client.post(format!("{base}/storage/v1/object/lesson-media/{object}"))
        .header("apikey",key).bearer_auth(token).header("Content-Type",mime(path)).header("Content-Length",length).body(body).send().await.map_err(|_|"Upload failed. Check your connection and retry.".to_owned())?;
    if !response.status().is_success() {return Err(format!("Media upload rejected ({}). Check the admin role and storage migration.",response.status()));}
    Ok(())
}
#[tauri::command]
pub async fn publish_prepare(state:State<'_,AppState>, lesson_id:i64, draft_id:String, supabase_url:String, publishable_key:String, access_token:String, on_event:Channel<ImportEvent>) -> Result<Value,String> {
    let parsed=reqwest::Url::parse(&supabase_url).map_err(|_|"Invalid Supabase URL.".to_owned())?;
    if parsed.scheme()!="https" || parsed.host_str().is_none() || parsed.path()!="/" || parsed.query().is_some() || !parsed.username().is_empty() {
        return Err("Use the HTTPS Supabase project URL without a path.".into());
    }
    if draft_id.len()!=36 || !draft_id.chars().all(|c|c.is_ascii_hexdigit()||c=='-') {return Err("Invalid publication identifier.".into());}
    let base=supabase_url.trim_end_matches('/');
    let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
    let response=client.get(format!("{base}/rest/v1/published_lessons?id=eq.{draft_id}&status=eq.draft&select=id"))
        .header("apikey",&publishable_key).bearer_auth(&access_token).send().await.map_err(|_|"Cannot verify your publishing permissions.".to_owned())?;
    let rows:Vec<Value>=serde_json::from_str(&response.text().await.map_err(|e|e.to_string())?).map_err(|_|"Cannot verify the draft.".to_owned())?;
    if rows.is_empty() {return Err("Draft unavailable. Sign in as an admin and retry.".into());}
    let lesson={let c=state.db.lock();db::lesson_get(&c,lesson_id).map_err(|e|e.to_string())?};
    if lesson.lang!="tl" || lesson.text.trim().is_empty() {return Err("Only completed Tagalog lessons can be published.".into());}
    let staging=state.data_dir.join("publishing").join(&draft_id);tokio::fs::create_dir_all(&staging).await.map_err(|e|e.to_string())?;
    let result=async {
        let _=on_event.send(ImportEvent::Stage{stage:"encoding".into()});
        let mut media_path=None;let mut video_path=None;let mut cover_path=None;
        if let Some(path)=lesson.media_path.as_ref().or(lesson.video_path.as_ref()) {
            let input=ensure_local(path,&state.data_dir)?;let audio=staging.join("audio.m4a");encode(&input,&audio,false).await?;
            let _=on_event.send(ImportEvent::Stage{stage:"uploading".into()});
            let object=format!("{draft_id}/audio.m4a");upload(&client,base,&publishable_key,&access_token,&audio,&object).await?;media_path=Some(object);
            let _=on_event.send(ImportEvent::Progress{value:40.0});
        }
        if let Some(path)=&lesson.video_path {
            let input=ensure_local(path,&state.data_dir)?;let video=staging.join("video.mp4");encode(&input,&video,true).await?;
            let object=format!("{draft_id}/video.mp4");upload(&client,base,&publishable_key,&access_token,&video,&object).await?;video_path=Some(object);
            let _=on_event.send(ImportEvent::Progress{value:85.0});
        }
        if let Some(path)=&lesson.cover_path {
            let input=ensure_local(path,&state.data_dir)?;let ext=input.extension().and_then(|x|x.to_str()).unwrap_or("jpg");
            if !["jpg","jpeg","png","webp"].contains(&ext) {return Err("Use a JPEG, PNG, or WebP cover for publishing.".into());}
            let object=format!("{draft_id}/cover.{ext}");upload(&client,base,&publishable_key,&access_token,&input,&object).await?;cover_path=Some(object);
        }
        let timings=lesson.timings.as_deref().map(serde_json::from_str::<Value>).transpose().map_err(|_|"Invalid word timings.".to_owned())?;
        let tokens=text::tokenize(&lesson.text,"tl");
        if media_path.is_some() && timings.is_none() {return Err("Transcribe this lesson before publishing it.".into());}
        let _=on_event.send(ImportEvent::Progress{value:100.0});
        Ok(json!({"text":lesson.text,"tokens":tokens,"timings":timings,"duration":lesson.duration,"timing_v":lesson.timing_v,
            "media_path":media_path,"video_path":video_path,"cover_path":cover_path,"kind":if lesson.video_path.is_some(){"video"}else if lesson.media_path.is_some(){"audio"}else{"text"}}))
    }.await;
    let _=tokio::fs::remove_dir_all(&staging).await;
    result
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn mime_types_are_browser_compatible() {assert_eq!(mime(Path::new("video.mp4")),"video/mp4");assert_eq!(mime(Path::new("audio.m4a")),"audio/mp4");}
    #[test] fn publishing_does_not_accept_files_outside_app() {let path=std::env::current_exe().unwrap();assert!(ensure_local(path.to_str().unwrap(),Path::new("/path/that/does/not/exist")).is_err());}
}
