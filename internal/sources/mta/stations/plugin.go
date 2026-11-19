package stations

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&MTAStationsPlugin{})
}

type MTAStationsPlugin struct {
	HTTPClient *http.Client
}

type stationRecord struct {
	StationID     string `json:"station_id"`
	AgencyID      string `json:"agency_id"`
	ComplexID     string `json:"complex_id,omitempty"`
	GTFSStopID    string `json:"gtfs_stop_id,omitempty"`
	StopName      string `json:"stop_name,omitempty"`
	StationName   string `json:"station_name,omitempty"`
	GTFSLatitude  string `json:"gtfs_latitude,omitempty"`
	GTFSLongitude string `json:"gtfs_longitude,omitempty"`
	Latitude      string `json:"latitude,omitempty"`
	Longitude     string `json:"longitude,omitempty"`
	Borough       string `json:"borough,omitempty"`
	DaytimeRoutes string `json:"daytime_routes,omitempty"`
	Line          string `json:"line,omitempty"`
	Structure     string `json:"structure,omitempty"`
	ADA           string `json:"ada,omitempty"`
	ADANotes      string `json:"ada_notes,omitempty"`
}

func (p *MTAStationsPlugin) ID() string {
	return "mta_stations"
}

func (p *MTAStationsPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTAStationsPlugin) TargetTable() string {
	return "dim_stations"
}

