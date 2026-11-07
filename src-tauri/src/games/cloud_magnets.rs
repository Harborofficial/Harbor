//! Explicit magnet-to-cloud submission for game downloads. No remote job is
//! created until the user selects a connected provider and confirms.
use super::*;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetRequest {
    pub provider: String,
    pub key: String,
    pub url: String,
    #[serde(default)]
    pub parent: String,
    #[serde(default)]
    pub file: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagnetJob {
    pub id: String,
    pub status: String,
    pub files: Vec<CloudEntry>,
}

pub(super) fn checked_magnet(value: &str) -> Result<&str> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("cloud_link");
    }
    let parsed = reqwest::Url::parse(value).map_err(|_| "cloud_link")?;
    if parsed.scheme() != "magnet" {
        return Err("cloud_link");
    }
    let valid = parsed.query_pairs().any(|(name, hash)| {
        name == "xt" && hash.starts_with("urn:btih:") && {
            let hash = &hash[9..];
            (hash.len() == 40 && hash.bytes().all(|c| c.is_ascii_hexdigit()))
                || (hash.len() == 32 && hash.bytes().all(|c| c.is_ascii_alphanumeric()))
        }
    });
    if !valid {
        return Err("cloud_link");
    }
    Ok(value)
}
fn api(request: &MagnetRequest) -> Result<Api> {
    Api::new(&Request {
        provider: request.provider.clone(),
        key: request.key.clone(),
        parent: String::new(),
        page: 0,
        file: String::new(),
    })
}
fn checked_job(value: &str) -> Result<&str> {
    if !identifier(value) {
        return Err("cloud_request");
    }
    Ok(value)
}

