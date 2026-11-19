package fixtures

import _ "embed"

//go:embed gtfs_positions_v1.json
var GTFSPositionsV1 []byte

//go:embed gtfs_positions_v2.json
var GTFSPositionsV2 []byte

//go:embed stations_v1.json
var StationsV1 []byte

//go:embed stations_v2_scd.json
var StationsV2SCD []byte