func (p *MTAStationsPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *MTAStationsPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

func (p *MTAStationsPlugin) Fetch(ctx context.Context) ([]byte, error) {
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	var allStations []stationRecord

	// 1. Fetch MTA NYC Subway & SIR stations from NY Open Data SODA endpoint (39hk-dx4f)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://data.ny.gov/resource/39hk-dx4f.json?$limit=1000", nil)
	if err == nil {
		req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
		req.Header.Set("Accept", "application/json, */*")
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var subwayList []stationRecord
			if json.Unmarshal(body, &subwayList) == nil {
				for i := range subwayList {
					subwayList[i].Latitude = strings.TrimSpace(firstNonEmpty(subwayList[i].Latitude, subwayList[i].GTFSLatitude))
					subwayList[i].Longitude = strings.TrimSpace(firstNonEmpty(subwayList[i].Longitude, subwayList[i].GTFSLongitude))
					subwayList[i].GTFSLatitude = strings.TrimSpace(firstNonEmpty(subwayList[i].GTFSLatitude, subwayList[i].Latitude))
					subwayList[i].GTFSLongitude = strings.TrimSpace(firstNonEmpty(subwayList[i].GTFSLongitude, subwayList[i].Longitude))
					if subwayList[i].AgencyID == "" {
						subwayList[i].AgencyID = "MTA_NYCT_SUBWAY"
					}
					allStations = append(allStations, subwayList[i])
					if subwayList[i].Borough == "SI" || strings.Contains(subwayList[i].DaytimeRoutes, "SIR") {
						sirCopy := subwayList[i]
						sirCopy.AgencyID = "MTA_NYCT_SIR"
						allStations = append(allStations, sirCopy)
					}
				}
			}
		} else if resp != nil {
			resp.Body.Close()
		}
	}

	// 2. Fetch all 127 official LIRR stops + served routes from gtfslirr.zip
	if lirrStops, err := fetchGTFSStops(ctx, client, "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip", "MTA_LIRR", gtfsStopParseOptions{
		ComplexPrefix: "LIRR_",
	}); err == nil && len(lirrStops) > 0 {
		allStations = append(allStations, lirrStops...)
	} else {
		allStations = append(allStations, fallbackLIRRStops()...)
	}

	// 3. Fetch all 114 East-of-Hudson Metro-North stops + served routes from gtfsmnr.zip
	if mnrStops, err := fetchGTFSStops(ctx, client, "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip", "MTA_METRO_NORTH", gtfsStopParseOptions{
		ComplexPrefix: "MNR_",
	}); err == nil && len(mnrStops) > 0 {
		allStations = append(allStations, mnrStops...)
	} else {
		allStations = append(allStations, fallbackMNRStops()...)
	}

	// 4. Fetch West-of-Hudson Metro-North stops (Pascack Valley=14, Port Jervis=15) & NJ Transit NEC stops from rail_data.zip
	if njtZip, err := fetchRawZip(ctx, client, "https://www.njtransit.com/rail_data.zip"); err == nil && len(njtZip) > 0 {
		if wohStops, err := parseStopsFromZip(njtZip, "MTA_METRO_NORTH", gtfsStopParseOptions{
			StationIDPrefix: "WOH_",
			ComplexPrefix:   "MNR_WOH_",
			TitleCaseNames:  true,
			RouteMapper: func(rawRouteID string, _ string) (string, bool) {
				switch rawRouteID {
				case "14":
					return "14", true
				case "6":
					return "15", true
				default:
					return "", false
				}
			},
		}); err == nil && len(wohStops) > 0 {
			allStations = append(allStations, wohStops...)
		}
		if necStops, err := parseStopsFromZip(njtZip, "NJ_TRANSIT", gtfsStopParseOptions{
			ComplexPrefix:  "NJT_",
			TitleCaseNames: true,
			RouteMapper: func(rawRouteID string, _ string) (string, bool) {
				if rawRouteID == "10" {
					return "NEC", true
				}
				return "", false
			},
		}); err == nil && len(necStops) > 0 {
			allStations = append(allStations, necStops...)
		}
	} else {
		allStations = append(allStations, fallbackWestOfHudsonStops()...)
	}

	// 5. Fetch NYC Ferry stops
	if ferryStops, err := fetchGTFSStops(ctx, client, "https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx", "NYC_FERRY", gtfsStopParseOptions{
		ComplexPrefix: "FERRY_",
	}); err == nil && len(ferryStops) > 0 {
		allStations = append(allStations, ferryStops...)
	} else {
		allStations = append(allStations, fallbackFerryStops()...)
	}

	// 6. Port Authority PATH stations (canonical RidePATH 3-letter codes + Trillium GTFS stops)
	allStations = append(allStations, fallbackPATHStops()...)
	if pathStops, err := fetchGTFSStops(ctx, client, "https://data.trilliumtransit.com/gtfs/path-nj-us/path-nj-us.zip", "PORT_AUTHORITY_PATH", gtfsStopParseOptions{
		ComplexPrefix: "PATH_",
		RouteMapper: func(rawRouteID string, _ string) (string, bool) {
			switch rawRouteID {
			case "862", "74320":
				return "NWK-WTC", true
			case "861", "1024":
				return "JSQ-33", true
			case "859":
				return "HOB-33", true
			case "860", "77285":
				return "HOB-WTC", true
			default:
				return rawRouteID, rawRouteID != ""
			}
		},
	}); err == nil && len(pathStops) > 0 {
		allStations = append(allStations, pathStops...)
	}

	// 7. MTA Select Bus Service (SBS) stops from gtfs_m.zip (including all 36 M60-SBS corridor stops)
	if busStops, err := fetchGTFSStops(ctx, client, "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip", "MTA_BUS", gtfsStopParseOptions{
		ComplexPrefix:  "BUS_",
		TitleCaseNames: true,
		RouteMapper: func(rawRouteID string, shortName string) (string, bool) {
			if rawRouteID == "M60+" || strings.EqualFold(shortName, "M60-SBS") {
				return "M60-SBS", true
			}
			if strings.HasSuffix(rawRouteID, "+") || strings.Contains(strings.ToUpper(shortName), "SBS") {
				if shortName != "" {
					return shortName, true
				}
				return strings.TrimSuffix(rawRouteID, "+") + "-SBS", true
			}
			return "", false
		},
	}); err == nil && len(busStops) > 0 {
		allStations = append(allStations, busStops...)
	} else {
		allStations = append(allStations, fallbackM60BusStops()...)
	}

	if len(allStations) == 0 {
		return nil, fmt.Errorf("failed to fetch stations from any transit provider")
	}

	return json.Marshal(allStations)
}