impl Api {
    async fn magnet_create(&self, magnet: &str) -> Result<String> {
        let magnet = checked_magnet(magnet)?.to_string();
        match self.provider.as_str() {
            "rd" => {
                let data = self
                    .request("/torrents/addMagnet", &[], Some(&[("magnet", magnet)]))
                    .await?;
                // Return the remote job immediately. Metadata can still be
                // converting, so selectFiles is performed after RD advertises
                // waiting_files_selection. A failed selection can then be
                // retried without resubmitting the magnet.
                record_id(&data["id"])
            }
            "tb" => {
                let form = reqwest::multipart::Form::new().text("magnet", magnet);
                let response = self
                    .client
                    .post(format!("{}/torrents/createtorrent", self.base))
                    .bearer_auth(&self.key)
                    .multipart(form)
                    .send()
                    .await
                    .map_err(|_| "cloud_network")?;
                let status = response.status().as_u16();
                if matches!(status, 401 | 403) {
                    return Err("cloud_key");
                }
                if status == 429 {
                    return Err("cloud_rate_limit");
                }
                if !(200..300).contains(&status) {
                    return Err("cloud_service");
                }
                let data: Value = response.json().await.map_err(|_| "cloud_metadata")?;
                if data["success"].as_bool() != Some(true) {
                    return Err("cloud_service");
                }
                record_id(&data["data"]["torrent_id"])
            }
            "pm" => self.pm_create(&magnet).await,
            "ad" => {
                let value = self
                    .request("/v4/magnet/upload", &[], Some(&[("magnets[]", magnet)]))
                    .await?;
                let item = value["magnets"]
                    .as_array()
                    .and_then(|v| v.first())
                    .ok_or("cloud_metadata")?;
                if item.get("error").is_some() {
                    return Err("cloud_service");
                }
                record_id(&item["id"])
            }
            _ => Err("cloud_provider"),
        }
    }
    async fn rd_select_magnet_files(&self, id: &str) -> Result<()> {
        let response = self
            .client
            .post(format!("{}/torrents/selectFiles/{id}", self.base))
            .bearer_auth(&self.key)
            .form(&[("files", "all")])
            .send()
            .await
            .map_err(|_| "cloud_network")?;
        match response.status().as_u16() {
            200..=299 => Ok(()),
            401 | 403 => Err("cloud_key"),
            429 => Err("cloud_rate_limit"),
            _ => Err("cloud_service"),
        }
    }
    async fn magnet_status(&self, id: &str) -> Result<MagnetJob> {
        let id = checked_job(id)?;
        let (status, files) = match self.provider.as_str() {
            "rd" => {
                let data = self
                    .request(&format!("/torrents/info/{id}"), &[], None)
                    .await?;
                if data["status"].as_str() == Some("downloaded") {
                    let page = rd_files(data)?;
                    ("ready".into(), page.entries)
                } else if data["status"].as_str() == Some("waiting_files_selection") {
                    self.rd_select_magnet_files(id).await?;
                    ("preparing".into(), vec![])
                } else if matches!(
                    data["status"].as_str(),
                    Some("error" | "dead" | "virus" | "magnet_error")
                ) {
                    ("failed".into(), vec![])
                } else {
                    ("preparing".into(), vec![])
                }
            }
            "tb" => {
                let value = self
                    .request("/torrents/mylist", &[("id", id.to_string())], None)
                    .await?;
                let data = if value["data"].is_array() {
                    value["data"]
                        .as_array()
                        .and_then(|a| a.first())
                        .ok_or("cloud_missing")?
                } else {
                    &value["data"]
                };
                let page = tb_files(data)?;
                let status = if page.entries.iter().any(|e| e.ready) {
                    "ready"
                } else if matches!(data["download_state"].as_str(), Some("error" | "failed")) {
                    "failed"
                } else {
                    "preparing"
                };
                (
                    status.into(),
                    if status == "ready" {
                        page.entries
                    } else {
                        vec![]
                    },
                )
            }
            "pm" => {
                let job = self.pm_status(id).await?;
                (job.job.status, job.job.files)
            }
            "ad" => {
                let data = self
                    .request("/v4.1/magnet/status", &[], Some(&[("id", id.to_string())]))
                    .await?;
                let item = data["magnets"]
                    .as_array()
                    .and_then(|a| {
                        a.iter()
                            .find(|v| record_id(&v["id"]).ok().as_deref() == Some(id))
                    })
                    .ok_or("cloud_missing")?;
                match item["statusCode"].as_u64() {
                    Some(4) => {
                        let files = self.ad_magnet_files(id).await?;
                        (
                            "ready".into(),
                            files
                                .into_iter()
                                .enumerate()
                                .map(|(i, (name, _, bytes))| CloudEntry {
                                    id: format!("index:{i}"),
                                    name,
                                    kind: "file".into(),
                                    bytes,
                                    ready: true,
                                    status: "ready".into(),
                                })
                                .collect(),
                        )
                    }
                    Some(0..=3) => ("preparing".into(), vec![]),
                    Some(_) => ("failed".into(), vec![]),
                    None => return Err("cloud_metadata"),
                }
            }
            _ => return Err("cloud_provider"),
        };
        Ok(MagnetJob {
            id: id.into(),
            status,
            files,
        })
    }
    async fn ad_magnet_files(&self, id: &str) -> Result<Vec<(String, String, Option<u64>)>> {
        let data = self
            .request("/v4/magnet/files", &[], Some(&[("id[]", id.into())]))
            .await?;
        let item = data["magnets"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .find(|v| record_id(&v["id"]).ok().as_deref() == Some(id))
            })
            .ok_or("cloud_missing")?;
        if item.get("error").is_some() {
            return Err("cloud_missing");
        }
        fn flatten(
            nodes: &[Value],
            output: &mut Vec<(String, String, Option<u64>)>,
            depth: usize,
        ) -> Result<()> {
            if depth > 8 || output.len() > 2000 {
                return Err("cloud_limit");
            }
            for node in nodes {
                if let Some(children) = node.get("e") {
                    flatten(
                        children.as_array().ok_or("cloud_metadata")?,
                        output,
                        depth + 1,
                    )?;
                } else {
                    let name = clean_name(&text(node, "n", 500))?;
                    let link = links::source_link(node["l"].as_str().ok_or("cloud_metadata")?)?;
                    output.push((name, link, size(&node["s"])));
                }
                if output.len() > 2000 {
                    return Err("cloud_limit");
                }
            }
            Ok(())
        }
        let mut result = vec![];
        flatten(
            item["files"].as_array().ok_or("cloud_metadata")?,
            &mut result,
            0,
        )?;
        Ok(result)
    }
    async fn magnet_download(&self, id: &str, file: &str) -> Result<CloudDownload> {
        let id = checked_job(id)?;
        let file = checked_job(file)?;
        match self.provider.as_str() {
            "rd" | "tb" => self.resolve(id, file).await,
            "pm" => self.pm_download(id, file).await,
            "ad" => {
                if self.magnet_status(id).await?.status != "ready" {
                    return Err("cloud_not_ready");
                }
                let index = file
                    .strip_prefix("index:")
                    .and_then(|s| s.parse::<usize>().ok())
                    .ok_or("cloud_request")?;
                let files = self.ad_magnet_files(id).await?;
                let (name, link, expected_bytes) = files.get(index).ok_or("cloud_missing")?.clone();
                let prepared = self.ad_prepare(&link, "").await?;
                if prepared.delayed_id.is_some() {
                    return Err("cloud_not_ready");
                }
                Ok(CloudDownload {
                    url: prepared.url.ok_or("cloud_not_ready")?,
                    name,
                    expected_bytes,
                })
            }
            _ => Err("cloud_provider"),
        }
    }
}

pub async fn create(request: MagnetRequest) -> Result<String> {
    api(&request)?.magnet_create(&request.url).await
}
pub async fn status(request: MagnetRequest) -> Result<MagnetJob> {
    api(&request)?.magnet_status(&request.parent).await
}
pub async fn download(request: MagnetRequest) -> Result<CloudDownload> {
    api(&request)?
        .magnet_download(&request.parent, &request.file)
        .await
}

#[cfg(test)]
#[path = "cloud_magnets_tests.rs"]
mod tests;
