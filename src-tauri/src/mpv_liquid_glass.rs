use std::path::{Path, PathBuf};

use libmpv2::{mpv_node::MpvNode, Mpv};
use serde::Deserialize;

const SHADER: &str = include_str!("liquid-glass.hook");
const PREFIX: &str = "harbor_glass_";
const MAX_REGIONS: usize = 6;

#[derive(Clone, Debug, Deserialize)]
pub struct GlassRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
    #[serde(default)]
    radii: Option<[f64; 4]>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(default)]
pub struct GlassOptics {
    zoom: f64,
    refraction: f64,
    dispersion: f64,
    blur: f64,
}

impl Default for GlassOptics {
    fn default() -> Self {
        Self {
            zoom: 1.08,
            refraction: 1.0,
            dispersion: 1.0,
            blur: 1.0,
        }
    }
}

impl GlassOptics {
    fn normalized(self) -> Self {
        fn bound(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
            if value.is_finite() {
                value.clamp(min, max)
            } else {
                fallback
            }
        }
        Self {
            zoom: bound(self.zoom, 1.0, 1.1, 1.08),
            refraction: bound(self.refraction, 0.0, 1.2, 1.0),
            dispersion: bound(self.dispersion, 0.0, 1.2, 1.0),
            blur: bound(self.blur, 0.0, 1.2, 1.0),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassLayout {
    regions: Vec<GlassRegion>,
    viewport_width: f64,
    viewport_height: f64,
    #[serde(default)]
    optics: GlassOptics,
}

#[derive(Default)]
pub(crate) struct GlassState {
    owner: String,
    owner_generation: u64,
    directory: Option<PathBuf>,
    active_path: Option<PathBuf>,
    slot: usize,
    signature: String,
}

fn shader_paths(mpv: &Mpv) -> Result<Vec<String>, String> {
    match mpv
        .get_property::<MpvNode>("glsl-shaders")
        .map_err(|e| e.to_string())?
    {
        MpvNode::ArrayIter(items) => items
            .map(|item| match item {
                MpvNode::String(path) => Ok(path),
                _ => Err("Invalid mpv shader list".into()),
            })
            .collect(),
        _ => Err("Invalid mpv shader list".into()),
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
fn path_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

impl GlassState {
    pub(crate) fn preserve_shader(&self, value: &str) -> String {
        let Some(path) = &self.active_path else {
            return value.to_string();
        };
        let path = path_string(path);
        let mut paths: Vec<&str> = value
            .split(path_separator())
            .filter(|p| !p.is_empty())
            .collect();
        if !paths.iter().any(|p| p.replace('\\', "/") == path) {
            paths.push(&path);
        }
        paths.join(path_separator())
    }

    fn is_ours(&self, path: &str) -> bool {
        self.directory.as_ref().is_some_and(|directory| {
            let normalized = path.replace('\\', "/");
            normalized == path_string(&directory.join("glass-0.hook"))
                || normalized == path_string(&directory.join("glass-1.hook"))
        })
    }

    pub(crate) fn apply(
        &mut self,
        mpv: &Mpv,
        cache: &Path,
        owner: &str,
        owner_generation: u64,
        layout: GlassLayout,
    ) -> Result<(), String> {
        layout.validate()?;
        if owner_generation < self.owner_generation
            || (owner_generation == self.owner_generation
                && !self.owner.is_empty()
                && self.owner != owner)
        {
            return Ok(());
        }
        if self.directory.is_none() {
            self.directory = Some(
                cache
                    .join("player-glass")
                    .join(uuid::Uuid::new_v4().to_string()),
            );
        }
        let parameters = layout.parameters(mpv)?;
        let signature = format!("{owner}:{parameters:?}");
        if self.signature == signature {
            return Ok(());
        }
        let mut shaders = shader_paths(mpv)?;
        shaders.retain(|path| !self.is_ours(path));
        if !layout.regions.is_empty() {
            let gpu_next =
                mpv.get_property::<String>("current-vo").unwrap_or_default() == "gpu-next";
            // macOS and Linux embed with the libmpv OpenGL render API. Older
            // libmpv renderers have no tunable PARAM support. Compile the same
            // optics with constants there, only when the layout changes.
            let source = if gpu_next {
                SHADER.to_string()
            } else {
                constant_shader(&parameters)
            };
            let directory = self.directory.as_ref().ok_or("Missing glass cache")?;
            std::fs::create_dir_all(directory).map_err(|e| format!("Glass cache: {e}"))?;
            if gpu_next {
                self.slot = 0;
            } else {
                self.slot ^= 1;
            }
            let path = directory.join(format!("glass-{}.hook", self.slot));
            if std::fs::read_to_string(&path).ok().as_deref() != Some(source.as_str()) {
                std::fs::write(&path, source).map_err(|e| format!("Glass shader: {e}"))?;
            }
            if gpu_next {
                let existing = mpv
                    .get_property::<String>("glsl-shader-opts")
                    .map_err(|e| e.to_string())?;
                let mut options: Vec<String> = existing
                    .split(',')
                    .filter(|option| !option.is_empty() && !option.trim_start().starts_with(PREFIX))
                    .map(str::to_string)
                    .collect();
                options.extend(
                    parameters
                        .iter()
                        .map(|(name, value)| format!("{name}={value:.7}")),
                );
                mpv.set_property("glsl-shader-opts", options.join(",").as_str())
                    .map_err(|e| e.to_string())?;
            }
            if self.active_path.as_ref() != Some(&path) {
                shaders.push(path_string(&path));
                mpv.set_property("glsl-shaders", shaders.join(path_separator()).as_str())
                    .map_err(|e| e.to_string())?;
            }
            self.active_path = Some(path);
            self.owner = owner.to_string();
        } else {
            mpv.set_property("glsl-shaders", shaders.join(path_separator()).as_str())
                .map_err(|e| e.to_string())?;
            self.active_path = None;
        }
        self.signature = signature;
        self.owner = owner.to_string();
        self.owner_generation = owner_generation;
        Ok(())
    }
}

impl Drop for GlassState {
    fn drop(&mut self) {
        if let Some(directory) = &self.directory {
            for slot in 0..2 {
                let _ = std::fs::remove_file(directory.join(format!("glass-{slot}.hook")));
            }
            let _ = std::fs::remove_dir(directory);
        }
    }
}

impl GlassLayout {
    fn validate(&self) -> Result<(), String> {
        if !self.viewport_width.is_finite()
            || !self.viewport_height.is_finite()
            || self.viewport_width < 1.0
            || self.viewport_height < 1.0
            || self.regions.len() > MAX_REGIONS
        {
            return Err("Invalid glass viewport".into());
        }
        for r in &self.regions {
            if [r.x, r.y, r.width, r.height, r.radius]
                .iter()
                .any(|v| !v.is_finite())
                || r.width <= 0.0
                || r.height <= 0.0
                || r.radius < 0.0
                || r.radii.is_some_and(|radii| {
                    radii.iter().any(|radius| !radius.is_finite() || *radius < 0.0)
                })
            {
                return Err("Invalid glass region".into());
            }
        }
        Ok(())
    }

    fn parameters(&self, mpv: &Mpv) -> Result<Vec<(String, f64)>, String> {
        let osd = mpv
            .get_property::<MpvNode>("osd-dimensions")
            .map_err(|e| e.to_string())?;
        let mut dimensions = std::collections::HashMap::new();
        if let MpvNode::MapIter(items) = osd {
            for (key, value) in items {
                let number = match value {
                    MpvNode::Double(n) => n,
                    MpvNode::Int64(n) => n as f64,
                    _ => continue,
                };
                dimensions.insert(key, number);
            }
        }
        let w = *dimensions.get("w").unwrap_or(&self.viewport_width);
        let h = *dimensions.get("h").unwrap_or(&self.viewport_height);
        let ml = *dimensions.get("ml").unwrap_or(&0.0);
        let mr = *dimensions.get("mr").unwrap_or(&0.0);
        let mt = *dimensions.get("mt").unwrap_or(&0.0);
        let mb = *dimensions.get("mb").unwrap_or(&0.0);
        Ok(self.mapped_parameters(w, h, ml, mr, mt, mb))
    }

    fn mapped_parameters(
        &self,
        w: f64,
        h: f64,
        ml: f64,
        mr: f64,
        mt: f64,
        mb: f64,
    ) -> Vec<(String, f64)> {
        let w = w.max(1.0);
        let h = h.max(1.0);
        let vw = (w - ml - mr).max(1.0);
        let vh = (h - mt - mb).max(1.0);
        let optics = self.optics.normalized();
        let mut parameters = vec![
            (format!("{PREFIX}count"), self.regions.len() as f64),
            (format!("{PREFIX}scale"), w / self.viewport_width),
            (format!("{PREFIX}zoom"), optics.zoom),
            (format!("{PREFIX}refraction"), optics.refraction),
            (format!("{PREFIX}dispersion"), optics.dispersion),
            (format!("{PREFIX}blur"), optics.blur),
        ];
        for index in 0..MAX_REGIONS {
            let values = self
                .regions
                .get(index)
                .map(|r| {
                    let radii = r.radii.unwrap_or([r.radius; 4]);
                    [
                        (r.x / self.viewport_width * w - ml) / vw,
                        (r.y / self.viewport_height * h - mt) / vh,
                        r.width / self.viewport_width * w / vw,
                        r.height / self.viewport_height * h / vh,
                        radii[0].min(r.width.min(r.height) * 0.5) / self.viewport_width * w / vw,
                        radii[1].min(r.width.min(r.height) * 0.5) / self.viewport_width * w / vw,
                        radii[2].min(r.width.min(r.height) * 0.5) / self.viewport_width * w / vw,
                        radii[3].min(r.width.min(r.height) * 0.5) / self.viewport_width * w / vw,
                    ]
                })
                .unwrap_or([0.0; 8]);
            for (key, value) in ["x", "y", "w", "h", "r0", "r1", "r2", "r3"]
                .into_iter()
                .zip(values)
            {
                parameters.push((format!("{PREFIX}g{index}{key}"), value));
            }
        }
        parameters
    }
}

fn constant_shader(parameters: &[(String, f64)]) -> String {
    let body = SHADER
        .split_once("//!HOOK OUTPUT")
        .expect("Glass OUTPUT hook")
        .1;
    let mut source = String::from("//!HOOK OUTPUT\n");
    for line in body.lines().filter(|line| !line.starts_with("//!WHEN")) {
        if line.starts_with("//!BIND") || line.starts_with("//!DESC") {
            source.push_str(line);
            source.push('\n');
        }
    }
    for (name, value) in parameters {
        source.push_str(&format!("#define {name} ({value:.7})\n"));
    }
    for line in body.lines().filter(|line| !line.starts_with("//!")) {
        source.push_str(line);
        source.push('\n');
    }
    source
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> GlassLayout {
        GlassLayout {
            regions: vec![GlassRegion {
                x: 100.0,
                y: 150.0,
                width: 200.0,
                height: 60.0,
                radius: 30.0,
                radii: None,
            }],
            viewport_width: 1000.0,
            viewport_height: 600.0,
            optics: GlassOptics::default(),
        }
    }

    #[test]
    fn maps_css_regions_through_dpi_and_letterboxing() {
        let parameters: std::collections::HashMap<_, _> = layout()
            .mapped_parameters(2000.0, 1200.0, 0.0, 0.0, 100.0, 100.0)
            .into_iter()
            .collect();
        assert_eq!(parameters["harbor_glass_scale"], 2.0);
        assert_eq!(parameters["harbor_glass_g0x"], 0.1);
        assert_eq!(parameters["harbor_glass_g0y"], 0.2);
        assert_eq!(parameters["harbor_glass_g0h"], 0.12);
        assert_eq!(parameters["harbor_glass_g5w"], 0.0);
    }

    #[test]
    fn legacy_shader_keeps_the_same_optics_without_dynamic_parameters() {
        let source =
            constant_shader(&layout().mapped_parameters(1000.0, 600.0, 0.0, 0.0, 0.0, 0.0));
        assert!(!source.contains("//!PARAM"));
        assert!(!source.contains("DYNAMIC"));
        assert!(source.contains("#define harbor_glass_zoom (1.0800000)"));
        assert!(source.contains("//!HOOK OUTPUT"));
        assert!(source.contains("vec2 dispersion"));
    }

    #[test]
    fn invalid_geometry_is_rejected_and_zero_optics_are_preserved() {
        let mut input = layout();
        input.regions[0].width = f64::NAN;
        assert!(input.validate().is_err());
        let normalized = GlassOptics {
            zoom: f64::INFINITY,
            refraction: -1.0,
            dispersion: 0.0,
            blur: 4.0,
        }
        .normalized();
        assert_eq!(normalized.zoom, 1.08);
        assert_eq!(normalized.refraction, 0.0);
        assert_eq!(normalized.dispersion, 0.0);
        assert_eq!(normalized.blur, 1.2);
    }

    #[test]
    #[ignore = "opens native GPU test windows; run explicitly on a desktop"]
    fn native_gpu_renders_both_shader_paths_and_preserves_other_shaders() {
        fn strings(node: MpvNode, values: &mut Vec<String>) {
            match node {
                MpvNode::String(value) => values.push(value),
                MpvNode::ArrayIter(items) => {
                    for item in items {
                        strings(item, values);
                    }
                }
                MpvNode::MapIter(items) => {
                    for (_, item) in items {
                        strings(item, values);
                    }
                }
                _ => {}
            }
        }
        fn wait_for(mpv: &Mpv, predicate: impl Fn(&Mpv) -> bool) {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
            while std::time::Instant::now() < deadline {
                if predicate(mpv) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            panic!("Native mpv condition timed out");
        }
        for renderer in ["gpu-next", "gpu"] {
            let cache =
                std::env::temp_dir().join(format!("harbor-glass-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&cache).unwrap();
            let log = cache.join("mpv.log");
            let mpv = Mpv::with_initializer(|init| {
                for (name, value) in [
                    ("config", "no"),
                    ("load-scripts", "no"),
                    ("terminal", "no"),
                    ("vo", renderer),
                    ("gpu-api", "d3d11"),
                    ("audio", "no"),
                    ("idle", "yes"),
                    ("force-window", "yes"),
                    ("geometry", "640x360"),
                    ("osc", "no"),
                    ("input-default-bindings", "no"),
                ] {
                    init.set_property(name, value)?;
                }
                init.set_property("log-file", log.to_string_lossy().as_ref())
            })
            .unwrap();
            mpv.command("loadfile", &["av://lavfi:testsrc=size=640x360:rate=24"])
                .unwrap();
            wait_for(&mpv, |mpv| {
                mpv.get_property::<f64>("time-pos")
                    .is_ok_and(|time| time > 0.1)
            });
            let mut state = GlassState::default();
            state
                .apply(&mpv, &cache, "test-owner", 1, layout())
                .unwrap();
            let has_glass = |mpv: &Mpv| {
                let mut passes = Vec::new();
                if let Ok(node) = mpv.get_property::<MpvNode>("vo-passes") {
                    strings(node, &mut passes);
                }
                passes
                    .iter()
                    .any(|pass| pass.contains("Harbor MPV liquid glass GPU"))
            };
            wait_for(&mpv, has_glass);
            let before = mpv.get_property::<f64>("time-pos").unwrap();
            let sentinel = cache.join("sentinel.hook");
            std::fs::write(&sentinel, "//!HOOK OUTPUT\n//!BIND HOOKED\n//!DESC Harbor glass chain sentinel\nvec4 hook() { return HOOKED_tex(HOOKED_pos); }\n").unwrap();
            mpv.set_property(
                "glsl-shaders",
                state.preserve_shader(&path_string(&sentinel)).as_str(),
            )
            .unwrap();
            let mut changed = layout();
            changed.optics = GlassOptics {
                zoom: 1.1,
                refraction: 0.0,
                dispersion: 1.2,
                blur: 0.0,
            };
            state.apply(&mpv, &cache, "test-owner", 1, changed).unwrap();
            wait_for(&mpv, has_glass);
            assert_eq!(shader_paths(&mpv).unwrap().len(), 2);
            let mut clear = layout();
            clear.regions.clear();
            state.apply(&mpv, &cache, "stale-owner", 0, clear).unwrap();
            assert_eq!(shader_paths(&mpv).unwrap().len(), 2);
            let mut clear = layout();
            clear.regions.clear();
            state.apply(&mpv, &cache, "test-owner", 1, clear).unwrap();
            assert_eq!(shader_paths(&mpv).unwrap(), vec![path_string(&sentinel)]);
            assert!(mpv.get_property::<f64>("time-pos").unwrap() >= before);
            let contents = std::fs::read_to_string(&log).unwrap_or_default();
            assert!(!contents.contains("Failed to compile"), "{contents}");
            assert!(!contents.contains("Failed parsing"), "{contents}");
            println!("{renderer}: native optical pass rendered; live settings, shader coexistence and stale-owner cleanup passed");
        }
    }
}