type gtfsStopParseOptions struct {
	StationIDPrefix string
	ComplexPrefix   string
	TitleCaseNames  bool
	RouteMapper     func(rawRouteID string, routeShortName string) (string, bool)
}

func fetchRawZip(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return io.ReadAll(resp.Body)
}

func fetchGTFSStops(ctx context.Context, client *http.Client, url string, agencyID string, opts gtfsStopParseOptions) ([]stationRecord, error) {
	body, err := fetchRawZip(ctx, client, url)
	if err != nil {
		return nil, err
	}
	return parseStopsFromZip(body, agencyID, opts)
}

func parseStopsFromZip(zipBytes []byte, agencyID string, opts gtfsStopParseOptions) ([]stationRecord, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, err
	}

	filesByName := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		filesByName[f.Name] = f
	}

	// 1. Optional route short_name map from routes.txt
	routeShortByID := make(map[string]string)
	if rf, ok := filesByName["routes.txt"]; ok {
		readCSVFile(rf, func(headers map[string]int, row []string) {
			rid := csvCol(row, headers, "route_id")
			if rid != "" {
				routeShortByID[rid] = csvCol(row, headers, "route_short_name")
			}
		})
	}

	// 2. Map trip_id -> mapped route_id from trips.txt
	tripRoute := make(map[string]string)
	hasRouteFilter := opts.RouteMapper != nil
	if tf, ok := filesByName["trips.txt"]; ok {
		readCSVFile(tf, func(headers map[string]int, row []string) {
			tid := csvCol(row, headers, "trip_id")
			rid := csvCol(row, headers, "route_id")
			if tid == "" || rid == "" {
				return
			}
			if opts.RouteMapper != nil {
				mapped, keep := opts.RouteMapper(rid, routeShortByID[rid])
				if !keep || mapped == "" {
					return
				}
				tripRoute[tid] = mapped
			} else {
				tripRoute[tid] = rid
			}
		})
	}

	// 3. Map stop_id -> set of served routes from stop_times.txt
	stopRoutesSet := make(map[string]map[string]struct{})
	if stf, ok := filesByName["stop_times.txt"]; ok && len(tripRoute) > 0 {
		readCSVFile(stf, func(headers map[string]int, row []string) {
			tid := csvCol(row, headers, "trip_id")
			rt, ok := tripRoute[tid]
			if !ok {
				return
			}
			sid := csvCol(row, headers, "stop_id")
			if sid == "" {
				return
			}
			s := stopRoutesSet[sid]
			if s == nil {
				s = make(map[string]struct{})
				stopRoutesSet[sid] = s
			}
			s[rt] = struct{}{}
		})
	}

	sf, ok := filesByName["stops.txt"]
	if !ok {
		return nil, fmt.Errorf("stops.txt not found")
	}

	var records []stationRecord
	readCSVFile(sf, func(headers map[string]int, row []string) {
		stopID := csvCol(row, headers, "stop_id")
		stopName := csvCol(row, headers, "stop_name")
		if stopID == "" || stopName == "" {
			return
		}

		servedSet := stopRoutesSet[stopID]
		if hasRouteFilter && len(servedSet) == 0 {
			return
		}

		lat := csvCol(row, headers, "stop_lat")
		lon := csvCol(row, headers, "stop_lon")
		parent := csvCol(row, headers, "parent_station")
		ada := csvCol(row, headers, "wheelchair_boarding")

		if opts.TitleCaseNames {
			stopName = formatStopDisplayName(stopName)
		}

		stationID := opts.StationIDPrefix + stopID
		complexBase := parent
		if complexBase == "" {
			complexBase = stopID
		}
		complexID := opts.ComplexPrefix + complexBase

		var daytimeRoutes string
		if len(servedSet) > 0 {
			rts := make([]string, 0, len(servedSet))
			for rt := range servedSet {
				rts = append(rts, rt)
			}
			sort.Strings(rts)
			daytimeRoutes = strings.Join(rts, ",")
		} else {
			daytimeRoutes = agencyID
		}

		records = append(records, stationRecord{
			StationID:     stationID,
			AgencyID:      agencyID,
			ComplexID:     complexID,
			GTFSStopID:    stationID,
			StopName:      stopName,
			StationName:   stopName,
			Latitude:      lat,
			Longitude:     lon,
			DaytimeRoutes: daytimeRoutes,
			Structure:     "At Grade",
			ADA:           ada,
		})
	})

	return records, nil
}

