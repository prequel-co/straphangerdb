package service_lines

import (
	"archive/zip"
	"bytes"
	"context"
	_ "embed"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

//go:embed fallback_service_lines.geojson
var fallbackServiceLinesGeoJSON []byte

// DefaultMTAServiceLinesURL points to NY Open Data MTA Subway Service Lines (s692-irgq).
// Reference: https://data.ny.gov/Transportation/MTA-Subway-Service-Lines/s692-irgq/about_data
const (
	DefaultMTAServiceLinesURL         = "https://data.ny.gov/api/v3/views/s692-irgq/query.json"
	FallbackMTAServiceLinesGeoJSONURL = "https://data.ny.gov/resource/s692-irgq.geojson?$limit=5000"
	FallbackMTAServiceLinesSODAURL    = "https://data.ny.gov/resource/s692-irgq.json?$limit=5000"
)

func init() {
	plugin.Register(NewPlugin())
}

type MTAServiceLinesPlugin struct {
	URL        string
	HTTPClient *http.Client
}

func NewPlugin() *MTAServiceLinesPlugin {
	return &MTAServiceLinesPlugin{
		URL: DefaultMTAServiceLinesURL,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (p *MTAServiceLinesPlugin) ID() string {
	return "mta_service_lines"
}

func (p *MTAServiceLinesPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTAServiceLinesPlugin) TargetTable() string {
	return "dim_service_lines"
}

func (p *MTAServiceLinesPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *MTAServiceLinesPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
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

type socrataV3Envelope struct {
	Data []map[string]interface{} `json:"data"`
}

type stagedServiceLineRow struct {
	LineID      string                 `json:"line_id"`
	AgencyID    string                 `json:"agency_id"`
	RouteID     string                 `json:"route_id"`
	ServiceName string                 `json:"service_name"`
	Division    string                 `json:"division"`
	LineName    string                 `json:"line_name"`
	ColorHex    string                 `json:"color_hex"`
	GeomWKT     string                 `json:"geom_wkt"`
	GeomGeoJSON string                 `json:"geom_geojson"`
	ShapeLeng   *float64               `json:"shape_leng"`
	RawPayload  map[string]interface{} `json:"raw_payload"`
}

var canonicalMTATrunkColors = map[string]string{
	"1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
	"4": "#00933C", "5": "#00933C", "6": "#00933C", "6X": "#00933C",
	"7": "#B933AD", "7X": "#B933AD",
	"A": "#0039A6", "C": "#0039A6", "E": "#0039A6",
	"B": "#FF6319", "D": "#FF6319", "F": "#FF6319", "FX": "#FF6319", "M": "#FF6319",
	"G": "#6CBE45",
	"J": "#996633", "Z": "#996633",
	"L": "#A7A9AC",
	"N": "#FCCC0A", "Q": "#FCCC0A", "R": "#FCCC0A", "W": "#FCCC0A",
	"S": "#808183", "FS": "#808183", "H": "#808183", "GS": "#808183",
	"SI": "#0039A6", "SIR": "#0039A6",
}

func (p *MTAServiceLinesPlugin) Fetch(ctx context.Context) ([]byte, error) {
	rawBytes, err := p.fetchRawPayload(ctx)
	if err != nil || len(rawBytes) == 0 {
		rawBytes = fallbackServiceLinesGeoJSON
	}

	rows, err := normalizeServiceLinesToRows(rawBytes)
	if err != nil || len(rows) == 0 {
		rows, err = normalizeServiceLinesToRows(fallbackServiceLinesGeoJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to normalize MTA service lines GeoJSON: %w", err)
		}
	}

	// Build 1953 historical Subway & SIR service lines directly for view_dim_service_lines_1953
	rows1953 := build1953HistoricalServiceLines(rows)
	rows = append(rows, rows1953...)

	// Fetch and append regional commuter rail, PATH, NJ Transit, and MTA SBS Bus corridor geometries
	regionalRows := p.fetchRegionalAndBusServiceLines(ctx)
	rows = append(rows, regionalRows...)

	return json.Marshal(rows)
}

func (p *MTAServiceLinesPlugin) fetchRawPayload(ctx context.Context) ([]byte, error) {
	primaryURL := p.URL
	if primaryURL == "" {
		primaryURL = DefaultMTAServiceLinesURL
	}
	if envURL := os.Getenv("MTA_SERVICE_LINES_URL"); envURL != "" {
		primaryURL = envURL
	}

	urls := []string{primaryURL}
	if primaryURL == DefaultMTAServiceLinesURL {
		urls = append(urls, FallbackMTAServiceLinesGeoJSONURL, FallbackMTAServiceLinesSODAURL)
	}

	var lastErr error
	for _, u := range urls {
		body, err := p.httpGet(ctx, u)
		if err == nil && len(body) > 0 {
			if rows, normErr := normalizeServiceLinesToRows(body); normErr == nil && len(rows) > 0 {
				return body, nil
			}
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("all MTA service line endpoints returned empty or unparseable payloads")
}

func (p *MTAServiceLinesPlugin) httpGet(ctx context.Context, url string) ([]byte, error) {
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, application/geo+json, application/zip, */*")

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

func normalizeServiceLinesToRows(rawBytes []byte) ([]stagedServiceLineRow, error) {
	features, err := parseToGeoJSONFeatures(rawBytes)
	if err != nil {
		return nil, err
	}
	if len(features) == 0 {
		return nil, fmt.Errorf("no service line features found in payload")
	}

	type routeAccumulator struct {
		agencyID    string
		routeID     string
		serviceName string
		division    string
		lineName    string
		colorHex    string
		lines       [][][]float64
		shapeLeng   float64
		hasLeng     bool
		rawProps    map[string]interface{}
	}

	byKey := make(map[string]*routeAccumulator)

	for _, feat := range features {
		rawService := extractString(
			feat.Properties,
			"route_id", "service", "rt_symbol", "name", "route_short_name", "line",
		)
		if rawService == "" {
			continue
		}

		lines, err := extractMultiLineCoordinates(feat.Geometry)
		if err != nil || len(lines) == 0 {
			continue
		}

		routeTokens := splitRouteTokens(rawService)
		if len(routeTokens) == 0 {
			continue
		}

		agencyID := extractString(feat.Properties, "agency_id")
		serviceName := extractString(feat.Properties, "service_name", "name", "descriptio", "route_long_name")
		division := extractString(feat.Properties, "division", "div")
		lineName := extractString(feat.Properties, "line_name", "line", "corridor")
		colorHex := extractString(feat.Properties, "color_hex", "color", "route_color")
		shapeLeng := extractFloatPtr(feat.Properties, "shape_leng", "Shape__Length", "shape_length", "Shape_Leng", "shape_stlength")

		for _, rt := range routeTokens {
			rtAgency := agencyID
			if rtAgency == "" {
				if rt == "SI" || rt == "SIR" {
					rtAgency = "MTA_NYCT_SIR"
				} else {
					rtAgency = "MTA_NYCT_SUBWAY"
				}
			}

			key := rtAgency + ":" + rt
			acc, exists := byKey[key]
			if !exists {
				rtColor := colorHex
				if rtColor == "" {
					rtColor = canonicalMTATrunkColors[rt]
				}
				if !strings.HasPrefix(rtColor, "#") && len(rtColor) == 6 {
					rtColor = "#" + rtColor
				}
				if rtColor == "" {
					rtColor = "#0039A6"
				}

				rtServiceName := serviceName
				if rtServiceName == "" || strings.Contains(strings.ToUpper(rawService), "PEAK") {
					rtServiceName = rt + " Subway Service"
				}
				rtLineName := lineName
				if rtLineName == "" || strings.Contains(strings.ToUpper(rawService), "PEAK") {
					rtLineName = rtServiceName
				}
				rtDivision := division
				if rtDivision == "" {
					rtDivision = inferDivision(rt)
				}

				acc = &routeAccumulator{
					agencyID:    rtAgency,
					routeID:     rt,
					serviceName: rtServiceName,
					division:    rtDivision,
					lineName:    rtLineName,
					colorHex:    rtColor,
					rawProps:    feat.Properties,
				}
				byKey[key] = acc
			}
			acc.lines = append(acc.lines, lines...)
			if shapeLeng != nil {
				acc.shapeLeng += *shapeLeng
				acc.hasLeng = true
			}
		}
	}

	if len(byKey) == 0 {
		return nil, fmt.Errorf("no valid route geometries extracted from service lines")
	}

	for _, acc := range byKey {
		acc.lines = sanitizeMultiLines(stitchAndSimplifyRawLines(acc.lines))
	}

	// Ensure express, shuttle, and SIR aliases ('7X', '6X', 'FX', 'GS', 'FS', 'H', 'SI', 'SIR') exist so fact/leg/route joins succeed 1:1
	type aliasSpec struct {
		sourceKey   string
		targetAg    string
		targetRoute string
		serviceName string
	}
	aliases := []aliasSpec{
		{"MTA_NYCT_SUBWAY:7", "MTA_NYCT_SUBWAY", "7X", "Flushing Express"},
		{"MTA_NYCT_SUBWAY:6", "MTA_NYCT_SUBWAY", "6X", "Pelham Express"},
		{"MTA_NYCT_SUBWAY:F", "MTA_NYCT_SUBWAY", "FX", "Culver Express"},
		{"MTA_NYCT_SUBWAY:S", "MTA_NYCT_SUBWAY", "GS", "42 St Shuttle"},
		{"MTA_NYCT_SUBWAY:S", "MTA_NYCT_SUBWAY", "FS", "Franklin Av Shuttle"},
		{"MTA_NYCT_SUBWAY:S", "MTA_NYCT_SUBWAY", "H", "Rockaway Park Shuttle"},
		{"MTA_NYCT_SIR:SI", "MTA_NYCT_SIR", "SIR", "Staten Island Railway"},
		{"MTA_NYCT_SIR:SI", "MTA_NYCT_SUBWAY", "SI", "Staten Island Railway"},
		{"MTA_NYCT_SIR:SI", "MTA_NYCT_SUBWAY", "SIR", "Staten Island Railway"},
		{"MTA_NYCT_SIR:SIR", "MTA_NYCT_SIR", "SI", "Staten Island Railway"},
		{"MTA_NYCT_SIR:SIR", "MTA_NYCT_SUBWAY", "SI", "Staten Island Railway"},
		{"MTA_NYCT_SIR:SIR", "MTA_NYCT_SUBWAY", "SIR", "Staten Island Railway"},
	}
	for _, al := range aliases {
		if base, ok := byKey[al.sourceKey]; ok {
			targetKey := al.targetAg + ":" + al.targetRoute
			if _, exists := byKey[targetKey]; !exists {
				byKey[targetKey] = &routeAccumulator{
					agencyID:    al.targetAg,
					routeID:     al.targetRoute,
					serviceName: al.serviceName,
					division:    base.division,
					lineName:    base.lineName,
					colorHex:    base.colorHex,
					lines:       base.lines,
					shapeLeng:   base.shapeLeng,
					hasLeng:     base.hasLeng,
					rawProps:    base.rawProps,
				}
			}
		}
	}

	keys := make([]string, 0, len(byKey))
	for k := range byKey {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	rows := make([]stagedServiceLineRow, 0, len(keys))
	for _, k := range keys {
		acc := byKey[k]
		if len(acc.lines) == 0 {
			continue
		}
		row, err := makeStagedServiceLineRow(
			acc.routeID, acc.agencyID, acc.routeID,
			acc.serviceName, acc.division, acc.lineName, acc.colorHex,
			acc.lines, acc.hasLeng, acc.shapeLeng, acc.rawProps,
		)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}

	return rows, nil
}

func makeStagedServiceLineRow(
	lineID, agencyID, routeID, serviceName, division, lineName, colorHex string,
	lines [][][]float64,
	hasLeng bool, shapeLeng float64,
	rawProps map[string]interface{},
) (stagedServiceLineRow, error) {
	cleanLines := sanitizeMultiLines(lines)
	wkt := formatMultiLineStringWKT(cleanLines)
	geoJSONBytes, err := json.Marshal(map[string]interface{}{
		"type":        "MultiLineString",
		"coordinates": cleanLines,
	})
	if err != nil {
		return stagedServiceLineRow{}, err
	}
	var lengPtr *float64
	if hasLeng {
		val := shapeLeng
		lengPtr = &val
	} else {
		approx := computeApproxDegreeLength(cleanLines)
		lengPtr = &approx
	}
	if rawProps == nil {
		rawProps = map[string]interface{}{}
	}
	return stagedServiceLineRow{
		LineID:      lineID,
		AgencyID:    agencyID,
		RouteID:     routeID,
		ServiceName: serviceName,
		Division:    division,
		LineName:    lineName,
		ColorHex:    colorHex,
		GeomWKT:     wkt,
		GeomGeoJSON: string(geoJSONBytes),
		ShapeLeng:   lengPtr,
		RawPayload:  rawProps,
	}, nil
}

func sanitizeMultiLines(lines [][][]float64) [][][]float64 {
	out := make([][][]float64, 0, len(lines))
	for _, ch := range lines {
		dedup := make([][]float64, 0, len(ch))
		for _, pt := range ch {
			if len(pt) < 2 || math.IsNaN(pt[0]) || math.IsNaN(pt[1]) {
				continue
			}
			lon := math.Round(pt[0]*1e5) / 1e5
			lat := math.Round(pt[1]*1e5) / 1e5
			if len(dedup) > 0 {
				prev := dedup[len(dedup)-1]
				if prev[0] == lon && prev[1] == lat {
					continue
				}
			}
			dedup = append(dedup, []float64{lon, lat})
		}
		if len(dedup) >= 2 && computeChainDegreeLength(dedup) > 1e-5 {
			out = append(out, dedup)
		}
	}
	return out
}

func computeChainDegreeLength(ch [][]float64) float64 {
	total := 0.0
	for i := 1; i < len(ch); i++ {
		total += ptDist(ch[i-1], ch[i])
	}
	return total
}

func computeApproxDegreeLength(lines [][][]float64) float64 {
	total := 0.0
	for _, ch := range lines {
		total += computeChainDegreeLength(ch)
	}
	return math.Round(total*111320.0*100) / 100
}

// build1953HistoricalServiceLines produces the 1953 Board of Transportation IND Service Guide
// track network (excluding post-1953 extensions: Archer Ave, 63rd St Tunnel, Second Ave Subway,
// IND Rockaway Line across Jamaica Bay, 7 Hudson Yards, and Harlem-148 St).
func build1953HistoricalServiceLines(subwayRows []stagedServiceLineRow) []stagedServiceLineRow {
	post1953Routes := map[string]bool{
		"Z": true, "W": true, "T": true, "H": true, "FX": true, "6X": true, "7X": true, "IBX": true,
	}

	parsedChains := make(map[string][][][]float64)
	for _, r := range subwayRows {
		if r.AgencyID != "MTA_NYCT_SUBWAY" && r.AgencyID != "MTA_NYCT_SIR" {
			continue
		}
		lines, err := extractMultiLineCoordinates(json.RawMessage(r.GeomGeoJSON))
		if err == nil && len(lines) > 0 {
			parsedChains[r.AgencyID+":"+r.RouteID] = lines
		}
	}

	// Extract Hillside Ave -> 179 St segment from F and 53rd St Tunnel segment from M
	var hillside179 [][]float64
	if fChains := parsedChains["MTA_NYCT_SUBWAY:F"]; len(fChains) > 0 {
		for _, ch := range fChains {
			for i, pt := range ch {
				if pt[0] > -73.812 && pt[1] > 40.708 {
					hillside179 = ch[i:]
					break
				}
			}
		}
	}
	var tunnel53rd [][]float64
	if mChains := parsedChains["MTA_NYCT_SUBWAY:M"]; len(mChains) > 0 {
		for _, ch := range mChains {
			startIdx, endIdx := -1, -1
			for i, pt := range ch {
				if startIdx < 0 && pt[1] > 40.756 && pt[0] > -73.980 && pt[0] < -73.968 {
					startIdx = i
				}
				if startIdx >= 0 && pt[0] >= -73.933 && pt[1] <= 40.7535 {
					endIdx = i
					break
				}
			}
			if startIdx >= 0 && endIdx > startIdx {
				tunnel53rd = ch[startIdx:endIdx]
				break
			}
		}
	}

	var out []stagedServiceLineRow
	for _, r := range subwayRows {
		if r.AgencyID != "MTA_NYCT_SUBWAY" && r.AgencyID != "MTA_NYCT_SIR" {
			continue
		}
		rt := strings.ToUpper(r.RouteID)
		if post1953Routes[rt] {
			continue
		}
		chains := parsedChains[r.AgencyID+":"+r.RouteID]
		if len(chains) == 0 {
			continue
		}

		modChains := make([][][]float64, 0, len(chains))
		switch rt {
		case "E":
			// Strip 1988 Archer Ave dive and restore 1950 Hillside Ave -> 179 St
			for _, ch := range chains {
				archerIdx := -1
				for i, pt := range ch {
					if pt[0] > -73.821 && pt[1] < 40.708 {
						archerIdx = i
						break
					}
				}
				if archerIdx > 5 {
					combined := append([][]float64{}, ch[:archerIdx]...)
					combined = append(combined, hillside179...)
					modChains = append(modChains, combined)
				} else if archerIdx < 0 {
					modChains = append(modChains, ch)
				}
			}
		case "J":
			// Strip 1988 Archer Ave Subway east of 121 St
			for _, ch := range chains {
				filtered := make([][]float64, 0, len(ch))
				for _, pt := range ch {
					if pt[0] <= -73.828 {
						filtered = append(filtered, pt)
					}
				}
				if len(filtered) >= 2 {
					modChains = append(modChains, filtered)
				}
			}
		case "F":
			// Replace 1989 63rd St Tunnel (Roosevelt Island) with 1933 53rd St Tunnel
			for _, ch := range chains {
				idxBefore, idxAfter := -1, -1
				for i, pt := range ch {
					if idxBefore < 0 && pt[1] > 40.761 && pt[0] > -73.980 && pt[0] < -73.950 {
						idxBefore = i
					} else if idxBefore >= 0 && pt[0] >= -73.933 && pt[1] <= 40.7535 {
						idxAfter = i
						break
					}
				}
				if idxBefore > 0 && idxAfter > idxBefore && len(tunnel53rd) > 0 {
					spliced := append([][]float64{}, ch[:idxBefore]...)
					spliced = append(spliced, tunnel53rd...)
					spliced = append(spliced, ch[idxAfter:]...)
					modChains = append(modChains, spliced)
				} else {
					modChains = append(modChains, ch)
				}
			}
		case "Q":
			// Strip 2017 Second Ave Subway north/east of 57 St-7 Av
			for _, ch := range chains {
				clipped := make([][]float64, 0, len(ch))
				for _, pt := range ch {
					if pt[1] > 40.7678 && pt[0] > -73.9782 {
						break
					}
					clipped = append(clipped, pt)
				}
				if len(clipped) >= 2 {
					modChains = append(modChains, clipped)
				}
			}
		case "A":
			// Strip 1956 IND Rockaway Line across Jamaica Bay (south of Liberty Ave)
			for _, ch := range chains {
				hasBay := false
				for _, pt := range ch {
					if pt[1] < 40.665 {
						hasBay = true
						break
					}
				}
				if hasBay {
					kept := make([][]float64, 0, len(ch))
					for _, pt := range ch {
						if pt[1] >= 40.6785 {
							kept = append(kept, pt)
						}
					}
					if len(kept) >= 2 {
						modChains = append(modChains, kept)
					}
				} else {
					modChains = append(modChains, ch)
				}
			}
		case "7":
			// Strip 2015 34 St-Hudson Yards west of Times Sq-42 St
			for _, ch := range chains {
				kept := make([][]float64, 0, len(ch))
				for _, pt := range ch {
					if pt[0] >= -73.990 {
						kept = append(kept, pt)
					}
				}
				if len(kept) >= 2 {
					modChains = append(modChains, kept)
				}
			}
		case "3":
			// Strip 1968 Harlem-148 St north of 145 St
			for _, ch := range chains {
				kept := make([][]float64, 0, len(ch))
				for _, pt := range ch {
					if pt[1] > 40.8212 && pt[0] > -73.938 {
						continue
					}
					kept = append(kept, pt)
				}
				if len(kept) >= 2 {
					modChains = append(modChains, kept)
				}
			}
		default:
			modChains = chains
		}

		cleanMod := sanitizeMultiLines(modChains)
		if len(cleanMod) == 0 {
			continue
		}
		agency1953 := r.AgencyID + "_1953"
		row53, err := makeStagedServiceLineRow(
			agency1953+":"+r.RouteID,
			agency1953,
			r.RouteID,
			r.ServiceName,
			r.Division,
			r.LineName,
			r.ColorHex,
			cleanMod,
			false,
			0,
			map[string]interface{}{"era": "1953", "base_agency_id": r.AgencyID},
		)
		if err == nil {
			out = append(out, row53)
		}
	}
	return out
}

type auxiliaryCorridorDef struct {
	agencyID      string
	routeID       string
	bulletCode    string
	division      string
	lineName      string
	colorHex      string
	aliases       []string
	fallbackLines [][][]float64
}

func canonicalAuxiliaryCorridorDefs() []auxiliaryCorridorDef {
	pennToJamaica := [][]float64{
		{-73.9936, 40.7506}, {-73.9745, 40.7438}, {-73.9515, 40.7428},
		{-73.9325, 40.7468}, {-73.9225, 40.7472}, {-73.9030, 40.7458},
		{-73.8448, 40.7195}, {-73.8307, 40.7096}, {-73.8085, 40.6996},
	}
	gcmToJamaica := [][]float64{
		{-73.9772, 40.7527}, {-73.9755, 40.7552}, {-73.9707, 40.7615},
		{-73.9658, 40.7646}, {-73.9577, 40.7610}, {-73.9484, 40.7569},
		{-73.9417, 40.7536}, {-73.9360, 40.7506}, {-73.9305, 40.7484},
		{-73.9225, 40.7472}, {-73.9030, 40.7458}, {-73.8448, 40.7195},
		{-73.8307, 40.7096}, {-73.8085, 40.6996},
	}
	atlToJamaica := [][]float64{
		{-73.9757, 40.6836}, {-73.9488, 40.6784}, {-73.9028, 40.6758}, {-73.8085, 40.6996},
	}
	withTerminals := func(eastChain [][]float64) [][][]float64 {
		c1 := append(append([][]float64{}, pennToJamaica...), eastChain[1:]...)
		c2 := append(append([][]float64{}, gcmToJamaica...), eastChain[1:]...)
		c3 := append(append([][]float64{}, atlToJamaica...), eastChain[1:]...)
		return [][][]float64{c1, c2, c3}
	}

	babylonEast := [][]float64{
		{-73.8085, 40.6996}, {-73.7655, 40.6912}, {-73.6762, 40.6562},
		{-73.6465, 40.6582}, {-73.5832, 40.6572}, {-73.5102, 40.6728},
		{-73.4692, 40.6768}, {-73.3712, 40.6882}, {-73.3248, 40.7005},
	}
	ronkEast := [][]float64{
		{-73.8085, 40.6996}, {-73.7364, 40.7175}, {-73.7062, 40.7245},
		{-73.6410, 40.7403}, {-73.5255, 40.7672}, {-73.4832, 40.7432},
		{-73.4418, 40.7358}, {-73.3388, 40.7548}, {-73.1948, 40.7918},
		{-73.1059, 40.8081},
	}

	return []auxiliaryCorridorDef{
		// Metro-North Railroad
		{
			agencyID: "MTA_METRO_NORTH", routeID: "1", bulletCode: "HUD", division: "MNR",
			lineName: "Metro-North Hudson Line", colorHex: "#009B3A",
			aliases: []string{"HUD", "HUDSON", "HUDSON LINE"},
			fallbackLines: [][][]float64{{
				{-73.9772, 40.7527}, {-73.9712, 40.7685}, {-73.9482, 40.7975}, {-73.9389, 40.8052},
				{-73.9303, 40.8255}, {-73.9195, 40.8542}, {-73.9125, 40.8745}, {-73.9218, 40.8789},
				{-73.9136, 40.9044}, {-73.9024, 40.9356}, {-73.8895, 40.9720}, {-73.8848, 40.9945},
				{-73.8685, 41.0385}, {-73.8655, 41.0765}, {-73.8698, 41.1558}, {-73.8825, 41.1897},
				{-73.9225, 41.2468}, {-73.9309, 41.2850}, {-73.9478, 41.3820}, {-73.9610, 41.4152},
				{-73.9845, 41.5055}, {-73.9472, 41.5866}, {-73.9380, 41.7072},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "2", bulletCode: "HAR", division: "MNR",
			lineName: "Metro-North Harlem Line", colorHex: "#0039A6",
			aliases: []string{"HAR", "HARLEM", "HARLEM LINE"},
			fallbackLines: [][][]float64{{
				{-73.9772, 40.7527}, {-73.9712, 40.7685}, {-73.9482, 40.7975}, {-73.9389, 40.8052},
				{-73.9154, 40.8257}, {-73.8997, 40.8472}, {-73.8905, 40.8615}, {-73.8820, 40.8670},
				{-73.8628, 40.8954}, {-73.8498, 40.9132}, {-73.8350, 40.9412}, {-73.8215, 40.9685},
				{-73.8065, 40.9899}, {-73.7995, 41.0112}, {-73.7752, 41.0338}, {-73.7728, 41.0518},
				{-73.7960, 41.1088}, {-73.7748, 41.1578}, {-73.7302, 41.2085}, {-73.6845, 41.2595},
				{-73.6772, 41.2942}, {-73.6198, 41.3948}, {-73.6231, 41.4126}, {-73.6005, 41.5645},
				{-73.5752, 41.7418}, {-73.5586, 41.7797},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "3", bulletCode: "NH", division: "MNR",
			lineName: "Metro-North New Haven Line", colorHex: "#EE0034",
			aliases: []string{"NH", "NEW_HAVEN", "NEW HAVEN", "NEW HAVEN LINE"},
			fallbackLines: [][][]float64{{
				{-73.9772, 40.7527}, {-73.9389, 40.8052}, {-73.8905, 40.8615}, {-73.8628, 40.8954},
				{-73.8318, 40.9120}, {-73.8102, 40.9130}, {-73.7843, 40.9114}, {-73.7598, 40.9334},
				{-73.7362, 40.9548}, {-73.6888, 40.9878}, {-73.6648, 41.0018}, {-73.6248, 41.0222},
				{-73.5678, 41.0332}, {-73.5426, 41.0468}, {-73.4758, 41.0782}, {-73.4218, 41.0955},
				{-73.3712, 41.1198}, {-73.2582, 41.1432}, {-73.1878, 41.1778}, {-73.1318, 41.1948},
				{-73.0582, 41.2225}, {-72.9632, 41.2712}, {-72.9265, 41.2974},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "4", bulletCode: "NC", division: "MNR",
			lineName: "Metro-North New Canaan Branch", colorHex: "#EE0034",
			aliases: []string{"NC", "NEW_CANAAN", "NEW CANAAN"},
			fallbackLines: [][][]float64{{
				{-73.5426, 41.0468}, {-73.5198, 41.0885}, {-73.4982, 41.1185}, {-73.4980, 41.1462},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "5", bulletCode: "DAN", division: "MNR",
			lineName: "Metro-North Danbury Branch", colorHex: "#EE0034",
			aliases: []string{"DAN", "DANBURY"},
			fallbackLines: [][][]float64{{
				{-73.4218, 41.0955}, {-73.4320, 41.1955}, {-73.4418, 41.2668}, {-73.4138, 41.3762}, {-73.4488, 41.3962},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "6", bulletCode: "WAT", division: "MNR",
			lineName: "Metro-North Waterbury Branch", colorHex: "#EE0034",
			aliases: []string{"WAT", "WATERBURY"},
			fallbackLines: [][][]float64{{
				{-73.1878, 41.1778}, {-73.1318, 41.1948}, {-73.0845, 41.3202}, {-73.0762, 41.3955}, {-73.0512, 41.4922}, {-73.0461, 41.5527},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "14", bulletCode: "PV", division: "MNR",
			lineName: "Metro-North Pascack Valley Line", colorHex: "#8E258D",
			aliases: []string{"PV", "PASC", "PASCACK", "PASCACK_VALLEY", "PASCACK VALLEY"},
			fallbackLines: [][][]float64{{
				{-74.0278, 40.7358}, {-74.0758, 40.7615}, {-74.0458, 40.8888}, {-74.0322, 40.9912},
				{-74.0218, 41.0588}, {-74.0135, 41.0908}, {-74.0438, 41.1132},
			}},
		},
		{
			agencyID: "MTA_METRO_NORTH", routeID: "15", bulletCode: "PJ", division: "MNR",
			lineName: "Metro-North Port Jervis Line", colorHex: "#FF7900",
			aliases: []string{"PJ", "MNBNP", "PORT_JERVIS", "PORT JERVIS"},
			fallbackLines: [][][]float64{{
				{-74.0278, 40.7358}, {-74.0758, 40.7615}, {-74.1155, 40.9792}, {-74.1422, 41.0568},
				{-74.1538, 41.1158}, {-74.1852, 41.1945}, {-74.1462, 41.3075}, {-74.1185, 41.4368},
				{-74.2652, 41.4542}, {-74.3855, 41.4682}, {-74.5362, 41.4722}, {-74.6928, 41.3748},
			}},
		},
		// Long Island Rail Road (1..13)
		{
			agencyID: "MTA_LIRR", routeID: "1", bulletCode: "BAB", division: "LIRR",
			lineName: "LIRR Babylon Branch", colorHex: "#00985F",
			aliases:       []string{"BAB", "BABYLON", "BABYLON BRANCH"},
			fallbackLines: withTerminals(babylonEast),
		},
		{
			agencyID: "MTA_LIRR", routeID: "2", bulletCode: "HEM", division: "LIRR",
			lineName: "LIRR Hempstead Branch", colorHex: "#CE8E00",
			aliases: []string{"HEM", "HEMPSTEAD", "HEMPSTEAD BRANCH"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.7364, 40.7175}, {-73.7062, 40.7245}, {-73.6395, 40.7232}, {-73.6262, 40.7132},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "3", bulletCode: "OB", division: "LIRR",
			lineName: "LIRR Oyster Bay Branch", colorHex: "#00AF3F",
			aliases: []string{"OB", "OYSTER_BAY", "OYSTER BAY"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.7364, 40.7175}, {-73.6410, 40.7403},
				{-73.6432, 40.7915}, {-73.6262, 40.8522}, {-73.6002, 40.8742}, {-73.5318, 40.8752},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "4", bulletCode: "RON", division: "LIRR",
			lineName: "LIRR Ronkonkoma Branch", colorHex: "#A626AA",
			aliases:       []string{"RON", "RONKONKOMA", "RONKONKOMA BRANCH"},
			fallbackLines: withTerminals(ronkEast),
		},
		{
			agencyID: "MTA_LIRR", routeID: "5", bulletCode: "MTK", division: "LIRR",
			lineName: "LIRR Montauk Branch", colorHex: "#00B2A9",
			aliases: []string{"MTK", "MONTAUK"},
			fallbackLines: withTerminals(append(append([][]float64{}, babylonEast...),
				[]float64{-73.2452, 40.7302}, []float64{-73.0158, 40.7618}, []float64{-72.7052, 40.8212},
				[]float64{-72.3985, 40.8948}, []float64{-72.1932, 40.9642}, []float64{-71.9532, 41.0472},
			)),
		},
		{
			agencyID: "MTA_LIRR", routeID: "6", bulletCode: "LB", division: "LIRR",
			lineName: "LIRR Long Beach Branch", colorHex: "#FF6319",
			aliases: []string{"LB", "LONG_BEACH", "LONG BEACH"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.6762, 40.6562}, {-73.6542, 40.6258}, {-73.6558, 40.6002}, {-73.6625, 40.5892},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "7", bulletCode: "FR", division: "LIRR",
			lineName: "LIRR Far Rockaway Branch", colorHex: "#6E3219",
			aliases: []string{"FR", "FAR_ROCKAWAY", "FAR ROCKAWAY"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.7652, 40.6752}, {-73.7048, 40.6615}, {-73.7295, 40.6158}, {-73.7505, 40.6088},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "8", bulletCode: "WH", division: "LIRR",
			lineName: "LIRR West Hempstead Branch", colorHex: "#00A1DE",
			aliases: []string{"WH", "WEST_HEMPSTEAD", "WEST HEMPSTEAD"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.7048, 40.6615}, {-73.6788, 40.6752}, {-73.6415, 40.7018},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "9", bulletCode: "PW", division: "LIRR",
			lineName: "LIRR Port Washington Branch", colorHex: "#C60C30",
			aliases: []string{"PW", "PORT_WASHINGTON", "PORT WASHINGTON"},
			fallbackLines: [][][]float64{
				{
					{-73.9936, 40.7506}, {-73.9745, 40.7438}, {-73.9515, 40.7428}, {-73.9325, 40.7468},
					{-73.9225, 40.7472}, {-73.9030, 40.7458}, {-73.8456, 40.7525}, {-73.8305, 40.7580},
					{-73.7712, 40.7632}, {-73.7260, 40.7873}, {-73.6998, 40.7968}, {-73.6873, 40.8294},
				},
				{
					{-73.9772, 40.7527}, {-73.9755, 40.7552}, {-73.9707, 40.7615}, {-73.9658, 40.7646},
					{-73.9577, 40.7610}, {-73.9484, 40.7569}, {-73.9417, 40.7536}, {-73.9360, 40.7506},
					{-73.9305, 40.7484}, {-73.9225, 40.7472}, {-73.9030, 40.7458}, {-73.8456, 40.7525},
					{-73.8305, 40.7580}, {-73.7712, 40.7632}, {-73.7260, 40.7873}, {-73.6998, 40.7968},
					{-73.6873, 40.8294},
				},
			},
		},
		{
			agencyID: "MTA_LIRR", routeID: "10", bulletCode: "PJF", division: "LIRR",
			lineName: "LIRR Port Jefferson Branch", colorHex: "#0039A6",
			aliases: []string{"PJF", "PORT_JEFFERSON", "PORT JEFFERSON", "HUNTINGTON"},
			fallbackLines: withTerminals([][]float64{
				{-73.8085, 40.6996}, {-73.6410, 40.7403}, {-73.5255, 40.7672}, {-73.5005, 40.8248},
				{-73.4518, 40.8352}, {-73.4108, 40.8528}, {-73.3282, 40.8808}, {-73.1982, 40.8562},
				{-73.1285, 40.9202}, {-73.0532, 40.9348},
			}),
		},
		{
			agencyID: "MTA_LIRR", routeID: "11", bulletCode: "BEL", division: "LIRR",
			lineName: "LIRR Belmont Park Branch", colorHex: "#60269E",
			aliases: []string{"BEL", "BELMONT"},
			fallbackLines: [][][]float64{{
				{-73.8085, 40.6996}, {-73.7364, 40.7175}, {-73.7283, 40.7137},
			}},
		},
		{
			agencyID: "MTA_LIRR", routeID: "12", bulletCode: "CTZ", division: "LIRR",
			lineName: "LIRR City Terminal Zone", colorHex: "#4D5357",
			aliases:       []string{"CTZ", "CITY_TERMINAL", "CITY TERMINAL ZONE"},
			fallbackLines: [][][]float64{pennToJamaica, gcmToJamaica, atlToJamaica},
		},
		{
			agencyID: "MTA_LIRR", routeID: "13", bulletCode: "GPT", division: "LIRR",
			lineName: "LIRR Greenport Branch", colorHex: "#A626AA",
			aliases: []string{"GPT", "GREENPORT"},
			fallbackLines: withTerminals(append(append([][]float64{}, ronkEast...),
				[]float64{-72.9995, 40.8173}, []float64{-72.9158, 40.8256}, []float64{-72.6669, 40.9197},
				[]float64{-72.5361, 40.9917}, []float64{-72.4281, 41.0664}, []float64{-72.3636, 41.1008},
			)),
		},
		// Port Authority PATH
		{
			agencyID: "PORT_AUTHORITY_PATH", routeID: "NWK-WTC", bulletCode: "NWK", division: "PATH",
			lineName: "PATH Newark - World Trade Center", colorHex: "#D93A30",
			aliases: []string{"NWK", "862", "PATH:NWK-WTC"},
			fallbackLines: [][][]float64{{
				{-74.1642, 40.7345}, {-74.1559, 40.7394}, {-74.1220, 40.7418}, {-74.0920, 40.7385},
				{-74.0629, 40.7330}, {-74.0431, 40.7197}, {-74.0324, 40.7168}, {-74.0119, 40.7127},
			}},
		},
		{
			agencyID: "PORT_AUTHORITY_PATH", routeID: "JSQ-33", bulletCode: "JSQ", division: "PATH",
			lineName: "PATH Journal Square - 33rd Street", colorHex: "#F9A51A",
			aliases: []string{"JSQ", "JSQ-33 (VIA HOB)", "861", "1024", "PATH:JSQ-33"},
			fallbackLines: [][][]float64{
				{
					{-74.0629, 40.7330}, {-74.0431, 40.7197}, {-74.0338, 40.7270}, {-74.0155, 40.7315},
					{-74.0071, 40.7330}, {-73.9991, 40.7342}, {-73.9968, 40.7374}, {-73.9928, 40.7429}, {-73.9883, 40.7491},
				},
				{
					{-74.0629, 40.7330}, {-74.0431, 40.7197}, {-74.0338, 40.7270}, {-74.0279, 40.7359},
					{-74.0071, 40.7330}, {-73.9991, 40.7342}, {-73.9968, 40.7374}, {-73.9928, 40.7429}, {-73.9883, 40.7491},
				},
			},
		},
		{
			agencyID: "PORT_AUTHORITY_PATH", routeID: "HOB-33", bulletCode: "H33", division: "PATH",
			lineName: "PATH Hoboken - 33rd Street", colorHex: "#4D92FB",
			aliases: []string{"H33", "859", "PATH:HOB-33"},
			fallbackLines: [][][]float64{{
				{-74.0279, 40.7359}, {-74.0185, 40.7322}, {-74.0071, 40.7330},
				{-73.9991, 40.7342}, {-73.9968, 40.7374}, {-73.9928, 40.7429}, {-73.9883, 40.7491},
			}},
		},
		{
			agencyID: "PORT_AUTHORITY_PATH", routeID: "HOB-WTC", bulletCode: "HWT", division: "PATH",
			lineName: "PATH Hoboken - World Trade Center", colorHex: "#65C100",
			aliases: []string{"HWT", "860", "PATH:HOB-WTC"},
			fallbackLines: [][][]float64{{
				{-74.0279, 40.7359}, {-74.0338, 40.7270}, {-74.0324, 40.7168}, {-74.0225, 40.7145}, {-74.0119, 40.7127},
			}},
		},
		// NJ Transit Rail (Northeast Corridor)
		{
			agencyID: "NJ_TRANSIT", routeID: "NEC", bulletCode: "NEC", division: "NJT",
			lineName: "NJ Transit Northeast Corridor", colorHex: "#DD3439",
			aliases: []string{"10"},
			fallbackLines: [][][]float64{{
				{-73.9936, 40.7506}, {-74.0080, 40.7580}, {-74.0260, 40.7680}, {-74.0758, 40.7615},
				{-74.1645, 40.7345}, {-74.1920, 40.6920}, {-74.2180, 40.6680}, {-74.2720, 40.6080},
				{-74.3620, 40.5420}, {-74.4420, 40.4980},
			}},
		},
		// MTA Select Bus Service (M60-SBS & M60+)
		{
			agencyID: "MTA_BUS", routeID: "M60-SBS", bulletCode: "M60", division: "SBS",
			lineName: "M60 Select Bus Service (106 St / Broadway - 125 St - LaGuardia Airport)", colorHex: "#0078C6",
			aliases: []string{"M60", "M60+", "MTA NYCT_M60+", "MTABC_M60+"},
			fallbackLines: [][][]float64{{
				{-73.9688, 40.8014}, {-73.9665, 40.8042}, {-73.9628, 40.8078}, {-73.9605, 40.8108},
				{-73.9584, 40.8156}, {-73.9523, 40.8111}, {-73.9455, 40.8078}, {-73.9389, 40.8052},
				{-73.9376, 40.8041}, {-73.9325, 40.8022}, {-73.9278, 40.8005}, {-73.9225, 40.7932},
				{-73.9248, 40.7785}, {-73.9178, 40.7703}, {-73.9098, 40.7682}, {-73.8872, 40.7632},
				{-73.8860, 40.7722}, {-73.8726, 40.7744}, {-73.8634, 40.7702},
			}},
		},
		{
			agencyID: "MTA_BUS", routeID: "M60+", bulletCode: "M60", division: "SBS",
			lineName: "M60 Select Bus Service (106 St / Broadway - 125 St - LaGuardia Airport)", colorHex: "#0078C6",
			aliases: []string{"M60", "M60-SBS", "MTA NYCT_M60+", "MTABC_M60+"},
			fallbackLines: [][][]float64{{
				{-73.9688, 40.8014}, {-73.9665, 40.8042}, {-73.9628, 40.8078}, {-73.9605, 40.8108},
				{-73.9584, 40.8156}, {-73.9523, 40.8111}, {-73.9455, 40.8078}, {-73.9389, 40.8052},
				{-73.9376, 40.8041}, {-73.9325, 40.8022}, {-73.9278, 40.8005}, {-73.9225, 40.7932},
				{-73.9248, 40.7785}, {-73.9178, 40.7703}, {-73.9098, 40.7682}, {-73.8872, 40.7632},
				{-73.8860, 40.7722}, {-73.8726, 40.7744}, {-73.8634, 40.7702},
			}},
		},
	}
}

func (p *MTAServiceLinesPlugin) fetchRegionalAndBusServiceLines(ctx context.Context) []stagedServiceLineRow {
	defs := canonicalAuxiliaryCorridorDefs()
	liveByKey := make(map[string][][][]float64)

	// Only attempt remote GTFS fetches when p.URL is the live default (or custom http without localhost test mock)
	allowRemoteGTFS := p.URL == "" || p.URL == DefaultMTAServiceLinesURL || !strings.Contains(p.URL, "127.0.0.1")
	if allowRemoteGTFS {
		// 1. LIRR GTFS shapes
		if zipBytes, err := p.httpGet(ctx, "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip"); err == nil {
			byRoute := extractGTFSRouteShapes(zipBytes, 0.00025)
			for rid, chains := range byRoute {
				// Extend Grand Central Madison northern stub south to 42nd St concourse (-73.97723, 40.75273)
				for ci := range chains {
					ch := chains[ci]
					if len(ch) >= 2 {
						first := ch[0]
						last := ch[len(ch)-1]
						if first[0] > -73.979 && first[0] < -73.973 && first[1] > 40.753 && first[1] < 40.758 {
							chains[ci] = append([][]float64{{-73.97723, 40.75273}}, ch...)
						} else if last[0] > -73.979 && last[0] < -73.973 && last[1] > 40.753 && last[1] < 40.758 {
							chains[ci] = append(ch, []float64{-73.97723, 40.75273})
						}
					}
				}
				liveByKey["MTA_LIRR:"+rid] = chains
			}
			// Ensure Greenport (13) also includes Ronkonkoma (4) trunk for continuous Western Terminal projection
			if gChains, ok := liveByKey["MTA_LIRR:13"]; ok {
				if rChains, okR := liveByKey["MTA_LIRR:4"]; okR {
					liveByKey["MTA_LIRR:13"] = append(gChains, rChains...)
				}
			}
		}

		// 2. Metro-North East-of-Hudson GTFS shapes
		if zipBytes, err := p.httpGet(ctx, "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip"); err == nil {
			byRoute := extractGTFSRouteShapes(zipBytes, 0.00025)
			for rid, chains := range byRoute {
				liveByKey["MTA_METRO_NORTH:"+rid] = chains
			}
		}

		// 3. NJ Transit Rail GTFS shapes (West-of-Hudson MNR 14=Pascack Valley, 6->15=Port Jervis, 10=NEC)
		if zipBytes, err := p.httpGet(ctx, "https://www.njtransit.com/rail_data.zip"); err == nil {
			byRoute := extractGTFSRouteShapes(zipBytes, 0.0003)
			if pv, ok := byRoute["14"]; ok && len(pv) > 0 {
				liveByKey["MTA_METRO_NORTH:14"] = pv
			}
			if pj, ok := byRoute["6"]; ok && len(pj) > 0 {
				liveByKey["MTA_METRO_NORTH:15"] = pj
			}
			if nec, ok := byRoute["10"]; ok && len(nec) > 0 {
				liveByKey["NJ_TRANSIT:NEC"] = nec
			}
		}

		// 4. Port Authority PATH GTFS shapes
		if zipBytes, err := p.httpGet(ctx, "https://data.trilliumtransit.com/gtfs/path-nj-us/path-nj-us.zip"); err == nil {
			byRoute := extractGTFSRouteShapes(zipBytes, 0.00015)
			if c, ok := byRoute["862"]; ok && len(c) > 0 {
				liveByKey["PORT_AUTHORITY_PATH:NWK-WTC"] = c
			}
			var jsq [][][]float64
			if c, ok := byRoute["861"]; ok {
				jsq = append(jsq, c...)
			}
			if c, ok := byRoute["1024"]; ok {
				jsq = append(jsq, c...)
			}
			if len(jsq) > 0 {
				liveByKey["PORT_AUTHORITY_PATH:JSQ-33"] = jsq
			}
			if c, ok := byRoute["859"]; ok && len(c) > 0 {
				liveByKey["PORT_AUTHORITY_PATH:HOB-33"] = c
			}
			if c, ok := byRoute["860"]; ok && len(c) > 0 {
				liveByKey["PORT_AUTHORITY_PATH:HOB-WTC"] = c
			}
		}

		// 5. MTA Bus M60+ GTFS shapes
		if zipBytes, err := p.httpGet(ctx, "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip"); err == nil {
			byRoute := extractGTFSRouteShapesFiltered(zipBytes, map[string]bool{"M60+": true}, 0.00015)
			if m60, ok := byRoute["M60+"]; ok && len(m60) > 0 {
				liveByKey["MTA_BUS:M60-SBS"] = m60
				liveByKey["MTA_BUS:M60+"] = m60
			}
		}
	}

	out := make([]stagedServiceLineRow, 0, len(defs))
	for _, d := range defs {
		key := d.agencyID + ":" + d.routeID
		chains := liveByKey[key]
		if len(chains) == 0 {
			chains = d.fallbackLines
		}
		row, err := makeStagedServiceLineRow(
			key,
			d.agencyID,
			d.routeID,
			d.bulletCode,
			d.division,
			d.lineName,
			d.colorHex,
			chains,
			false,
			0,
			map[string]interface{}{
				"bullet_code": d.bulletCode,
				"aliases":     d.aliases,
			},
		)
		if err == nil && len(row.GeomWKT) > 0 {
			out = append(out, row)
		}
	}
	return out
}

func extractGTFSRouteShapes(zipBytes []byte, rdpTol float64) map[string][][][]float64 {
	return extractGTFSRouteShapesFiltered(zipBytes, nil, rdpTol)
}

func extractGTFSRouteShapesFiltered(zipBytes []byte, filterRoutes map[string]bool, rdpTol float64) map[string][][][]float64 {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil
	}
	files := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		files[f.Name] = f
	}
	tf, okT := files["trips.txt"]
	sf, okS := files["shapes.txt"]
	if !okT || !okS {
		return nil
	}

	routeShapes := make(map[string]map[string]bool)
	neededShapes := make(map[string]bool)
	readZipCSV(tf, func(hdr map[string]int, row []string) {
		rid := getCSV(row, hdr, "route_id")
		sid := getCSV(row, hdr, "shape_id")
		if rid == "" || sid == "" {
			return
		}
		if filterRoutes != nil && !filterRoutes[rid] {
			return
		}
		if routeShapes[rid] == nil {
			routeShapes[rid] = make(map[string]bool)
		}
		routeShapes[rid][sid] = true
		neededShapes[sid] = true
	})
	if len(neededShapes) == 0 {
		return nil
	}

	type seqPt struct {
		seq int
		lon float64
		lat float64
	}
	rawShapes := make(map[string][]seqPt)
	readZipCSV(sf, func(hdr map[string]int, row []string) {
		sid := getCSV(row, hdr, "shape_id")
		if !neededShapes[sid] {
			return
		}
		seq, err1 := strconv.Atoi(getCSV(row, hdr, "shape_pt_sequence"))
		lat, err2 := strconv.ParseFloat(getCSV(row, hdr, "shape_pt_lat"), 64)
		lon, err3 := strconv.ParseFloat(getCSV(row, hdr, "shape_pt_lon"), 64)
		if err1 != nil || err2 != nil || err3 != nil {
			return
		}
		rawShapes[sid] = append(rawShapes[sid], seqPt{seq: seq, lon: lon, lat: lat})
	})

	orderedShapes := make(map[string][][]float64, len(rawShapes))
	for sid, pts := range rawShapes {
		sort.Slice(pts, func(i, j int) bool { return pts[i].seq < pts[j].seq })
		coords := make([][]float64, 0, len(pts))
		for _, p := range pts {
			coords = append(coords, []float64{p.lon, p.lat})
		}
		if len(coords) >= 2 {
			orderedShapes[sid] = coords
		}
	}

	out := make(map[string][][][]float64, len(routeShapes))
	for rid, sids := range routeShapes {
		cands := make([][][]float64, 0, len(sids))
		for sid := range sids {
			if ch, ok := orderedShapes[sid]; ok {
				cands = append(cands, ch)
			}
		}
		deduped := deduplicateContiguousCorridorChains(cands, rdpTol)
		if len(deduped) > 0 {
			out[rid] = deduped
		}
	}
	return out
}

func deduplicateContiguousCorridorChains(rawChains [][][]float64, rdpTol float64) [][][]float64 {
	type sigKey struct {
		ax, ay, mx, my, bx, by int
	}
	bySig := make(map[sigKey][][]float64)
	for _, ch := range rawChains {
		if len(ch) < 2 {
			continue
		}
		a, b := ch[0], ch[len(ch)-1]
		oriented := ch
		if (a[0] > b[0]+0.005) || (math.Abs(a[0]-b[0]) <= 0.005 && a[1] > b[1]) {
			oriented = reverseCoords(ch)
			a, b = oriented[0], oriented[len(oriented)-1]
		}
		mid := oriented[len(oriented)/2]
		sig := sigKey{
			ax: int(math.Round(a[0] * 100)),
			ay: int(math.Round(a[1] * 100)),
			mx: int(math.Round(mid[0] * 10)),
			my: int(math.Round(mid[1] * 10)),
			bx: int(math.Round(b[0] * 100)),
			by: int(math.Round(b[1] * 100)),
		}
		if prev, exists := bySig[sig]; !exists || len(oriented) > len(prev) {
			bySig[sig] = oriented
		}
	}

	cands := make([][][]float64, 0, len(bySig))
	for _, ch := range bySig {
		cands = append(cands, ch)
	}
	sort.Slice(cands, func(i, j int) bool { return len(cands[i]) > len(cands[j]) })

	var kept [][][]float64
	for _, ch := range cands {
		a, mid, b := ch[0], ch[len(ch)/2], ch[len(ch)-1]
		subsumed := false
		for _, big := range kept {
			if nearAnyPoint(big, a, 0.008) && nearAnyPoint(big, mid, 0.008) && nearAnyPoint(big, b, 0.008) {
				subsumed = true
				break
			}
		}
		if !subsumed {
			simp := simplifyDouglasPeucker(ch, rdpTol)
			if len(simp) >= 2 {
				kept = append(kept, simp)
			}
		}
	}
	return sanitizeMultiLines(kept)
}

func nearAnyPoint(chain [][]float64, target []float64, thresh float64) bool {
	for _, p := range chain {
		if ptDist(p, target) < thresh {
			return true
		}
	}
	return false
}

func readZipCSV(zf *zip.File, onRow func(hdr map[string]int, row []string)) {
	rc, err := zf.Open()
	if err != nil {
		return
	}
	defer rc.Close()
	r := csv.NewReader(rc)
	r.LazyQuotes = true
	r.FieldsPerRecord = -1
	hdrSlice, err := r.Read()
	if err != nil {
		return
	}
	hdr := make(map[string]int, len(hdrSlice))
	for i, h := range hdrSlice {
		hdr[strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))] = i
	}
	for {
		row, err := r.Read()
		if err != nil {
			break
		}
		onRow(hdr, row)
	}
}

func getCSV(row []string, hdr map[string]int, col string) string {
	idx, ok := hdr[col]
	if !ok || idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func parseToGeoJSONFeatures(rawBytes []byte) ([]geoJSONFeature, error) {
	var fc geoJSONFeatureCollection
	if err := json.Unmarshal(rawBytes, &fc); err == nil && len(fc.Features) > 0 {
		return fc.Features, nil
	}

	var env socrataV3Envelope
	if err := json.Unmarshal(rawBytes, &env); err == nil && len(env.Data) > 0 {
		return convertSocrataRowsToFeatures(env.Data)
	}

	var sodaRows []map[string]interface{}
	if err := json.Unmarshal(rawBytes, &sodaRows); err == nil && len(sodaRows) > 0 {
		return convertSocrataRowsToFeatures(sodaRows)
	}

	return nil, fmt.Errorf("unrecognized service lines JSON format")
}

func convertSocrataRowsToFeatures(rows []map[string]interface{}) ([]geoJSONFeature, error) {
	features := make([]geoJSONFeature, 0, len(rows))
	for _, r := range rows {
		var geomRaw json.RawMessage
		for _, gk := range []string{"the_geom", "geometry", "shape", "geom"} {
			if gv, ok := r[gk]; ok && gv != nil {
				if b, err := json.Marshal(gv); err == nil {
					geomRaw = b
					break
				}
			}
		}
		if len(geomRaw) == 0 {
			continue
		}
		features = append(features, geoJSONFeature{
			Type:       "Feature",
			Properties: r,
			Geometry:   geomRaw,
		})
	}
	return features, nil
}

func splitRouteTokens(raw string) []string {
	cleaned := strings.ToUpper(strings.TrimSpace(raw))
	if cleaned == "" {
		return nil
	}
	replacer := strings.NewReplacer("/", " ", "-", " ", ",", " ", ";", " ", "(", " ", ")", " ")
	parts := strings.Fields(replacer.Replace(cleaned))
	var out []string
	seen := make(map[string]bool)
	addTok := func(t string) {
		if t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	for _, p := range parts {
		tok := strings.TrimPrefix(strings.TrimSuffix(p, ">"), "<")
		if tok == "" || tok == "PEAK" {
			continue
		}
		switch tok {
		case "ST":
			addTok("S")
			addTok("GS")
		case "SF":
			addTok("FS")
		case "SR":
			addTok("H")
		case "SIR":
			addTok("SI")
			addTok("SIR")
		default:
			addTok(tok)
		}
	}
	return out
}

func inferDivision(routeID string) string {
	switch routeID {
	case "1", "2", "3", "4", "5", "6", "6X", "7", "7X", "S", "GS":
		return "IRT"
	case "A", "B", "C", "D", "E", "F", "FX", "G", "H":
		return "IND"
	case "SI", "SIR":
		return "SIR"
	default:
		return "BMT"
	}
}

func extractMultiLineCoordinates(rawGeom json.RawMessage) ([][][]float64, error) {
	var g geoJSONGeometry
	if err := json.Unmarshal(rawGeom, &g); err != nil {
		return nil, err
	}

	switch g.Type {
	case "MultiLineString":
		var multi [][][]float64
		if err := json.Unmarshal(g.Coordinates, &multi); err != nil {
			return nil, err
		}
		var valid [][][]float64
		for _, line := range multi {
			if len(line) >= 2 {
				valid = append(valid, line)
			}
		}
		return valid, nil
	case "LineString":
		var line [][]float64
		if err := json.Unmarshal(g.Coordinates, &line); err != nil {
			return nil, err
		}
		if len(line) < 2 {
			return nil, fmt.Errorf("LineString has fewer than 2 points")
		}
		return [][][]float64{line}, nil
	default:
		return nil, fmt.Errorf("unsupported geometry type %q", g.Type)
	}
}

func formatMultiLineStringWKT(lines [][][]float64) string {
	lineStrs := make([]string, 0, len(lines))
	for _, line := range lines {
		ptStrs := make([]string, 0, len(line))
		for _, pt := range line {
			if len(pt) >= 2 {
				ptStrs = append(ptStrs, fmt.Sprintf("%v %v", pt[0], pt[1]))
			}
		}
		if len(ptStrs) >= 2 {
			lineStrs = append(lineStrs, "("+strings.Join(ptStrs, ", ")+")")
		}
	}
	return "MULTILINESTRING (" + strings.Join(lineStrs, ", ") + ")"
}

func stitchAndSimplifyRawLines(lines [][][]float64) [][][]float64 {
	totalVertices := 0
	for _, c := range lines {
		totalVertices += len(c)
	}
	if totalVertices <= 500 {
		return lines
	}

	const eps = 0.0005
	pool := make([][][]float64, 0, len(lines))
	for _, c := range lines {
		if len(c) >= 2 {
			cp := make([][]float64, len(c))
			copy(cp, c)
			pool = append(pool, cp)
		}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		return len(pool[i]) > len(pool[j])
	})

	changed := true
	for changed {
		changed = false
		for i := 0; i < len(pool) && !changed; i++ {
			for j := i + 1; j < len(pool) && !changed; j++ {
				a := pool[i]
				b := pool[j]
				aStart, aEnd := a[0], a[len(a)-1]
				bStart, bEnd := b[0], b[len(b)-1]
				if ptDist(aEnd, bStart) <= eps {
					pool[i] = append(a, b[1:]...)
					pool = append(pool[:j], pool[j+1:]...)
					changed = true
				} else if ptDist(aEnd, bEnd) <= eps {
					rev := reverseCoords(b[:len(b)-1])
					pool[i] = append(a, rev...)
					pool = append(pool[:j], pool[j+1:]...)
					changed = true
				} else if ptDist(bEnd, aStart) <= eps {
					pool[i] = append(b, a[1:]...)
					pool = append(pool[:j], pool[j+1:]...)
					changed = true
				} else if ptDist(aStart, bStart) <= eps {
					rev := reverseCoords(b[1:])
					pool[i] = append(rev, a...)
					pool = append(pool[:j], pool[j+1:]...)
					changed = true
				}
			}
		}
	}

	out := make([][][]float64, 0, len(pool))
	for _, c := range pool {
		simp := simplifyDouglasPeucker(c, 0.00004)
		for k := range simp {
			simp[k] = []float64{
				math.Round(simp[k][0]*1e5) / 1e5,
				math.Round(simp[k][1]*1e5) / 1e5,
			}
		}
		if len(simp) >= 2 {
			out = append(out, simp)
		}
	}
	return out
}

func ptDist(a, b []float64) float64 {
	if len(a) < 2 || len(b) < 2 {
		return math.Inf(1)
	}
	return math.Hypot(a[0]-b[0], a[1]-b[1])
}

func reverseCoords(pts [][]float64) [][]float64 {
	out := make([][]float64, len(pts))
	for i := range pts {
		out[len(pts)-1-i] = pts[i]
	}
	return out
}

func simplifyDouglasPeucker(pts [][]float64, tol float64) [][]float64 {
	if len(pts) <= 2 {
		return pts
	}
	maxD := 0.0
	idx := 0
	p1, p2 := pts[0], pts[len(pts)-1]
	dx := p2[0] - p1[0]
	dy := p2[1] - p1[1]
	lenSq := dx*dx + dy*dy
	for i := 1; i < len(pts)-1; i++ {
		var d float64
		if lenSq == 0 {
			d = ptDist(pts[i], p1)
		} else {
			t := ((pts[i][0]-p1[0])*dx + (pts[i][1]-p1[1])*dy) / lenSq
			if t < 0 {
				t = 0
			} else if t > 1 {
				t = 1
			}
			d = math.Hypot(pts[i][0]-(p1[0]+t*dx), pts[i][1]-(p1[1]+t*dy))
		}
		if d > maxD {
			maxD = d
			idx = i
		}
	}
	if maxD > tol {
		left := simplifyDouglasPeucker(pts[:idx+1], tol)
		right := simplifyDouglasPeucker(pts[idx:], tol)
		return append(left[:len(left)-1], right...)
	}
	return [][]float64{p1, p2}
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
			switch val := v.(type) {
			case float64:
				f := val
				return &f
			case string:
				var parsed float64
				if _, err := fmt.Sscanf(val, "%f", &parsed); err == nil {
					return &parsed
				}
			}
		}
	}
	return nil
}

func (p *MTAServiceLinesPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(line_id VARCHAR, agency_id VARCHAR, route_id VARCHAR, service_name VARCHAR, division VARCHAR, line_name VARCHAR, color_hex VARCHAR, geom_wkt VARCHAR, geom_geojson VARCHAR, shape_leng DOUBLE, raw_payload JSON)"]')) AS s
			FROM %s
		),
		deduped AS (
			SELECT
				s.line_id,
				s.agency_id,
				s.route_id,
				s.service_name,
				s.division,
				s.line_name,
				s.color_hex,
				s.geom_wkt,
				s.geom_geojson,
				s.shape_leng,
				s.raw_payload::VARIANT AS raw_payload,
				ROW_NUMBER() OVER (PARTITION BY s.agency_id, s.route_id ORDER BY s.line_id ASC) AS rn
			FROM parsed
			WHERE s.route_id IS NOT NULL AND s.route_id != '' AND s.geom_wkt IS NOT NULL AND s.geom_wkt != ''
		)
		SELECT
			line_id,
			agency_id,
			route_id,
			service_name,
			division,
			line_name,
			color_hex,
			geom_wkt,
			geom_geojson,
			shape_leng,
			CURRENT_TIMESTAMP AS valid_from,
			CAST(NULL AS TIMESTAMPTZ) AS valid_to,
			true AS is_current,
			raw_payload
		FROM deduped
		WHERE rn = 1
	`, rawTable)
}

func (p *MTAServiceLinesPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.dim_service_lines AS cur
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		FROM (
			%s
		) AS src
		WHERE cur.agency_id = src.agency_id
		  AND cur.route_id = src.route_id
		  AND cur.is_current = true
		  AND (
			  cur.service_name IS DISTINCT FROM src.service_name
			  OR cur.geom_wkt IS DISTINCT FROM src.geom_wkt
			  OR cur.color_hex IS DISTINCT FROM src.color_hex
			  OR cur.raw_payload::VARCHAR IS DISTINCT FROM src.raw_payload::VARCHAR
		  );

		INSERT INTO transit_v2.dim_service_lines (
			line_id,
			agency_id,
			route_id,
			service_name,
			division,
			line_name,
			color_hex,
			geom_wkt,
			geom_geojson,
			shape_leng,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		)
		SELECT
			src.line_id,
			src.agency_id,
			src.route_id,
			src.service_name,
			src.division,
			src.line_name,
			src.color_hex,
			src.geom_wkt,
			src.geom_geojson,
			src.shape_leng,
			src.valid_from,
			src.valid_to,
			src.is_current,
			src.raw_payload
		FROM (
			%s
		) AS src
		LEFT JOIN transit_v2.dim_service_lines AS cur
		  ON cur.agency_id = src.agency_id
		 AND cur.route_id = src.route_id
		 AND cur.is_current = true
		WHERE cur.route_id IS NULL
		   OR cur.service_name IS DISTINCT FROM src.service_name
		   OR cur.geom_wkt IS DISTINCT FROM src.geom_wkt
		   OR cur.color_hex IS DISTINCT FROM src.color_hex
		   OR cur.raw_payload::VARCHAR IS DISTINCT FROM src.raw_payload::VARCHAR;
	`, p.TransformSelect(rawTable), p.TransformSelect(rawTable))
}
