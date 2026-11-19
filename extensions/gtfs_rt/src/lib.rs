pub mod decode;
pub mod fetch;
pub mod proto;

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::time::{SystemTime, UNIX_EPOCH};

use decode::{decode_alerts, decode_vehicle_positions, AlertRow, VehiclePositionRow};

const DUCKDB_TYPE_DOUBLE: i32 = 11;
const DUCKDB_TYPE_DATE: i32 = 13;
const DUCKDB_TYPE_VARCHAR: i32 = 17;
const DUCKDB_TYPE_TIMESTAMP_TZ: i32 = 31;

type DuckdbConnection = *mut c_void;
type DuckdbBindInfo = *mut c_void;
type DuckdbInitInfo = *mut c_void;
type DuckdbFunctionInfo = *mut c_void;
type DuckdbDataChunk = *mut c_void;
type DuckdbVector = *mut c_void;

type BindFn = extern "C" fn(DuckdbBindInfo);
type InitFn = extern "C" fn(DuckdbInitInfo);
type ScanFn = extern "C" fn(DuckdbFunctionInfo, DuckdbDataChunk);
type DestroyFn = extern "C" fn(*mut c_void);

extern "C" {
    fn gtfs_rt_c_register_table_function_2(
        conn: DuckdbConnection,
        name: *const c_char,
        bind_cb: BindFn,
        init_cb: InitFn,
        scan_cb: ScanFn,
    ) -> bool;

    fn gtfs_rt_c_bind_get_varchar_param(info: DuckdbBindInfo, idx: u64) -> *mut c_char;
    fn gtfs_rt_c_free(ptr: *mut c_void);
    fn gtfs_rt_c_bind_add_col(info: DuckdbBindInfo, name: *const c_char, duckdb_type_id: i32);
    fn gtfs_rt_c_bind_set_data(info: DuckdbBindInfo, data: *mut c_void, destroy_cb: DestroyFn);
    fn gtfs_rt_c_bind_set_error(info: DuckdbBindInfo, err: *const c_char);

    fn gtfs_rt_c_init_get_bind_data(info: DuckdbInitInfo) -> *mut c_void;
    fn gtfs_rt_c_init_set_data(info: DuckdbInitInfo, data: *mut c_void, destroy_cb: DestroyFn);

    fn gtfs_rt_c_func_get_init_data(info: DuckdbFunctionInfo) -> *mut c_void;

    fn gtfs_rt_c_vector_size() -> u64;
    fn gtfs_rt_c_chunk_get_vector(chunk: DuckdbDataChunk, col: u64) -> DuckdbVector;
    fn gtfs_rt_c_chunk_set_size(chunk: DuckdbDataChunk, size: u64);
    fn gtfs_rt_c_vector_get_data(vec: DuckdbVector) -> *mut c_void;
    fn gtfs_rt_c_vector_set_null(vec: DuckdbVector, row: u64);
    fn gtfs_rt_c_vector_assign_string_len(
        vec: DuckdbVector,
        row: u64,
        s: *const c_char,
        len: u64,
    );
}

struct FeedBindData {
    url: String,
    agency_id: String,
}

struct VehicleInitData {
    rows: Vec<VehiclePositionRow>,
    offset: usize,
}

struct AlertInitData {
    rows: Vec<AlertRow>,
    offset: usize,
}

extern "C" fn destroy_bind_data(ptr: *mut c_void) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(ptr as *mut FeedBindData)) };
    }
}

extern "C" fn destroy_vehicle_init_data(ptr: *mut c_void) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(ptr as *mut VehicleInitData)) };
    }
}

extern "C" fn destroy_alert_init_data(ptr: *mut c_void) {
    if !ptr.is_null() {
        unsafe { drop(Box::from_raw(ptr as *mut AlertInitData)) };
    }
}

unsafe fn read_varchar_param(info: DuckdbBindInfo, idx: u64) -> Option<String> {
    let raw = gtfs_rt_c_bind_get_varchar_param(info, idx);
    if raw.is_null() {
        return None;
    }
    let s = CStr::from_ptr(raw).to_string_lossy().into_owned();
    gtfs_rt_c_free(raw as *mut c_void);
    Some(s)
}

unsafe fn add_col(info: DuckdbBindInfo, name: &str, type_id: i32) {
    let c_name = CString::new(name).unwrap();
    gtfs_rt_c_bind_add_col(info, c_name.as_ptr(), type_id);
}