func readCSVFile(zf *zip.File, onRow func(headers map[string]int, row []string)) {
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
	headers := make(map[string]int, len(hdrSlice))
	for i, h := range hdrSlice {
		clean := strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))
		headers[clean] = i
	}
	for {
		row, err := r.Read()
		if err != nil {
			break
		}
		onRow(headers, row)
	}
}

func csvCol(row []string, headers map[string]int, col string) string {
	idx, ok := headers[col]
	if !ok || idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func formatStopDisplayName(raw string) string {
	s := strings.TrimSpace(raw)
	if s != strings.ToUpper(s) {
		return s
	}
	upperTokens := map[string]bool{
		"AV": true, "ST": true, "RD": true, "BLVD": true, "PKWY": true, "PLZ": true,
		"NW": true, "NE": true, "SW": true, "SE": true, "N": true, "S": true, "E": true, "W": true,
		"LGA": true, "JFK": true, "SBS": true, "RFK": true, "NY": true, "NJ": true,
	}
	var b strings.Builder
	wordStart := 0
	runes := []rune(s)
	flushWord := func(end int) {
		if end <= wordStart {
			return
		}
		w := string(runes[wordStart:end])
		switch w {
		case "AV":
			b.WriteString("Av")
		case "ST":
			b.WriteString("St")
		case "RD":
			b.WriteString("Rd")
		case "BLVD":
			b.WriteString("Blvd")
		case "PKWY":
			b.WriteString("Pkwy")
		case "PLZ":
			b.WriteString("Plz")
		default:
			if upperTokens[w] {
				b.WriteString(w)
			} else {
				wr := []rune(strings.ToLower(w))
				wr[0] = unicode.ToUpper(wr[0])
				b.WriteString(string(wr))
			}
		}
	}
	for i, ch := range runes {
		if !unicode.IsLetter(ch) && !unicode.IsDigit(ch) {
			flushWord(i)
			b.WriteRune(ch)
			wordStart = i + 1
		}
	}
	flushWord(len(runes))
	return b.String()
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if t := strings.TrimSpace(v); t != "" {
			return t
		}
	}
	return ""
}

