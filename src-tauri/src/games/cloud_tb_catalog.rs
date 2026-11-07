//! Read-only TorBox recovery catalog. A full-account bounded scan is needed
//! before treating a filename + exact byte count as a unique remote identity.
//! Requesting each individual torrent's details would be too slow and risk
//! provider rate limits on accounts with hundreds of torrents.
use super::*;

const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 30;
const MAX_FILES: usize = 30000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TbRemoteFile {
    pub kind: String,
    pub parent: String,
    pub file: String,
    pub name: String,
    pub bytes: u64,
}
fn accumulate(data: &Value, kind: &str, entries: &mut Vec<TbRemoteFile>) -> Result<usize> {
    let list = array(data)?;
    for item in list {
        let present = item["download_present"].as_bool() == Some(true);
        let ready = if kind == "torrent" {
            tb_ready(item)
        } else {
            present && item["error"].as_str().is_none_or(str::is_empty)
        };
        if !ready {
            continue;
        }
        let parent = record_id(&item["id"])?;
        if parent.parse::<u64>().is_err() {
            return Err("cloud_metadata");
        }
        if let Some(files) = item["files"].as_array() {
            for file in files {
                let Some(bytes) = size(&file["size"]) else {
                    continue;
                };
                let id = record_id(&file["id"])?;
                if id.parse::<u64>().is_err() {
                    return Err("cloud_metadata");
                }
                let name = clean_name(&text(file, "name", 1000))?;
                entries.push(TbRemoteFile {
                    kind: kind.into(),
                    parent: parent.clone(),
                    file: id,
                    name,
                    bytes,
                });
                if entries.len() > MAX_FILES {
                    return Err("cloud_limit");
                }
            }
        }
    }
    Ok(list.len())
}
impl Api {
    async fn tb_recovery_catalog(&self) -> Result<Vec<TbRemoteFile>> {
        let mut result = Vec::new();
        for (path, kind) in [("/torrents/mylist", "torrent"), ("/webdl/mylist", "web")] {
            let mut ended = false;
            for page in 0..MAX_PAGES {
                let body = self
                    .request(
                        path,
                        &[
                            ("limit", PAGE_SIZE.to_string()),
                            ("offset", (page * PAGE_SIZE).to_string()),
                        ],
                        None,
                    )
                    .await?;
                let count = accumulate(&body["data"], kind, &mut result)?;
                if count < PAGE_SIZE {
                    ended = true;
                    break;
                }
            }
            // Do not return a partial catalog. Its apparent uniqueness could
            // pair a local file with the wrong TorBox account entry.
            if !ended {
                return Err("cloud_limit");
            }
        }
        Ok(result)
    }
}
pub async fn catalog(request: Request) -> Result<Vec<TbRemoteFile>> {
    if request.provider != "tb" {
        return Err("cloud_provider");
    }
    Api::new(&request)?.tb_recovery_catalog().await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn torrent_and_web_catalog_preserves_provider_type_and_exact_file_size() {
        let mut found = Vec::new();
        let torrent = serde_json::json!([
          {"id":42,"download_present":true,"files":[{"id":7,"name":"Repack/fg-01.bin","size":1234}]},
          {"id":43,"download_present":false,"files":[{"id":8,"name":"unused.bin","size":1234}]},
        ]);
        assert_eq!(accumulate(&torrent, "torrent", &mut found).unwrap(), 2);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "torrent");
        assert_eq!(found[0].name, "fg-01.bin");
        assert_eq!(found[0].bytes, 1234);
        let web = serde_json::json!([{"id":88,"download_present":true,"files":[{"id":3,"name":"fg-02.bin","size":5678}]}]);
        accumulate(&web, "web", &mut found).unwrap();
        assert_eq!(found[1].kind, "web");
        assert_eq!(found[1].parent, "88");
    }
    #[test]
    fn empty_remote_file_or_zero_bytes_are_not_recovery_candidates() {
        let mut found = Vec::new();
        let items = serde_json::json!([{"id":1,"download_present":true,
            "files":[{"id":1,"name":"x.bin","size":0}]}]);
        accumulate(&items, "torrent", &mut found).unwrap();
        assert!(found.is_empty());
    }
}
