#include "duckdb_ext_api_v1.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define GTFS_RT_EXPORT EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default")))
#elif defined(_WIN32)
#define GTFS_RT_EXPORT __declspec(dllexport)
#else
#define GTFS_RT_EXPORT __attribute__((visibility("default")))
#endif

static duckdb_ext_api_v1 g_api_storage;
static const duckdb_ext_api_v1 *g_api = NULL;

/* Implemented in Rust (src/lib.rs) */
extern bool gtfs_rt_register_all(duckdb_connection conn);

GTFS_RT_EXPORT bool gtfs_rt_init_c_api(duckdb_extension_info info,
                                       struct duckdb_extension_access *access) {
    if (!info || !access) {
        return false;
    }
    const duckdb_ext_api_v1 *api =
        (const duckdb_ext_api_v1 *)access->get_api(info, "v1.2.0");
    if (!api) {
        access->set_error(info, "gtfs_rt: failed to obtain DuckDB C Extension API v1.2.0");
        return false;
    }
    /* Copy the API struct by value; the pointer returned by get_api may not outlive init. */
    g_api_storage = *api;
    g_api = &g_api_storage;

    if (!g_api->duckdb_create_table_function || !g_api->duckdb_bind_get_parameter ||
        !g_api->duckdb_get_varchar || !g_api->duckdb_destroy_value ||
        !g_api->duckdb_create_logical_type || !g_api->duckdb_bind_add_result_column ||
        !g_api->duckdb_bind_set_bind_data || !g_api->duckdb_register_table_function) {
        access->set_error(info, "gtfs_rt: one or more required C API function pointers are NULL");
        return false;
    }

    duckdb_database *db_ptr = access->get_database(info);
    if (!db_ptr || !*db_ptr) {
        access->set_error(info, "gtfs_rt: failed to obtain DuckDB database handle");
        return false;
    }

    duckdb_connection conn = NULL;
    if (g_api->duckdb_connect(*db_ptr, &conn) != DuckDBSuccess || !conn) {
        access->set_error(info, "gtfs_rt: failed to open internal connection");
        return false;
    }

    bool ok = gtfs_rt_register_all(conn);
    g_api->duckdb_disconnect(&conn);

    if (!ok) {
        access->set_error(info, "gtfs_rt: failed to register table functions");
        return false;
    }
    return true;
}

/* Thin C-API bridge helpers called from Rust */

typedef void (*gtfs_rt_destroy_cb)(void *);

bool gtfs_rt_c_register_table_function_2(
    duckdb_connection conn,
    const char *name,
    duckdb_table_function_bind_t bind_cb,
    duckdb_table_function_init_t init_cb,
    duckdb_table_function_t scan_cb) {
    if (!g_api) return false;

    duckdb_table_function tf = g_api->duckdb_create_table_function();
    if (!tf) return false;

    g_api->duckdb_table_function_set_name(tf, name);

    duckdb_logical_type varchar_type = g_api->duckdb_create_logical_type(DUCKDB_TYPE_VARCHAR);
    g_api->duckdb_table_function_add_parameter(tf, varchar_type);
    g_api->duckdb_table_function_add_parameter(tf, varchar_type);
    g_api->duckdb_destroy_logical_type(&varchar_type);

    g_api->duckdb_table_function_set_bind(tf, bind_cb);
    g_api->duckdb_table_function_set_init(tf, init_cb);
    g_api->duckdb_table_function_set_function(tf, scan_cb);
    g_api->duckdb_table_function_supports_projection_pushdown(tf, false);

    duckdb_state st = g_api->duckdb_register_table_function(conn, tf);
    g_api->duckdb_destroy_table_function(&tf);
    return st == DuckDBSuccess;
}

char *gtfs_rt_c_bind_get_varchar_param(duckdb_bind_info info, idx_t idx) {
    if (!g_api) return NULL;
    duckdb_value val = g_api->duckdb_bind_get_parameter(info, idx);
    if (!val) return NULL;
    char *str = g_api->duckdb_get_varchar(val);
    g_api->duckdb_destroy_value(&val);
    return str; /* Caller frees with gtfs_rt_c_free */
}

void gtfs_rt_c_free(void *ptr) {
    if (g_api && ptr) {
        g_api->duckdb_free(ptr);
    }
}

void gtfs_rt_c_bind_add_col(duckdb_bind_info info, const char *name, int32_t duckdb_type_id) {
    if (!g_api) return;
    duckdb_logical_type ltype = g_api->duckdb_create_logical_type((duckdb_type)duckdb_type_id);
    g_api->duckdb_bind_add_result_column(info, name, ltype);
    g_api->duckdb_destroy_logical_type(&ltype);
}

void gtfs_rt_c_bind_set_data(duckdb_bind_info info, void *data, gtfs_rt_destroy_cb destroy_cb) {
    if (g_api) {
        g_api->duckdb_bind_set_bind_data(info, data, destroy_cb);
    }
}

void gtfs_rt_c_bind_set_error(duckdb_bind_info info, const char *err) {
    if (g_api) {
        g_api->duckdb_bind_set_error(info, err);
    }
}

void *gtfs_rt_c_init_get_bind_data(duckdb_init_info info) {
    return g_api ? g_api->duckdb_init_get_bind_data(info) : NULL;
}

void gtfs_rt_c_init_set_data(duckdb_init_info info, void *data, gtfs_rt_destroy_cb destroy_cb) {
    if (g_api) {
        g_api->duckdb_init_set_init_data(info, data, destroy_cb);
    }
}

void gtfs_rt_c_init_set_error(duckdb_init_info info, const char *err) {
    if (g_api) {
        g_api->duckdb_init_set_error(info, err);
    }
}

void *gtfs_rt_c_func_get_init_data(duckdb_function_info info) {
    return g_api ? g_api->duckdb_function_get_init_data(info) : NULL;
}

void gtfs_rt_c_func_set_error(duckdb_function_info info, const char *err) {
    if (g_api) {
        g_api->duckdb_function_set_error(info, err);
    }
}

idx_t gtfs_rt_c_vector_size(void) {
    return g_api ? g_api->duckdb_vector_size() : 2048;
}

duckdb_vector gtfs_rt_c_chunk_get_vector(duckdb_data_chunk chunk, idx_t col) {
    return g_api ? g_api->duckdb_data_chunk_get_vector(chunk, col) : NULL;
}

void gtfs_rt_c_chunk_set_size(duckdb_data_chunk chunk, idx_t size) {
    if (g_api) {
        g_api->duckdb_data_chunk_set_size(chunk, size);
    }
}

void *gtfs_rt_c_vector_get_data(duckdb_vector vec) {
    return g_api ? g_api->duckdb_vector_get_data(vec) : NULL;
}

void gtfs_rt_c_vector_set_null(duckdb_vector vec, idx_t row) {
    if (!g_api) return;
    g_api->duckdb_vector_ensure_validity_writable(vec);
    uint64_t *validity = g_api->duckdb_vector_get_validity(vec);
    if (validity) {
        g_api->duckdb_validity_set_row_invalid(validity, row);
    }
}

void gtfs_rt_c_vector_assign_string_len(duckdb_vector vec, idx_t row, const char *str, idx_t len) {
    if (g_api) {
        g_api->duckdb_vector_assign_string_element_len(vec, row, str, len);
    }
}