func fallbackLIRRStops() []stationRecord {
	stns := []struct {
		id, name, lat, lon, routes string
	}{
		{"237", "Penn Station", "40.750588", "-73.993584", "1,2,3,4,5,6,7,8,9,10,12"},
		{"349", "Grand Central", "40.755162", "-73.975455", "1,2,4,6,7,8,9,10,12"},
		{"241", "Atlantic Terminal", "40.683596", "-73.975671", "1,2,4,6,7,8,10,12"},
		{"214", "Woodside", "40.745851", "-73.902975", "1,2,3,4,6,7,8,9,10,12"},
		{"55", "Forest Hills", "40.719500", "-73.844800", "1,2,3,4,6,7,8,10,12"},
		{"107", "Kew Gardens", "40.709600", "-73.830700", "1,2,3,4,6,7,8,10,12"},
		{"102", "Jamaica", "40.699608", "-73.808530", "1,2,3,4,5,6,7,8,10,11,12"},
		{"359", "Elmont-UBS Arena", "40.713100", "-73.725900", "2,4,10"},
		{"175", "Queens Village", "40.717500", "-73.736400", "2,3,4,10"},
		{"24", "Belmont Park", "40.713688", "-73.728297", "11"},
		{"89", "Mineola", "40.740269", "-73.641019", "3,4,5,10"},
		{"183", "Rockville Centre", "40.658300", "-73.646500", "1,5,6"},
		{"14", "Babylon", "40.700547", "-73.324831", "1,5"},
		{"179", "Ronkonkoma", "40.808100", "-73.105900", "4,13"},
		{"129", "Medford", "40.817300", "-72.999500", "4,13"},
		{"223", "Yaphank", "40.825600", "-72.915800", "4,13"},
		{"176", "Riverhead", "40.919700", "-72.666900", "4,13"},
		{"126", "Mattituck", "40.991700", "-72.536100", "4,13"},
		{"190", "Southold", "41.066400", "-72.428100", "4,13"},
		{"73", "Greenport", "41.100800", "-72.363600", "4,13"},
		{"131", "Great Neck", "40.787300", "-73.726000", "9"},
		{"162", "Plandome", "40.810500", "-73.695200", "9"},
		{"171", "Port Washington", "40.829400", "-73.687300", "9"},
		{"83", "Long Beach", "40.589839", "-73.655861", "6"},
	}
	res := make([]stationRecord, 0, len(stns))
	for _, s := range stns {
		res = append(res, stationRecord{
			StationID: s.id, AgencyID: "MTA_LIRR", ComplexID: "LIRR_" + s.id, GTFSStopID: s.id,
			StopName: s.name, StationName: s.name, Latitude: s.lat, Longitude: s.lon,
			DaytimeRoutes: s.routes, Structure: "At Grade", ADA: "1",
		})
	}
	return res
}

func fallbackMNRStops() []stationRecord {
	stns := []struct {
		id, name, lat, lon, routes string
	}{
		{"1", "Grand Central", "40.752998", "-73.977056", "1,2,3"},
		{"4", "Harlem-125 St", "40.805256", "-73.939222", "1,2,3"},
		{"16", "Riverdale", "40.904400", "-73.913900", "1"},
		{"8", "Yonkers", "40.935269", "-73.902269", "1"},
		{"57", "Botanical Garden", "40.867100", "-73.881900", "2"},
		{"58", "Williams Bridge", "40.878800", "-73.870600", "2"},
		{"59", "Woodlawn", "40.895400", "-73.862900", "2"},
		{"12", "White Plains", "41.033622", "-73.774519", "2"},
		{"94", "Brewster", "41.394700", "-73.619800", "2"},
		{"97", "Southeast", "41.412600", "-73.623100", "2"},
		{"98", "Patterson", "41.511700", "-73.604200", "2"},
		{"99", "Pawling", "41.564500", "-73.600300", "2"},
		{"100", "Appalachian Trail", "41.592500", "-73.588000", "2"},
		{"101", "Harlem Valley-Wingdale", "41.637200", "-73.571800", "2"},
		{"176", "Dover Plains", "41.741900", "-73.576100", "2"},
		{"177", "Wassaic", "41.779700", "-73.558600", "2"},
		{"24", "New Rochelle", "40.911369", "-73.784261", "3"},
		{"41", "Stamford", "41.046831", "-73.542569", "3,4"},
		{"133", "East Norwalk", "41.104000", "-73.404400", "3"},
		{"67", "New Haven", "41.297444", "-72.926511", "3"},
	}
	res := make([]stationRecord, 0, len(stns))
	for _, s := range stns {
		res = append(res, stationRecord{
			StationID: s.id, AgencyID: "MTA_METRO_NORTH", ComplexID: "MNR_" + s.id, GTFSStopID: s.id,
			StopName: s.name, StationName: s.name, Latitude: s.lat, Longitude: s.lon,
			DaytimeRoutes: s.routes, Structure: "At Grade", ADA: "1",
		})
	}
	return res
}

