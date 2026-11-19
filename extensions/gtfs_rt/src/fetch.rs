#[cfg(target_arch = "wasm32")]
pub fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_void};

    extern "C" {
        fn emscripten_run_script_int(script: *const c_char) -> c_int;
    }

    let c_url = CString::new(url).map_err(|_| "invalid url".to_string())?;
    let mut out_ptr: u32 = 0;
    let mut out_len: u32 = 0;

    let js = format!(
        "(function(){{try{{var xhr=new XMLHttpRequest();xhr.open('GET',UTF8ToString({}),false);xhr.responseType='arraybuffer';xhr.send(null);if(xhr.status>=200&&xhr.status<300&&xhr.response){{var u8=new Uint8Array(xhr.response);var p=_malloc(u8.length);HEAPU8.set(u8,p);HEAPU32[{}>>2]=p;HEAPU32[{}>>2]=u8.length;return xhr.status;}}return xhr.status||-1;}}catch(e){{return -999;}}}})()",
        c_url.as_ptr() as usize,
        (&mut out_ptr as *mut u32) as usize,
        (&mut out_len as *mut u32) as usize,
    );

    let c_js = CString::new(js).map_err(|_| "invalid js script".to_string())?;
    let status = unsafe { emscripten_run_script_int(c_js.as_ptr()) };

    if status < 200 || status >= 300 {
        return Err(format!("HTTP fetch failed for {} (status {})", url, status));
    }
    if out_ptr == 0 || out_len == 0 {
        return Ok(Vec::new());
    }

    let slice = unsafe { std::slice::from_raw_parts(out_ptr as *const u8, out_len as usize) };
    let vec = slice.to_vec();
    unsafe { libc::free(out_ptr as *mut c_void) };
    Ok(vec)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::time::Duration;

    let resp = ureq::get(url)
        .set("User-Agent", "straphangerdb/1.0 (duckdb-gtfs-rt)")
        .set("Accept", "application/x-protobuf, application/octet-stream, */*")
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(|e| format!("HTTP fetch failed for {}: {}", url, e))?;

    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed reading response body for {}: {}", url, e))?;
    Ok(bytes)
}
