package service_lines

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	_ "github.com/duckdb/duckdb-go/v2"
	"github.com/prequel-co/straphangerdb/pkg/schema"
	"github.com/prequel-co/straphangerdb/pkg/semantic"
)

func TestNormalizeServiceLinesToRows_FallbackAndFormats(t *testing.T) {
	rows, err := normalizeServiceLinesToRows(fallbackServiceLinesGeoJSON)
	if err != nil {
		t.Fatalf("normalizeServiceLinesToRows failed on embedded GeoJSON: %v", err)
	}
	if len(rows) < 25 {
		t.Fatalf("expected at least 25 service lines, got %d", len(rows))
	}

	requiredRoutes := []string{
		"1", "2", "3", "4", "5", "6", "6X", "7", "7X",
		"A", "C", "E", "B", "D", "F", "M",
		"G", "J", "Z", "L", "N", "Q", "R", "W",
		"S", "FS", "H", "SI",
	}
	found := make(map[string]stagedServiceLineRow)
	for _, r := range rows {
		found[r.RouteID] = r
		if r.GeomWKT == "" || r.GeomGeoJSON == "" {
			t.Errorf("route %s has empty geometry", r.RouteID)
		}
	}

	for _, req := range requiredRoutes {
		if _, ok := found[req]; !ok {
			t.Errorf("missing required service line route_id %q", req)
		}
	}

	// Test Socrata v3 query.json envelope with multi-route service string ("N Q R")
	socrataV3Payload := []byte(`{
		"data": [
			{
				"service": "N / Q / R",
				"service_name": "Broadway Express & Local",
				"division": "BMT",
				"the_geom": {
					"type": "LineString",
					"coordinates": [[-73.98715, 40.75529], [-73.98782, 40.74972], [-73.99067, 40.73467]]
				}
			}
		]
	}`)
	v3Rows, err := normalizeServiceLinesToRows(socrataV3Payload)
	if err != nil {
		t.Fatalf("failed to parse Socrata v3 envelope: %v", err)
	}
	if len(v3Rows) != 3 {
		t.Fatalf("expected 3 unrolled routes (N, Q, R), got %d", len(v3Rows))
	}
}

func TestFetch_SocrataV3AndFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/views/s692-irgq/query.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(fallbackServiceLinesGeoJSON)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	p := NewPlugin()
	p.URL = srv.URL + "/api/v3/views/s692-irgq/query.json"
	p.HTTPClient = srv.Client()

	payload, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch failed: %v", err)
	}
	if len(payload) == 0 {
		t.Fatal("expected non-empty payload")
	}

	// Also verify fallback when upstream fails
	pFail := NewPlugin()
	pFail.URL = srv.URL + "/broken"
	pFail.HTTPClient = srv.Client()

	fallbackPayload, err := pFail.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch fallback failed: %v", err)
	}
	if len(fallbackPayload) == 0 {
		t.Fatal("expected non-empty fallback payload")
	}
}