func fallbackWestOfHudsonStops() []stationRecord {
	stns := []struct {
		id, name, lat, lon, routes string
	}{
		{"WOH_HOB", "Hoboken Terminal", "40.735860", "-74.027930", "14,15"},
		{"WOH_SEC", "Secaucus Junction", "40.761200", "-74.075800", "14,15"},
		{"WOH_SV", "Spring Valley", "41.113200", "-74.043800", "14"},
		{"WOH_SUF", "Suffern", "41.114500", "-74.149200", "15"},
		{"WOH_PJ", "Port Jervis", "41.374800", "-74.692800", "15"},
	}
	res := make([]stationRecord, 0, len(stns))
	for _, s := range stns {
		res = append(res, stationRecord{
			StationID: s.id, AgencyID: "MTA_METRO_NORTH", ComplexID: "MNR_" + s.id, GTFSStopID: s.id,
			StopName: s.name, StationName: s.name, Latitude: s.lat, Longitude: s.lon,
			DaytimeRoutes: s.routes, Structure: "At Grade", ADA: "1",
		})
	}
	return res
}

func fallbackFerryStops() []stationRecord {
	stns := []struct {
		id, name, lat, lon, routes string
	}{
		{"1", "Wall St/Pier 11", "40.703217", "-74.006458", "ER,AS,SB,RW,SV,SG"},
		{"2", "East 34th Street", "40.744119", "-73.971556", "ER,AS,SV"},
		{"3", "DUMBO/Fulton Ferry", "40.703444", "-73.994278", "ER,SB"},
		{"4", "Astoria", "40.771806", "-73.935833", "AS"},
		{"5", "Soundview", "40.807889", "-73.864722", "SV"},
		{"6", "Rockaway", "40.584361", "-73.834611", "RW"},
		{"7", "St. George", "40.643611", "-74.072222", "SG"},
		{"8", "Corlears Hook", "40.712778", "-73.977222", "SB"},
		{"9", "Hunters Point South", "40.741944", "-73.962222", "ER"},
	}
	res := make([]stationRecord, 0, len(stns))
	for _, s := range stns {
		res = append(res, stationRecord{
			StationID: s.id, AgencyID: "NYC_FERRY", ComplexID: "FERRY_" + s.id, GTFSStopID: s.id,
			StopName: s.name, StationName: s.name, Latitude: s.lat, Longitude: s.lon,
			DaytimeRoutes: s.routes, Structure: "Pier", ADA: "1",
		})
	}
	return res
}

func fallbackPATHStops() []stationRecord {
	stns := []struct {
		id, name, lat, lon, routes string
	}{
		{"NWK", "Newark", "40.73454", "-74.16417", "NWK-WTC"},
		{"HAR", "Harrison", "40.73942", "-74.15587", "NWK-WTC"},
		{"JSQ", "Journal Square", "40.73301", "-74.06289", "NWK-WTC,JSQ-33"},
		{"GRV", "Grove Street", "40.71966", "-74.04312", "NWK-WTC,JSQ-33"},
		{"EXP", "Exchange Place", "40.71676", "-74.03238", "NWK-WTC,HOB-WTC"},
		{"WTC", "World Trade Center", "40.71271", "-74.01193", "NWK-WTC,HOB-WTC"},
		{"NEW", "Newport", "40.72699", "-74.03383", "JSQ-33,HOB-WTC"},
		{"HOB", "Hoboken", "40.73586", "-74.02793", "HOB-33,HOB-WTC"},
		{"CHR", "Christopher Street", "40.73295", "-74.00707", "JSQ-33,HOB-33"},
		{"09S", "9th Street", "40.73424", "-73.99910", "JSQ-33,HOB-33"},
		{"14S", "14th Street", "40.73735", "-73.99684", "JSQ-33,HOB-33"},
		{"23S", "23rd Street", "40.74290", "-73.99278", "JSQ-33,HOB-33"},
		{"33S", "33rd Street", "40.74912", "-73.98827", "JSQ-33,HOB-33"},
	}
	res := make([]stationRecord, 0, len(stns))
	for _, s := range stns {
		res = append(res, stationRecord{
			StationID:     s.id,
			AgencyID:      "PORT_AUTHORITY_PATH",
			ComplexID:     "PATH_" + s.id,
			GTFSStopID:    s.id,
			StopName:      s.name,
			StationName:   s.name,
			Latitude:      s.lat,
			Longitude:     s.lon,
			DaytimeRoutes: s.routes,
			Structure:     "Subway",
			ADA:           "1",
		})
	}
	return res
}

