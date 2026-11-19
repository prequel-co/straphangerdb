fn main() {
    println!("cargo:rerun-if-changed=c_shim/duckdb_bridge.c");
    println!("cargo:rerun-if-changed=include/duckdb.h");
    println!("cargo:rerun-if-changed=include/duckdb_ext_api_v1.h");

    let mut build = cc::Build::new();
    build
        .file("c_shim/duckdb_bridge.c")
        .include("include")
        .pic(true)
        .flag_if_supported("-std=c11")
        .flag_if_supported("-Wno-unused-parameter");

    build.compile("duckdb_bridge");
}
