package boroughs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBoroughsPluginFetchAndNormalize(t *testing.T) {
	var geoJSONServerURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/download" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status":    "Completed",
				"resultUrl": geoJSONServerURL + "/replica.geojson",
			})
			return
		}
		if r.URL.Path == "/replica.geojson" {
			w.Header().Set("Content-Type", "application/geo+json")
			_, _ = w.Write(fallbackBoroughsGeoJSON)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	geoJSONServerURL = srv.URL

	p := NewPlugin()
	p.URL = srv.URL + "/download"

	raw, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch failed: %v", err)
	}

	var rows []stagedBoroughRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("Unmarshal rows failed: %v", err)
	}
	if len(rows) != 13 {
		t.Fatalf("expected 13 geography rows (5 NYC boroughs + 5 regional landmasses + 3 parks), got %d", len(rows))
	}

	expectedBoroughs := map[int]string{
		1: "Manhattan",
		2: "Bronx",
		3: "Brooklyn",
		4: "Queens",
		5: "Staten Island",
	}
	foundBoro := 0
	foundRegional := 0
	foundParks := 0
	for _, r := range rows {
		if !strings.HasPrefix(r.GeomWKT, "MULTIPOLYGON (((") {
			t.Errorf("boro_code %d: expected MULTIPOLYGON WKT, got prefix %.30q", r.BoroCode, r.GeomWKT)
		}
		if wantName, ok := expectedBoroughs[r.BoroCode]; ok {
			foundBoro++
			if r.BoroName != wantName {
				t.Errorf("boro_code %d: got name %q, want %q", r.BoroCode, r.BoroName, wantName)
			}
		} else if r.BoroCode >= 100 && r.BoroCode < 200 {
			foundRegional++
		} else if r.BoroCode >= 200 {
			foundParks++
		}
	}
	if foundBoro != 5 || foundRegional != 5 || foundParks != 3 {
		t.Fatalf("unexpected geography breakdown: boroughs=%d, regional=%d, parks=%d", foundBoro, foundRegional, foundParks)
	}
}