func fallbackM60BusStops() []stationRecord {
	stops := []struct {
		id, name, lat, lon string
	}{
		{"402018", "W 106 St / Broadway", "40.801424", "-73.968241"},
		{"403122", "Broadway / W 116 St", "40.807895", "-73.963813"},
		{"401442", "Amsterdam Av / W 120 St", "40.809585", "-73.958906"},
		{"402656", "W 125 St / St Nicholas Av", "40.810526", "-73.952174"},
		{"402658", "W 125 St / Malcolm X Blvd", "40.807700", "-73.945400"},
		{"402660", "E 125 St / Lexington Av", "40.804200", "-73.937500"},
		{"403673", "E 125 St / 2 Av", "40.802793", "-73.933781"},
		{"550320", "Astoria Blvd / 31 St", "40.770300", "-73.917800"},
		{"550324", "Astoria Blvd / Steinway St", "40.768100", "-73.910200"},
		{"550332", "Astoria Blvd / 82 St", "40.764600", "-73.889500"},
		{"553010", "LaGuardia Airport / Terminal A", "40.772300", "-73.885600"},
		{"553012", "LaGuardia Airport / Terminal B", "40.772941", "-73.872435"},
		{"553014", "LaGuardia Airport / Terminal C", "40.770200", "-73.863400"},
	}
	res := make([]stationRecord, 0, len(stops))
	for _, s := range stops {
		res = append(res, stationRecord{
			StationID:     s.id,
			AgencyID:      "MTA_BUS",
			ComplexID:     "BUS_" + s.id,
			GTFSStopID:    s.id,
			StopName:      s.name,
			StationName:   s.name,
			Latitude:      s.lat,
			Longitude:     s.lon,
			DaytimeRoutes: "M60-SBS",
			Structure:     "Street",
			ADA:           "1",
		})
	}
	return res
}

