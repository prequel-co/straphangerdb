.PHONY: test native wasm wasm-eh wasm-threads clean

OUT_DIR := ../../web/public/extensions/gtfs_rt

test:
	cargo test

native:
	cargo build --release

wasm: wasm-eh wasm-threads sync-web

sync-web:
	node -e "const fs=require('fs');const eh=fs.readFileSync('$(OUT_DIR)/wasm_eh/gtfs_rt.duckdb_extension.wasm').toString('base64');const th=fs.readFileSync('$(OUT_DIR)/wasm_threads/gtfs_rt.duckdb_extension.wasm').toString('base64');fs.writeFileSync('../../web/src/data/gtfs-rt-wasm.gen.ts','// Auto-generated from web/public/extensions/gtfs_rt/ — do not edit manually.\nexport const GTFS_RT_WASM_EH_BASE64 = '+JSON.stringify(eh)+';\nexport const GTFS_RT_WASM_THREADS_BASE64 = '+JSON.stringify(th)+';\n');"

wasm-eh:
	mkdir -p $(OUT_DIR)/wasm_eh
	CFLAGS="-fPIC -fwasm-exceptions -O2" \
	EMCC_CFLAGS="-sSIDE_MODULE=2 -fwasm-exceptions -O2" \
	RUSTFLAGS="-C link-arg=-sSIDE_MODULE=2 -C link-arg=-fwasm-exceptions -C link-arg=-sEXPORTED_FUNCTIONS=['_gtfs_rt_init_c_api']" \
		cargo build --release --target wasm32-unknown-emscripten
	cp target/wasm32-unknown-emscripten/release/gtfs_rt.wasm $(OUT_DIR)/wasm_eh/gtfs_rt.duckdb_extension.wasm
	python3 append_metadata.py $(OUT_DIR)/wasm_eh/gtfs_rt.duckdb_extension.wasm wasm_eh v1.2.0 0.1.0

wasm-threads:
	mkdir -p $(OUT_DIR)/wasm_threads
	CFLAGS="-fPIC -pthread -O2" \
	EMCC_CFLAGS="-sSIDE_MODULE=2 -pthread -O2" \
	RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=-sSIDE_MODULE=2 -C link-arg=-pthread -C link-arg=-sEXPORTED_FUNCTIONS=['_gtfs_rt_init_c_api']" \
		cargo +nightly build -Z build-std=std,panic_abort --release --target wasm32-unknown-emscripten --target-dir target/threads
	cp target/threads/wasm32-unknown-emscripten/release/gtfs_rt.wasm $(OUT_DIR)/wasm_threads/gtfs_rt.duckdb_extension.wasm
	python3 append_metadata.py $(OUT_DIR)/wasm_threads/gtfs_rt.duckdb_extension.wasm wasm_threads v1.2.0 0.1.0

clean:
	cargo clean