func TestTransformQuery_DuckDBSpatialAndRouteJoin(t *testing.T) {
	p := NewPlugin()
	p.URL = "http://127.0.0.1:1/unreachable"
	payload, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch failed: %v", err)
	}

	db, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatalf("sql.Open duckdb failed: %v", err)
	}
	defer db.Close()

	for _, ddl := range schema.GetBootstrapDDL("transit_v2") {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatalf("Bootstrap DDL failed: %v\nDDL: %s", err, ddl)
		}
	}

	if _, err := db.Exec(`CREATE TEMP TABLE raw_service_lines (payload BLOB);`); err != nil {
		t.Fatalf("create temp table failed: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO raw_service_lines VALUES (?);`, payload); err != nil {
		t.Fatalf("insert payload failed: %v", err)
	}

	query := p.TransformQuery("raw_service_lines")
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("TransformQuery failed: %v", err)
	}

	// Verify idempotency on second run
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("second TransformQuery failed: %v", err)
	}

	var totalCurrent int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transit_v2.view_dim_service_lines;`).Scan(&totalCurrent); err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	if totalCurrent < 25 {
		t.Fatalf("expected at least 25 current service lines in view_dim_service_lines, got %d", totalCurrent)
	}

	// Verify 1:1 uniqueness on (agency_id, route_id) for clean map joins
	var duplicateRoutes int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM (
			SELECT agency_id, route_id, COUNT(*) AS cnt
			FROM transit_v2.view_dim_service_lines
			GROUP BY 1, 2
			HAVING COUNT(*) > 1
		);
	`).Scan(&duplicateRoutes); err != nil {
		t.Fatalf("uniqueness check failed: %v", err)
	}
	if duplicateRoutes != 0 {
		t.Fatalf("expected 0 duplicate (agency_id, route_id) pairs in view_dim_service_lines, got %d", duplicateRoutes)
	}

	// Verify South Brooklyn routes (D, F, N, Q, R) cover Coney Island / Bay Ridge latitudes (< 40.62)
	rows, err := db.Query(`
		SELECT route_id, color_hex
		FROM transit_v2.view_dim_service_lines
		WHERE route_id IN ('D', 'F', 'N', 'Q', 'R')
		ORDER BY route_id;
	`)
	if err != nil {
		t.Fatalf("query South Brooklyn routes failed: %v", err)
	}
	defer rows.Close()

	var sbCount int
	for rows.Next() {
		var routeID, colorHex string
		if err := rows.Scan(&routeID, &colorHex); err != nil {
			t.Fatalf("scan failed: %v", err)
		}
		if colorHex == "" {
			t.Errorf("expected non-empty color_hex for route %s", routeID)
		}
		sbCount++
	}
	if sbCount != 5 {
		t.Fatalf("expected 5 South Brooklyn routes (D, F, N, Q, R), got %d", sbCount)
	}

	// Verify express, shuttle, and SIR route aliases (6X, 7X, FX, GS, FS, H, SI, SIR) exist for 1:1 joins
	var aliasCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM transit_v2.view_dim_service_lines
		WHERE agency_id = 'MTA_NYCT_SUBWAY'
		  AND route_id IN ('6X', '7X', 'FX', 'GS', 'FS', 'H', 'SI', 'SIR');
	`).Scan(&aliasCount); err != nil {
		t.Fatalf("alias count query failed: %v", err)
	}
	if aliasCount != 8 {
		t.Fatalf("expected 8 express/shuttle/SIR route aliases in MTA_NYCT_SUBWAY, got %d", aliasCount)
	}

	// If DuckDB spatial extension is available, verify WKT geometry validity
	if _, err := db.Exec(`INSTALL spatial; LOAD spatial;`); err == nil {
		var validGeomCount int
		err := db.QueryRow(fmt.Sprintf(`
			SELECT COUNT(*)
			FROM transit_v2.view_dim_service_lines
			WHERE ST_IsValid(ST_GeomFromText(geom_wkt));
		`)).Scan(&validGeomCount)
		if err != nil {
			t.Fatalf("spatial ST_GeomFromText validation failed: %v", err)
		}
		if validGeomCount != totalCurrent {
			t.Fatalf("expected all %d geometries to be valid WKT, got %d", totalCurrent, validGeomCount)
		}
	}
}

func TestSplitRouteTokensAndShapeStlength(t *testing.T) {
	cases := []struct {
		raw  string
		want []string
	}{
		{"5 Peak", []string{"5"}},
		{"ST", []string{"S", "GS"}},
		{"SF", []string{"FS"}},
		{"SR", []string{"H"}},
		{"SIR", []string{"SI", "SIR"}},
	}
	for _, tc := range cases {
		got := splitRouteTokens(tc.raw)
		if len(got) != len(tc.want) {
			t.Fatalf("splitRouteTokens(%q) = %v, want %v", tc.raw, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("splitRouteTokens(%q)[%d] = %q, want %q", tc.raw, i, got[i], tc.want[i])
			}
		}
	}

	props := map[string]interface{}{"shape_stlength": "12345.67"}
	leng := extractFloatPtr(props, "shape_leng", "Shape__Length", "shape_length", "Shape_Leng", "shape_stlength")
	if leng == nil || *leng < 12345.0 {
		t.Fatalf("expected shape_stlength to parse ~12345.67, got %v", leng)
	}

	if rawBytes, err := os.ReadFile("/tmp/s692_irgq_query.json"); err == nil && len(rawBytes) > 0 {
		rows, err := normalizeServiceLinesToRows(rawBytes)
		if err != nil {
			t.Fatalf("normalizeServiceLinesToRows(/tmp/s692_irgq_query.json) failed: %v", err)
		}
		if len(rows) < 30 {
			t.Fatalf("expected at least 30 normalized routes from s692_irgq_query.json, got %d", len(rows))
		}
		for _, r := range rows {
			if r.RouteID == "5" && strings.Contains(strings.ToUpper(r.ServiceName), "PEAK") {
				t.Errorf("expected route 5 service_name not to contain Peak, got %q", r.ServiceName)
			}
			if len(r.GeomGeoJSON) > 50000 {
				t.Errorf("expected route %s GeomGeoJSON to be simplified (< 50KB), got %d bytes", r.RouteID, len(r.GeomGeoJSON))
			}
		}
	}
}

func expandOssieQueriesForTest(t *testing.T, model *semantic.ModelDef, sqlStr string) string {
	t.Helper()
	datasets := make(map[string]semantic.DatasetDef, len(model.Datasets))
	for _, ds := range model.Datasets {
		datasets[ds.Name] = ds
	}

	out := sqlStr
	for {
		idx := strings.Index(out, "ossie_query(")
		if idx < 0 {
			break
		}
		pos := idx + len("ossie_query(")
		var args []string
		closed := false
		for pos < len(out) {
			for pos < len(out) && (out[pos] == ' ' || out[pos] == '\t' || out[pos] == '\n' || out[pos] == '\r' || out[pos] == ',') {
				pos++
			}
			if pos < len(out) && out[pos] == ')' {
				pos++
				closed = true
				break
			}
			if pos >= len(out) || out[pos] != '\'' {
				t.Fatalf("unexpected token in ossie_query at offset %d: %.40s", pos, out[pos:])
			}
			pos++
			var lit strings.Builder
			for pos < len(out) {
				if out[pos] == '\'' {
					if pos+1 < len(out) && out[pos+1] == '\'' {
						lit.WriteByte('\'')
						pos += 2
						continue
					}
					pos++
					break
				}
				lit.WriteByte(out[pos])
				pos++
			}
			args = append(args, lit.String())
		}
		if !closed || len(args) < 3 {
			t.Fatalf("malformed ossie_query call near: %.80s", out[idx:])
		}
		dsName := strings.TrimSpace(args[1])
		ds, ok := datasets[dsName]
		if !ok {
			t.Fatalf("ossie_query references unknown dataset %q in dbtc.ossie.yaml", dsName)
		}
		fields := make(map[string]string, len(ds.Fields))
		for _, f := range ds.Fields {
			expr := f.Name
			if f.Expression != nil && len(f.Expression.Dialects) > 0 && f.Expression.Dialects[0].Expression != "" {
				expr = f.Expression.Dialects[0].Expression
			}
			fields[f.Name] = expr
		}
		var proj []string
		for _, rawCol := range strings.Split(args[2], ",") {
			col := strings.TrimSpace(rawCol)
			if col == "" {
				continue
			}
			shortCol := strings.TrimPrefix(col, dsName+".")
			expr, exists := fields[shortCol]
			if !exists {
				t.Fatalf("ossie_query dataset %q does not define field %q", dsName, shortCol)
			}
			proj = append(proj, fmt.Sprintf("%s AS %s", expr, shortCol))
		}
		var subq string
		if len(proj) == 0 && strings.HasPrefix(ds.Source, "local.main.dbtc_") {
			// Chart-ready Ossie lenses compile in the frontend TS compiler (verified in web/tests/ossie-loader.test.ts).
			subq = "(SELECT 1)"
		} else {
			srcTable := strings.ReplaceAll(ds.Source, "prod.transit_v2.", "transit_v2.")
			whereClause := ""
			if len(args) >= 4 && strings.TrimSpace(args[3]) != "" {
				whereClause = " WHERE " + args[3]
			}
			subq = fmt.Sprintf("(SELECT %s FROM %s AS %s%s)", strings.Join(proj, ", "), srcTable, dsName, whereClause)
		}
		out = out[:idx] + subq + out[pos:]
	}
	return out
}

func TestStarterQueriesExecuteAgainstDuckDBSchema(t *testing.T) {
	content, err := os.ReadFile("../../../../web/src/state/local-state-schema.ts")
	if err != nil {
		t.Fatalf("failed to read local-state-schema.ts: %v", err)
	}

	ossieBytes, err := semantic.OssieFS.ReadFile("ossie/ducklake/dbtc.ossie.yaml")
	if err != nil {
		t.Fatalf("failed to read dbtc.ossie.yaml: %v", err)
	}
	ossieModel, err := semantic.LoadModel(ossieBytes)
	if err != nil {
		t.Fatalf("failed to parse dbtc.ossie.yaml: %v", err)
	}

	re := regexp.MustCompile("(?s)cellId:\\s*'([^']+)'[^`]*sqlText:\\s*`([^`]+)`")
	matches := re.FindAllStringSubmatch(string(content), -1)
	if len(matches) < 9 {
		t.Fatalf("expected at least 9 starter SQL cells, found %d", len(matches))
	}

	db, err := sql.Open("duckdb", "")
	if err != nil {
		t.Fatalf("sql.Open duckdb failed: %v", err)
	}
	defer db.Close()

	_, _ = db.Exec(`INSTALL spatial; LOAD spatial;`)
	for _, ddl := range schema.GetBootstrapDDL("transit_v2") {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatalf("Bootstrap DDL failed: %v", err)
		}
	}

	for _, m := range matches {
		cellID := m[1]
		rawSQL := strings.TrimSpace(m[2])
		if rawSQL == "" {
			continue
		}
		if strings.Contains(rawSQL, "local.main.") {
			t.Fatalf("starter query for %s must not reference frontend-injected local.main tables:\n%s", cellID, rawSQL)
		}
		q := expandOssieQueriesForTest(t, ossieModel, rawSQL)
		q = strings.ReplaceAll(q, "prod.transit_v2.", "transit_v2.")
		q = strings.ReplaceAll(q, "{{origin_station_id}}", "237")
		rows, err := db.Query(q)
		if err != nil {
			t.Fatalf("starter query for %s failed against DuckDB transit_v2 schema: %v\nSQL:\n%s", cellID, err, q)
		}
		rows.Close()
	}
}



