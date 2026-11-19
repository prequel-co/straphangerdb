package boroughs

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

//go:embed fallback_boroughs.geojson
var fallbackBoroughsGeoJSON []byte

const DefaultNYC5BoroughsURL = "https://hub.arcgis.com/api/download/v1/items/e740addebac54632a5f216fd778af06d/geojson?redirect=false&layers=0&spatialRefId=4326"

func init() {
	plugin.Register(NewPlugin())
}

type NYCBoroughsPlugin struct {
	URL        string
	HTTPClient *http.Client
}

func NewPlugin() *NYCBoroughsPlugin {
	return &NYCBoroughsPlugin{
		URL: DefaultNYC5BoroughsURL,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (p *NYCBoroughsPlugin) ID() string {
	return "nyc_boroughs"
}

func (p *NYCBoroughsPlugin) AgencyID() string {
	return "NYC_DCP"
}

func (p *NYCBoroughsPlugin) TargetTable() string {
	return "dim_boroughs"
}

func (p *NYCBoroughsPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *NYCBoroughsPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

type arcGISDownloadEnvelope struct {
	ResultURL string `json:"resultUrl"`
	Status    string `json:"status"`
}

type geoJSONFeatureCollection struct {
	Type     string           `json:"type"`
	Features []geoJSONFeature `json:"features"`
}

type geoJSONFeature struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
	Geometry   json.RawMessage        `json:"geometry"`
}

type geoJSONGeometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

type stagedBoroughRow struct {
	BoroCode    int                    `json:"boro_code"`
	BoroName    string                 `json:"boro_name"`
	GeomWKT     string                 `json:"geom_wkt"`
	GeomGeoJSON string                 `json:"geom_geojson"`
	ShapeArea   *float64               `json:"shape_area"`
	ShapeLeng   *float64               `json:"shape_leng"`
	RawPayload  map[string]interface{} `json:"raw_payload"`
}

func (p *NYCBoroughsPlugin) Fetch(ctx context.Context) ([]byte, error) {
	rawBytes, err := p.fetchRawGeoJSON(ctx)
	if err != nil || len(rawBytes) == 0 {
		rawBytes = fallbackBoroughsGeoJSON
	}

	rows, err := normalizeGeoJSONToRows(rawBytes)
	if err != nil || len(rows) == 0 {
		rows, err = normalizeGeoJSONToRows(fallbackBoroughsGeoJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to normalize NYC boroughs GeoJSON: %w", err)
		}
	}

	suppRows, err := buildSupplementalMapGeographyRows()
	if err != nil {
		return nil, fmt.Errorf("failed building supplemental map geography rows: %w", err)
	}
	rows = append(rows, suppRows...)

	return json.Marshal(rows)
}

func (p *NYCBoroughsPlugin) fetchRawGeoJSON(ctx context.Context) ([]byte, error) {
	url := p.URL
	if url == "" {
		url = DefaultNYC5BoroughsURL
	}
	if envURL := os.Getenv("NYC_BOROUGHS_GEOJSON_URL"); envURL != "" {
		url = envURL
	}

	body, err := p.httpGet(ctx, url)
	if err != nil {
		return nil, err
	}

	var env arcGISDownloadEnvelope
	if err := json.Unmarshal(body, &env); err == nil && env.ResultURL != "" {
		return p.httpGet(ctx, env.ResultURL)
	}

	return body, nil
}

func (p *NYCBoroughsPlugin) httpGet(ctx context.Context, url string) ([]byte, error) {
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, application/geo+json, */*")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code %d from %s", resp.StatusCode, url)
	}
	return io.ReadAll(resp.Body)
}

func normalizeGeoJSONToRows(rawGeoJSON []byte) ([]stagedBoroughRow, error) {
	var fc geoJSONFeatureCollection
	if err := json.Unmarshal(rawGeoJSON, &fc); err != nil {
		return nil, err
	}
	if len(fc.Features) == 0 {
		return nil, fmt.Errorf("empty GeoJSON feature collection")
	}

	rows := make([]stagedBoroughRow, 0, len(fc.Features))
	for _, feat := range fc.Features {
		boroCode := extractInt(feat.Properties, "BoroCode", "borocode", "boro_code")
		boroName := extractString(feat.Properties, "BoroName", "boroname", "boro_name")
		if boroCode == 0 || boroName == "" {
			continue
		}

		wkt, err := geometryToWKT(feat.Geometry)
		if err != nil {
			return nil, fmt.Errorf("boro %d (%s) geometry to WKT failed: %w", boroCode, boroName, err)
		}

		shapeArea := extractFloatPtr(feat.Properties, "Shape__Area", "shape_area", "Shape_Area")
		shapeLeng := extractFloatPtr(feat.Properties, "Shape__Length", "shape_leng", "Shape_Leng")
		props := make(map[string]interface{}, len(feat.Properties)+1)
		for k, v := range feat.Properties {
			props[k] = v
		}
		props["region_kind"] = "nyc_borough"

		rows = append(rows, stagedBoroughRow{
			BoroCode:    boroCode,
			BoroName:    boroName,
			GeomWKT:     wkt,
			GeomGeoJSON: string(feat.Geometry),
			ShapeArea:   shapeArea,
			ShapeLeng:   shapeLeng,
			RawPayload:  props,
		})
	}
	return rows, nil
}

func buildSupplementalMapGeographyRows() ([]stagedBoroughRow, error) {
	type suppSpec struct {
		code       int
		name       string
		regionKind string
		geomJSON   string
	}
	specs := []suppSpec{
		{
			code:       101,
			name:       "Long Island",
			regionKind: "regional_land",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.748,40.768],[-73.758,40.808],[-73.738,40.822],[-73.715,40.808],[-73.705,40.793],[-73.718,40.848],[-73.692,40.865],[-73.672,40.84],[-73.652,40.805],[-73.642,40.875],[-73.595,40.905],[-73.545,40.908],[-73.528,40.878],[-73.472,40.868],[-73.462,40.925],[-73.395,40.945],[-73.355,40.905],[-73.245,40.905],[-73.165,40.935],[-73.115,40.965],[-73.065,40.965],[-73.04,40.948],[-72.92,40.968],[-72.78,40.978],[-72.64,40.992],[-72.49,41.055],[-72.36,41.125],[-72.238,41.16],[-72.345,41.092],[-72.465,41.022],[-72.58,40.958],[-72.658,40.916],[-72.565,40.898],[-72.445,40.935],[-72.305,41.005],[-72.185,41.032],[-71.95,41.075],[-71.855,41.072],[-71.935,41.032],[-72.175,40.942],[-72.395,40.875],[-72.585,40.822],[-72.795,40.778],[-72.995,40.745],[-73.145,40.722],[-73.265,40.705],[-73.335,40.688],[-73.445,40.662],[-73.565,40.635],[-73.635,40.618],[-73.648,40.596],[-73.666,40.596],[-73.685,40.618],[-73.752,40.604],[-73.745,40.655],[-73.732,40.7],[-73.715,40.742],[-73.748,40.768]]]}`,
		},
		{
			code:       102,
			name:       "Long Beach Island",
			regionKind: "regional_land",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.754,40.583],[-73.662,40.582],[-73.575,40.585],[-73.575,40.594],[-73.662,40.5945],[-73.754,40.5915],[-73.754,40.583]]]}`,
		},
		{
			code:       103,
			name:       "Jones Beach & Fire Island",
			regionKind: "regional_land",
			geomJSON:   `{"type":"MultiPolygon","coordinates":[[[[-73.562,40.585],[-73.325,40.622],[-73.325,40.631],[-73.562,40.594],[-73.562,40.585]]],[[[-73.31,40.624],[-72.755,40.748],[-72.755,40.756],[-73.31,40.632],[-73.31,40.624]]],[[[-72.385,41.055],[-72.295,41.058],[-72.3,41.095],[-72.38,41.092],[-72.385,41.055]]]]}`,
		},
		{
			code:       104,
			name:       "Westchester, Hudson Valley & Connecticut",
			regionKind: "regional_land",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.913,40.91],[-73.906,40.938],[-73.889,40.995],[-73.869,41.075],[-73.892,41.135],[-73.875,41.16],[-73.892,41.192],[-73.938,41.248],[-73.938,41.288],[-73.962,41.38],[-73.968,41.418],[-73.992,41.505],[-73.956,41.588],[-73.945,41.708],[-73.942,41.88],[-72.68,41.88],[-72.68,41.258],[-72.865,41.252],[-72.915,41.272],[-72.948,41.252],[-73.045,41.205],[-73.118,41.175],[-73.182,41.158],[-73.255,41.125],[-73.365,41.102],[-73.418,41.078],[-73.475,41.055],[-73.538,41.028],[-73.62,41.005],[-73.662,40.988],[-73.685,40.968],[-73.732,40.942],[-73.758,40.92],[-73.778,40.895],[-73.785,40.88],[-73.845,40.898],[-73.913,40.91]]]}`,
		},
		{
			code:       105,
			name:       "New Jersey & West-of-Hudson NY",
			regionKind: "regional_land",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.962,41.88],[-73.962,41.708],[-74.006,41.505],[-73.958,41.392],[-73.968,41.288],[-73.962,41.195],[-73.918,41.09],[-73.905,41.005],[-73.928,40.945],[-73.945,40.895],[-73.962,40.852],[-73.982,40.818],[-74.002,40.785],[-74.014,40.762],[-74.0245,40.744],[-74.0255,40.734],[-74.0305,40.7265],[-74.031,40.716],[-74.045,40.702],[-74.072,40.678],[-74.095,40.655],[-74.132,40.646],[-74.142,40.665],[-74.118,40.715],[-74.148,40.732],[-74.152,40.695],[-74.185,40.652],[-74.206,40.638],[-74.212,40.595],[-74.252,40.558],[-74.262,40.502],[-74.282,40.488],[-74.215,40.452],[-74.115,40.428],[-73.998,40.468],[-73.975,40.3],[-74.02,40.15],[-74.9,40.15],[-74.9,41.88],[-73.962,41.88]]]}`,
		},
		{
			code:       201,
			name:       "Central Park",
			regionKind: "park",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.9818,40.7681],[-73.9582,40.8005],[-73.9497,40.7968],[-73.973,40.7644],[-73.9818,40.7681]]]}`,
		},
		{
			code:       202,
			name:       "Prospect Park",
			regionKind: "park",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.9704,40.6751],[-73.9632,40.6712],[-73.958,40.6612],[-73.969,40.652],[-73.9805,40.6601],[-73.974,40.672],[-73.9704,40.6751]]]}`,
		},
		{
			code:       203,
			name:       "Flushing Meadows Corona Park",
			regionKind: "park",
			geomJSON:   `{"type":"Polygon","coordinates":[[[-73.8456,40.7547],[-73.832,40.745],[-73.838,40.725],[-73.858,40.732],[-73.855,40.749],[-73.8456,40.7547]]]}`,
		},
	}

	out := make([]stagedBoroughRow, 0, len(specs))
	for _, s := range specs {
		wkt, err := geometryToWKT(json.RawMessage(s.geomJSON))
		if err != nil {
			return nil, fmt.Errorf("supplemental geography %d (%s) WKT failed: %w", s.code, s.name, err)
		}
		out = append(out, stagedBoroughRow{
			BoroCode:    s.code,
			BoroName:    s.name,
			GeomWKT:     wkt,
			GeomGeoJSON: s.geomJSON,
			RawPayload: map[string]interface{}{
				"name":        s.name,
				"region_kind": s.regionKind,
			},
		})
	}
	return out, nil
}

func extractInt(props map[string]interface{}, keys ...string) int {
	for _, k := range keys {
		if v, ok := props[k]; ok && v != nil {
			switch val := v.(type) {
			case float64:
				return int(val)
			case int:
				return val
			case string:
				var parsed int
				if _, err := fmt.Sscanf(val, "%d", &parsed); err == nil {
					return parsed
				}
			}
		}
	}
	return 0
}

func extractString(props map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := props[k]; ok && v != nil {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func extractFloatPtr(props map[string]interface{}, keys ...string) *float64 {
	for _, k := range keys {
		if v, ok := props[k]; ok && v != nil {
			if f, ok := v.(float64); ok {
				val := f
				return &val
			}
		}
	}
	return nil
}

func geometryToWKT(rawGeom json.RawMessage) (string, error) {
	var g geoJSONGeometry
	if err := json.Unmarshal(rawGeom, &g); err != nil {
		return "", err
	}

	switch g.Type {
	case "MultiPolygon":
		var multi [][][][]float64
		if err := json.Unmarshal(g.Coordinates, &multi); err != nil {
			return "", err
		}
		var polyStrs []string
		for _, poly := range multi {
			polyStrs = append(polyStrs, formatPolygonRings(poly))
		}
		return "MULTIPOLYGON (" + strings.Join(polyStrs, ", ") + ")", nil
	case "Polygon":
		var poly [][][]float64
		if err := json.Unmarshal(g.Coordinates, &poly); err != nil {
			return "", err
		}
		return "MULTIPOLYGON (" + formatPolygonRings(poly) + ")", nil
	default:
		return "", fmt.Errorf("unsupported geometry type %q", g.Type)
	}
}

func formatPolygonRings(rings [][][]float64) string {
	var ringStrs []string
	for _, ring := range rings {
		var ptStrs []string
		for _, pt := range ring {
			if len(pt) >= 2 {
				ptStrs = append(ptStrs, fmt.Sprintf("%.8f %.8f", pt[0], pt[1]))
			}
		}
		ringStrs = append(ringStrs, "("+strings.Join(ptStrs, ", ")+")")
	}
	return "(" + strings.Join(ringStrs, ", ") + ")"
}

func (p *NYCBoroughsPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(boro_code INTEGER, boro_name VARCHAR, geom_wkt VARCHAR, geom_geojson VARCHAR, shape_area DOUBLE, shape_leng DOUBLE, raw_payload JSON)"]')) AS b
			FROM %s
		),
		staged AS (
			SELECT
				CAST(b.boro_code AS INTEGER) AS boro_code,
				CAST(b.boro_name AS VARCHAR) AS boro_name,
				CAST(b.geom_wkt AS VARCHAR) AS geom_wkt,
				CAST(b.geom_geojson AS VARCHAR) AS geom_geojson,
				CAST(b.shape_area AS DOUBLE) AS shape_area,
				CAST(b.shape_leng AS DOUBLE) AS shape_leng,
				CURRENT_TIMESTAMP AS valid_from,
				CAST(NULL AS TIMESTAMPTZ) AS valid_to,
				true AS is_current,
				to_json(b.raw_payload)::VARIANT AS raw_payload,
				ROW_NUMBER() OVER (PARTITION BY b.boro_code ORDER BY b.boro_name) AS rn
			FROM parsed
			WHERE b.boro_code IS NOT NULL AND b.boro_name IS NOT NULL AND b.geom_wkt IS NOT NULL
		)
		SELECT
			boro_code,
			boro_name,
			geom_wkt,
			geom_geojson,
			shape_area,
			shape_leng,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		FROM staged
		WHERE rn = 1
	`, rawTable)
}

func (p *NYCBoroughsPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.dim_boroughs AS cur
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		FROM (
			%s
		) AS raw
		WHERE cur.boro_code = raw.boro_code
		  AND cur.is_current = true
		  AND (
			  cur.boro_name IS DISTINCT FROM raw.boro_name
			  OR cur.geom_wkt IS DISTINCT FROM raw.geom_wkt
			  OR cur.raw_payload::VARCHAR IS DISTINCT FROM raw.raw_payload::VARCHAR
		  );

		INSERT INTO transit_v2.dim_boroughs (
			boro_code,
			boro_name,
			geom_wkt,
			geom_geojson,
			shape_area,
			shape_leng,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		)
		WITH staged_sel AS (
			%s
		)
		SELECT
			src.boro_code,
			src.boro_name,
			src.geom_wkt,
			src.geom_geojson,
			src.shape_area,
			src.shape_leng,
			src.valid_from,
			src.valid_to,
			src.is_current,
			src.raw_payload
		FROM staged_sel src
		LEFT JOIN transit_v2.dim_boroughs cur
		  ON cur.boro_code = src.boro_code
		 AND cur.is_current = true
		WHERE cur.boro_code IS NULL
		   OR cur.boro_name IS DISTINCT FROM src.boro_name
		   OR cur.geom_wkt IS DISTINCT FROM src.geom_wkt
		   OR cur.raw_payload::VARCHAR IS DISTINCT FROM src.raw_payload::VARCHAR;
	`, p.TransformSelect(rawTable), p.TransformSelect(rawTable))
}