func (p *MTAStationsPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(station_id VARCHAR, agency_id VARCHAR, complex_id VARCHAR, gtfs_stop_id VARCHAR, stop_name VARCHAR, station_name VARCHAR, gtfs_latitude VARCHAR, gtfs_longitude VARCHAR, latitude VARCHAR, longitude VARCHAR, borough VARCHAR, daytime_routes VARCHAR, line VARCHAR, structure VARCHAR, ada VARCHAR, ada_notes VARCHAR)"]')) as s
			FROM %s
		),
		staged AS (
			SELECT
				COALESCE(s.station_id, s.gtfs_stop_id, s.complex_id, 'UNKNOWN') as station_id,
				COALESCE(s.agency_id, 'MTA_NYCT_SUBWAY') as agency_id,
				COALESCE(s.stop_name, s.station_name, 'Unknown Station') as name,
				TRY_CAST(TRIM(COALESCE(NULLIF(s.gtfs_latitude, ''), s.latitude)) AS DOUBLE) as latitude,
				TRY_CAST(TRIM(COALESCE(NULLIF(s.gtfs_longitude, ''), s.longitude)) AS DOUBLE) as longitude,
				COALESCE(s.gtfs_stop_id, s.station_id) as gtfs_stop_id,
				COALESCE(s.complex_id, s.station_id) as complex_id,
				COALESCE(s.daytime_routes, s.line) as daytime_routes,
				s.structure as structure,
				CASE WHEN COALESCE(s.ada, '0') IN ('1', '2') THEN true ELSE false END as is_accessible,
				to_json(s)::VARIANT as raw_payload,
				ROW_NUMBER() OVER (PARTITION BY COALESCE(s.station_id, s.gtfs_stop_id, s.complex_id, 'UNKNOWN'), COALESCE(s.agency_id, 'MTA_NYCT_SUBWAY') ORDER BY COALESCE(s.stop_name, s.station_name) DESC) as rn
			FROM parsed
			WHERE TRY_CAST(TRIM(COALESCE(NULLIF(s.gtfs_latitude, ''), s.latitude)) AS DOUBLE) IS NOT NULL
			  AND TRY_CAST(TRIM(COALESCE(NULLIF(s.gtfs_longitude, ''), s.longitude)) AS DOUBLE) IS NOT NULL
		)
		SELECT
			src.station_id,
			src.agency_id,
			src.name,
			src.latitude,
			src.longitude,
			src.gtfs_stop_id,
			src.complex_id,
			src.daytime_routes,
			src.structure,
			src.is_accessible,
			CURRENT_TIMESTAMP as valid_from,
			CAST(NULL AS TIMESTAMPTZ) as valid_to,
			true as is_current,
			src.raw_payload
		FROM staged src
		WHERE src.rn = 1
	`, rawTable)
}

func (p *MTAStationsPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.dim_stations
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		WHERE is_current = true
		  AND (station_id LIKE '%%_STN_%%' OR station_id LIKE 'BUS_STOP_%%' OR station_id LIKE 'LANDING_%%');

		UPDATE transit_v2.dim_stations AS cur
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		FROM (
			%s
		) AS raw
		WHERE cur.station_id = raw.station_id
		  AND cur.agency_id = raw.agency_id
		  AND cur.is_current = true
		  AND (
			  cur.name IS DISTINCT FROM raw.name
			  OR cur.latitude IS DISTINCT FROM raw.latitude
			  OR cur.longitude IS DISTINCT FROM raw.longitude
			  OR COALESCE(cur.daytime_routes, '') != COALESCE(raw.daytime_routes, '')
			  OR cur.is_accessible IS DISTINCT FROM raw.is_accessible
		  );

		INSERT INTO transit_v2.dim_stations (
			station_id,
			agency_id,
			name,
			latitude,
			longitude,
			gtfs_stop_id,
			complex_id,
			daytime_routes,
			structure,
			is_accessible,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		)
		WITH staged_sel AS (
			%s
		)
		SELECT
			src.station_id,
			src.agency_id,
			src.name,
			src.latitude,
			src.longitude,
			src.gtfs_stop_id,
			src.complex_id,
			src.daytime_routes,
			src.structure,
			src.is_accessible,
			src.valid_from,
			src.valid_to,
			src.is_current,
			src.raw_payload
		FROM staged_sel src
		LEFT JOIN transit_v2.dim_stations cur
		  ON cur.station_id = src.station_id
		 AND cur.agency_id = src.agency_id
		 AND cur.is_current = true
		WHERE cur.station_id IS NULL
		   OR cur.name IS DISTINCT FROM src.name
		   OR cur.latitude IS DISTINCT FROM src.latitude
		   OR cur.longitude IS DISTINCT FROM src.longitude
		   OR COALESCE(cur.daytime_routes, '') != COALESCE(src.daytime_routes, '')
		   OR cur.is_accessible IS DISTINCT FROM src.is_accessible;
	`, p.TransformSelect(rawTable), p.TransformSelect(rawTable))
}
