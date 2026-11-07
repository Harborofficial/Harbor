use super::super::tests::fixture;
use super::*;
use serde_json::json;

fn example() -> &'static str {
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example"
}

#[test]
fn validates_magnet_identity_and_rejects_other_schemes() {
    assert_eq!(checked_magnet(example()).unwrap(), example());
    assert!(checked_magnet("https://host.test/file").is_err());
    assert!(checked_magnet("magnet:?dn=no-hash").is_err());
    assert!(checked_magnet("magnet:?xt=urn:btih:1234").is_err());
    assert!(checked_magnet("magnet:?xt=urn:btih:1234567\n").is_err());
    assert!(checked_magnet(&format!("magnet:?xt=urn:btih:{}", "a".repeat(9000))).is_err());
}
#[tokio::test]
async fn real_debrid_selects_files_after_metadata_is_ready_without_duplicate_submission() {
    let (api, requests, worker) = fixture(
        "rd",
        vec![
            (201, json!({"id":"abc123"})),
            (
                200,
                json!({"status":"waiting_files_selection","files":[{"id":1,"path":"game.zip","bytes":100}]}),
            ),
            (204, json!({})),
            (
                200,
                json!({"status":"downloaded","filename":"Game","files":[{"path":"game.zip","bytes":100,"selected":1}],"links":["https://rd.test/file"]}),
            ),
        ],
    );
    assert_eq!(api.magnet_create(example()).await.unwrap(), "abc123");
    let first = api.magnet_status("abc123").await.unwrap();
    assert_eq!(first.status, "preparing");
    let second = api.magnet_status("abc123").await.unwrap();
    assert_eq!(second.status, "ready");
    assert_eq!(second.files.len(), 1);
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("POST /torrents/addMagnet "));
    assert!(calls[0].contains("magnet="));
    assert!(calls[1].starts_with("GET /torrents/info/abc123 "));
    assert!(calls[2].starts_with("POST /torrents/selectFiles/abc123 "));
    assert!(calls[2].contains("files=all"));
    assert!(calls[3].starts_with("GET /torrents/info/abc123 "));
}
#[tokio::test]
async fn torbox_submission_uses_authenticated_multipart_upload() {
    let (api, requests, worker) = fixture(
        "tb",
        vec![(
            200,
            json!({"success":true,"data":{"torrent_id":42,"hash":"sample"}}),
        )],
    );
    assert_eq!(api.magnet_create(example()).await.unwrap(), "42");
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("POST /torrents/createtorrent "));
    assert!(calls[0].contains("multipart/form-data"));
    assert!(calls[0].contains("name=\"magnet\""));
    assert!(calls[0]
        .to_ascii_lowercase()
        .contains("authorization: bearer fixture-secret"));
}
#[tokio::test]
async fn premiumize_submits_magnet_as_cloud_transfer() {
    let (api, requests, worker) = fixture(
        "pm",
        vec![(
            200,
            json!({"status":"success","id":"pm42","name":"Example"}),
        )],
    );
    assert_eq!(api.magnet_create(example()).await.unwrap(), "pm42");
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("POST /transfer/create "));
    assert!(calls[0].contains("src=magnet%3A"));
}
#[tokio::test]
async fn alldebrid_uploads_magnet_and_preserves_remote_job() {
    let (api, requests, worker) = fixture(
        "ad",
        vec![(
            200,
            json!({"status":"success","data":{"magnets":[{"id":981,"ready":false}]}}),
        )],
    );
    assert_eq!(api.magnet_create(example()).await.unwrap(), "981");
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("POST /v4/magnet/upload "));
    assert!(calls[0].contains("magnets%5B%5D=magnet"));
}

#[tokio::test]
async fn torbox_ready_job_exposes_downloadable_game_files() {
    let (api, requests, worker) = fixture(
        "tb",
        vec![(
            200,
            json!({"success":true,"data":{"id":42,"name":"Example","download_present":true,"files":[{"id":7,"name":"game.zip","size":900}]}}),
        )],
    );
    let job = api.magnet_status("42").await.unwrap();
    assert_eq!(job.status, "ready");
    assert_eq!(job.files.len(), 1);
    assert_eq!(job.files[0].id, "7");
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("GET /torrents/mylist?id=42 "));
}

#[tokio::test]
async fn alldebrid_ready_job_flattens_nested_files_without_exposing_credentials() {
    let (api, requests, worker) = fixture(
        "ad",
        vec![
            (
                200,
                json!({"status":"success","data":{"magnets":[{"id":981,"statusCode":4}]}}),
            ),
            (
                200,
                json!({"status":"success","data":{"magnets":[{
                    "id":981,
                    "files":[{"n":"subfolder","e":[{"n":"game.zip","s":1000,"l":"https://alldebrid.com/f/example"}]}]
                }]}}),
            ),
        ],
    );
    let job = api.magnet_status("981").await.unwrap();
    assert_eq!(job.status, "ready");
    assert_eq!(job.files.len(), 1);
    assert_eq!(job.files[0].name, "game.zip");
    assert_eq!(job.files[0].id, "index:0");
    worker.join().unwrap();
    let calls = requests.lock().unwrap();
    assert!(calls[0].starts_with("POST /v4.1/magnet/status "));
    assert!(calls[1].starts_with("POST /v4/magnet/files "));
    assert!(!job.files[0].name.contains("fixture-secret"));
}
