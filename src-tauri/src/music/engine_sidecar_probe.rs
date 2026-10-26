use libmpv2::{Mpv,mpv_node::MpvNode};

pub fn probe_core()->Result<Mpv,String>{
    Mpv::with_initializer(|init|{
        init.set_property("video","no")?;
        init.set_property("vo","null")?;
        init.set_property("terminal","no")?;
        let _=init.set_property("media-controls","no");
        Ok(())
    }).map_err(|e|format!("Music device probe: {e}"))
}

pub fn read_music_audio_devices(player:&Mpv)->Result<Vec<crate::mpv::AudioDevice>,String>{
    let node=player.get_property::<MpvNode>("audio-device-list")
        .map_err(|e|format!("Music audio devices: {e}"))?;
    let mut result=Vec::new();
    if let Some(entries)=node.array(){
        for entry in entries.take(128){
            let mut name=String::new();
            let mut description=String::new();
            if let Some(fields)=entry.map(){
                for (key,value) in fields {
                    match key.as_str(){
                        "name"=>name=value.str().unwrap_or_default().to_string(),
                        "description"=>description=value.str().unwrap_or_default().to_string(),
                        _=>{}
                    }
                }
            }
            if !name.is_empty() && name!="auto"{
                result.push(crate::mpv::AudioDevice{name,description});
            }
        }
    }
    Ok(result)
}