unsafe fn set_bind_error(info: DuckdbBindInfo, msg: &str) {
    let c_msg = CString::new(msg).unwrap_or_else(|_| CString::new("bind error").unwrap());
    gtfs_rt_c_bind_set_error(info, c_msg.as_ptr());
}

unsafe fn write_opt_str(vec: DuckdbVector, row: u64, val: Option<&str>) {
    match val {
        Some(s) => gtfs_rt_c_vector_assign_string_len(
            vec,
            row,
            s.as_ptr() as *const c_char,
            s.len() as u64,
        ),
        None => gtfs_rt_c_vector_set_null(vec, row),
    }
}

unsafe fn write_opt_f64(vec: DuckdbVector, data: *mut f64, row: u64, val: Option<f64>) {
    match val {
        Some(v) => *data.add(row as usize) = v,
        None => gtfs_rt_c_vector_set_null(vec, row),
    }
}

unsafe fn write_opt_i64(vec: DuckdbVector, data: *mut i64, row: u64, val: Option<i64>) {
    match val {
        Some(v) => *data.add(row as usize) = v,
        None => gtfs_rt_c_vector_set_null(vec, row),
    }
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ============================================================================
// gtfs_rt_vehicle_positions(url VARCHAR, agency_id VARCHAR)
// ============================================================================

extern "C" fn vp_bind(info: DuckdbBindInfo) {
    unsafe {
        let Some(url) = read_varchar_param(info, 0) else {
            set_bind_error(info, "gtfs_rt_vehicle_positions: url parameter is required");
            return;
        };
        let agency_id = read_varchar_param(info, 1).unwrap_or_default();

        add_col(info, "event_date", DUCKDB_TYPE_DATE);
        add_col(info, "event_time", DUCKDB_TYPE_TIMESTAMP_TZ);
        add_col(info, "agency_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "route_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "trip_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "vehicle_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "station_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "latitude", DUCKDB_TYPE_DOUBLE);
        add_col(info, "longitude", DUCKDB_TYPE_DOUBLE);
        add_col(info, "bearing", DUCKDB_TYPE_DOUBLE);
        add_col(info, "speed", DUCKDB_TYPE_DOUBLE);
        add_col(info, "status", DUCKDB_TYPE_VARCHAR);
        add_col(info, "occupancy_status", DUCKDB_TYPE_VARCHAR);

        let bind_data = Box::into_raw(Box::new(FeedBindData { url, agency_id }));
        gtfs_rt_c_bind_set_data(info, bind_data as *mut c_void, destroy_bind_data);
    }
}

extern "C" fn vp_init(info: DuckdbInitInfo) {
    unsafe {
        let bind_ptr = gtfs_rt_c_init_get_bind_data(info) as *const FeedBindData;
        let rows = if !bind_ptr.is_null() {
            let bind = &*bind_ptr;
            match fetch::fetch_bytes(&bind.url) {
                Ok(bytes) if !bytes.is_empty() => {
                    match decode_vehicle_positions(&bytes, &bind.agency_id, now_unix_secs()) {
                        Ok(r) => {
                            if r.is_empty() {
                                eprintln!("gtfs_rt: decoded 0 vehicle rows from {} ({} bytes)", bind.url, bytes.len());
                            }
                            r
                        }
                        Err(e) => {
                            eprintln!("gtfs_rt: decode error for {}: {}", bind.url, e);
                            Vec::new()
                        }
                    }
                }
                Ok(_) => {
                    eprintln!("gtfs_rt: empty response for {}", bind.url);
                    Vec::new()
                }
                Err(e) => {
                    eprintln!("gtfs_rt: {}", e);
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };

        let init_data = Box::into_raw(Box::new(VehicleInitData { rows, offset: 0 }));
        gtfs_rt_c_init_set_data(info, init_data as *mut c_void, destroy_vehicle_init_data);
    }
}

extern "C" fn vp_scan(info: DuckdbFunctionInfo, chunk: DuckdbDataChunk) {
    unsafe {
        let init_ptr = gtfs_rt_c_func_get_init_data(info) as *mut VehicleInitData;
        if init_ptr.is_null() {
            gtfs_rt_c_chunk_set_size(chunk, 0);
            return;
        }
        let init = &mut *init_ptr;
        if init.offset >= init.rows.len() {
            gtfs_rt_c_chunk_set_size(chunk, 0);
            return;
        }

        let max_vec = gtfs_rt_c_vector_size() as usize;
        let remaining = init.rows.len() - init.offset;
        let count = remaining.min(max_vec);

        let v_date = gtfs_rt_c_chunk_get_vector(chunk, 0);
        let v_time = gtfs_rt_c_chunk_get_vector(chunk, 1);
        let v_agency = gtfs_rt_c_chunk_get_vector(chunk, 2);
        let v_route = gtfs_rt_c_chunk_get_vector(chunk, 3);
        let v_trip = gtfs_rt_c_chunk_get_vector(chunk, 4);
        let v_veh = gtfs_rt_c_chunk_get_vector(chunk, 5);
        let v_station = gtfs_rt_c_chunk_get_vector(chunk, 6);
        let v_lat = gtfs_rt_c_chunk_get_vector(chunk, 7);
        let v_lon = gtfs_rt_c_chunk_get_vector(chunk, 8);
        let v_bearing = gtfs_rt_c_chunk_get_vector(chunk, 9);
        let v_speed = gtfs_rt_c_chunk_get_vector(chunk, 10);
        let v_status = gtfs_rt_c_chunk_get_vector(chunk, 11);
        let v_occ = gtfs_rt_c_chunk_get_vector(chunk, 12);

        let d_date = gtfs_rt_c_vector_get_data(v_date) as *mut i32;
        let d_time = gtfs_rt_c_vector_get_data(v_time) as *mut i64;
        let d_lat = gtfs_rt_c_vector_get_data(v_lat) as *mut f64;
        let d_lon = gtfs_rt_c_vector_get_data(v_lon) as *mut f64;
        let d_bearing = gtfs_rt_c_vector_get_data(v_bearing) as *mut f64;
        let d_speed = gtfs_rt_c_vector_get_data(v_speed) as *mut f64;

        for i in 0..count {
            let r = &init.rows[init.offset + i];
            let row = i as u64;
            *d_date.add(i) = r.event_date_days;
            *d_time.add(i) = r.event_time_us;
            write_opt_str(v_agency, row, Some(&r.agency_id));
            write_opt_str(v_route, row, r.route_id.as_deref());
            write_opt_str(v_trip, row, r.trip_id.as_deref());
            write_opt_str(v_veh, row, Some(&r.vehicle_id));
            write_opt_str(v_station, row, r.station_id.as_deref());
            write_opt_f64(v_lat, d_lat, row, r.latitude);
            write_opt_f64(v_lon, d_lon, row, r.longitude);
            write_opt_f64(v_bearing, d_bearing, row, r.bearing);
            write_opt_f64(v_speed, d_speed, row, r.speed);
            write_opt_str(v_status, row, Some(&r.status));
            write_opt_str(v_occ, row, r.occupancy_status.as_deref());
        }

        init.offset += count;
        gtfs_rt_c_chunk_set_size(chunk, count as u64);
    }
}

// ============================================================================
// gtfs_rt_alerts(url VARCHAR, agency_id VARCHAR)
// ============================================================================

extern "C" fn alerts_bind(info: DuckdbBindInfo) {
    unsafe {
        let Some(url) = read_varchar_param(info, 0) else {
            set_bind_error(info, "gtfs_rt_alerts: url parameter is required");
            return;
        };
        let agency_id = read_varchar_param(info, 1).unwrap_or_default();

        add_col(info, "alert_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "agency_id", DUCKDB_TYPE_VARCHAR);
        add_col(info, "event_date", DUCKDB_TYPE_DATE);
        add_col(info, "detected_at", DUCKDB_TYPE_TIMESTAMP_TZ);
        add_col(info, "last_seen_at", DUCKDB_TYPE_TIMESTAMP_TZ);
        add_col(info, "active_period_start", DUCKDB_TYPE_TIMESTAMP_TZ);
        add_col(info, "active_period_end", DUCKDB_TYPE_TIMESTAMP_TZ);
        add_col(info, "affected_route_ids", DUCKDB_TYPE_VARCHAR);
        add_col(info, "cause", DUCKDB_TYPE_VARCHAR);
        add_col(info, "effect", DUCKDB_TYPE_VARCHAR);
        add_col(info, "header_text", DUCKDB_TYPE_VARCHAR);
        add_col(info, "description_text", DUCKDB_TYPE_VARCHAR);
        add_col(info, "severity", DUCKDB_TYPE_VARCHAR);

        let bind_data = Box::into_raw(Box::new(FeedBindData { url, agency_id }));
        gtfs_rt_c_bind_set_data(info, bind_data as *mut c_void, destroy_bind_data);
    }
}

extern "C" fn alerts_init(info: DuckdbInitInfo) {
    unsafe {
        let bind_ptr = gtfs_rt_c_init_get_bind_data(info) as *const FeedBindData;
        let rows = if !bind_ptr.is_null() {
            let bind = &*bind_ptr;
            match fetch::fetch_bytes(&bind.url) {
                Ok(bytes) if !bytes.is_empty() => {
                    decode_alerts(&bytes, &bind.agency_id, now_unix_secs()).unwrap_or_default()
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };

        let init_data = Box::into_raw(Box::new(AlertInitData { rows, offset: 0 }));
        gtfs_rt_c_init_set_data(info, init_data as *mut c_void, destroy_alert_init_data);
    }
}

extern "C" fn alerts_scan(info: DuckdbFunctionInfo, chunk: DuckdbDataChunk) {
    unsafe {
        let init_ptr = gtfs_rt_c_func_get_init_data(info) as *mut AlertInitData;
        if init_ptr.is_null() {
            gtfs_rt_c_chunk_set_size(chunk, 0);
            return;
        }
        let init = &mut *init_ptr;
        if init.offset >= init.rows.len() {
            gtfs_rt_c_chunk_set_size(chunk, 0);
            return;
        }

        let max_vec = gtfs_rt_c_vector_size() as usize;
        let remaining = init.rows.len() - init.offset;
        let count = remaining.min(max_vec);

        let v_id = gtfs_rt_c_chunk_get_vector(chunk, 0);
        let v_agency = gtfs_rt_c_chunk_get_vector(chunk, 1);
        let v_date = gtfs_rt_c_chunk_get_vector(chunk, 2);
        let v_detected = gtfs_rt_c_chunk_get_vector(chunk, 3);
        let v_last_seen = gtfs_rt_c_chunk_get_vector(chunk, 4);
        let v_start = gtfs_rt_c_chunk_get_vector(chunk, 5);
        let v_end = gtfs_rt_c_chunk_get_vector(chunk, 6);
        let v_routes = gtfs_rt_c_chunk_get_vector(chunk, 7);
        let v_cause = gtfs_rt_c_chunk_get_vector(chunk, 8);
        let v_effect = gtfs_rt_c_chunk_get_vector(chunk, 9);
        let v_header = gtfs_rt_c_chunk_get_vector(chunk, 10);
        let v_desc = gtfs_rt_c_chunk_get_vector(chunk, 11);
        let v_sev = gtfs_rt_c_chunk_get_vector(chunk, 12);

        let d_date = gtfs_rt_c_vector_get_data(v_date) as *mut i32;
        let d_detected = gtfs_rt_c_vector_get_data(v_detected) as *mut i64;
        let d_last_seen = gtfs_rt_c_vector_get_data(v_last_seen) as *mut i64;
        let d_start = gtfs_rt_c_vector_get_data(v_start) as *mut i64;
        let d_end = gtfs_rt_c_vector_get_data(v_end) as *mut i64;

        for i in 0..count {
            let r = &init.rows[init.offset + i];
            let row = i as u64;
            write_opt_str(v_id, row, Some(&r.alert_id));
            write_opt_str(v_agency, row, Some(&r.agency_id));
            *d_date.add(i) = r.event_date_days;
            *d_detected.add(i) = r.detected_at_us;
            *d_last_seen.add(i) = r.last_seen_at_us;
            write_opt_i64(v_start, d_start, row, r.active_period_start_us);
            write_opt_i64(v_end, d_end, row, r.active_period_end_us);
            write_opt_str(v_routes, row, r.affected_route_ids.as_deref());
            write_opt_str(v_cause, row, r.cause.as_deref());
            write_opt_str(v_effect, row, r.effect.as_deref());
            write_opt_str(v_header, row, r.header_text.as_deref());
            write_opt_str(v_desc, row, r.description_text.as_deref());
            write_opt_str(v_sev, row, r.severity.as_deref());
        }

        init.offset += count;
        gtfs_rt_c_chunk_set_size(chunk, count as u64);
    }
}

#[no_mangle]
pub extern "C" fn gtfs_rt_register_all(conn: DuckdbConnection) -> bool {
    let vp_name = CString::new("gtfs_rt_vehicle_positions").unwrap();
    let alerts_name = CString::new("gtfs_rt_alerts").unwrap();
    unsafe {
        gtfs_rt_c_register_table_function_2(conn, vp_name.as_ptr(), vp_bind, vp_init, vp_scan)
            && gtfs_rt_c_register_table_function_2(
                conn,
                alerts_name.as_ptr(),
                alerts_bind,
                alerts_init,
                alerts_scan,
            )
    }
}
