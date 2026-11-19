package path_gtfs

import (
	"context"
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

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"google.golang.org/protobuf/proto"
)

const (
	DefaultRidePATHURL      = "https://www.panynj.gov/bin/portauthority/ridepath.json"
	FallbackCommunityGTFSURL = "https://path.transitdata.nyc/gtfsrt"
)

func init() {
	plugin.Register(&PATHGTFSPlugin{})
}

type PATHGTFSPlugin struct{}

func (p *PATHGTFSPlugin) ID() string {
	return "path_gtfs_rt"
}

func (p *PATHGTFSPlugin) AgencyID() string {
	return "PORT_AUTHORITY_PATH"
}

func (p *PATHGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *PATHGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *PATHGTFSPlugin) DefaultInterval() time.Duration {
	return 20 * time.Second
}

type pathCoord struct {
	Lon float64
	Lat float64
}

type pathStationDef struct {
	Code string
	Name string
	Lon  float64
	Lat  float64
}

var canonicalPATHStations = map[string]pathStationDef{
	"NWK": {Code: "NWK", Name: "Newark", Lon: -74.16417, Lat: 40.73454},
	"HAR": {Code: "HAR", Name: "Harrison", Lon: -74.15587, Lat: 40.73942},
	"JSQ": {Code: "JSQ", Name: "Journal Square", Lon: -74.06289, Lat: 40.73301},
	"GRV": {Code: "GRV", Name: "Grove Street", Lon: -74.04312, Lat: 40.71966},
	"EXP": {Code: "EXP", Name: "Exchange Place", Lon: -74.03238, Lat: 40.71676},
	"WTC": {Code: "WTC", Name: "World Trade Center", Lon: -74.01193, Lat: 40.71271},
	"NEW": {Code: "NEW", Name: "Newport", Lon: -74.03383, Lat: 40.72699},
	"HOB": {Code: "HOB", Name: "Hoboken", Lon: -74.02793, Lat: 40.73586},
	"CHR": {Code: "CHR", Name: "Christopher Street", Lon: -74.00707, Lat: 40.73295},
	"09S": {Code: "09S", Name: "9th Street", Lon: -73.99910, Lat: 40.73424},
	"14S": {Code: "14S", Name: "14th Street", Lon: -73.99684, Lat: 40.73735},
	"23S": {Code: "23S", Name: "23rd Street", Lon: -73.99278, Lat: 40.74290},
	"33S": {Code: "33S", Name: "33rd Street", Lon: -73.98827, Lat: 40.74912},
}

// gtfsStopToPATHCode maps PANYNJ / Trillium static GTFS stop_id values and common aliases to canonical 3-char RidePATH station codes.
var gtfsStopToPATHCode = map[string]string{
	"NWK": "NWK", "26733": "NWK", "781741": "NWK", "781742": "NWK", "782492": "NWK",
	"HAR": "HAR", "26729": "HAR", "781718": "HAR", "781719": "HAR",
	"JSQ": "JSQ", "26731": "JSQ", "781726": "JSQ", "781727": "JSQ", "781728": "JSQ", "781729": "JSQ",
	"GRV": "GRV", "26728": "GRV", "781715": "GRV", "781716": "GRV",
	"EXP": "EXP", "26727": "EXP", "781712": "EXP", "781713": "EXP",
	"WTC": "WTC", "26734": "WTC", "781744": "WTC", "781745": "WTC", "781746": "WTC",
	"NEW": "NEW", "PAV": "NEW", "26732": "NEW", "781736": "NEW", "781737": "NEW",
	"HOB": "HOB", "26730": "HOB", "781721": "HOB", "781722": "HOB", "781723": "HOB",
	"CHR": "CHR", "26726": "CHR", "781709": "CHR", "781710": "CHR",
	"09S": "09S", "9TH": "09S", "09TH": "09S", "26722": "09S", "781697": "09S", "781698": "09S",
	"14S": "14S", "14TH": "14S", "26723": "14S", "781700": "14S", "781701": "14S",
	"23S": "23S", "23RD": "23S", "26724": "23S", "781703": "23S", "781704": "23S",
	"33S": "33S", "33RD": "33S", "26725": "33S", "781706": "33S", "781707": "33S",
}

func normalizePATHStopCode(raw string) string {
	clean := strings.ToUpper(strings.TrimSpace(raw))
	if clean == "" {
		return ""
	}
	if code, ok := gtfsStopToPATHCode[clean]; ok {
		return code
	}
	// Strip platform suffixes like NWK_1 or 26733N
	trimmed := strings.TrimRight(clean, "NSEW12345")
	if code, ok := gtfsStopToPATHCode[trimmed]; ok {
		return code
	}
	switch {
	case strings.Contains(clean, "NEWARK"):
		return "NWK"
	case strings.Contains(clean, "HARRISON"):
		return "HAR"
	case strings.Contains(clean, "JOURNAL"):
		return "JSQ"
	case strings.Contains(clean, "GROVE"):
		return "GRV"
	case strings.Contains(clean, "EXCHANGE"):
		return "EXP"
	case strings.Contains(clean, "WORLD TRADE") || clean == "WTC":
		return "WTC"
	case strings.Contains(clean, "NEWPORT") || strings.Contains(clean, "PAVONIA"):
		return "NEW"
	case strings.Contains(clean, "HOBOKEN"):
		return "HOB"
	case strings.Contains(clean, "CHRISTOPHER"):
		return "CHR"
	case strings.Contains(clean, "9TH") || strings.Contains(clean, "9 ST"):
		return "09S"
	case strings.Contains(clean, "14TH") || strings.Contains(clean, "14 ST"):
		return "14S"
	case strings.Contains(clean, "23RD") || strings.Contains(clean, "23 ST"):
		return "23S"
	case strings.Contains(clean, "33RD") || strings.Contains(clean, "33 ST"):
		return "33S"
	}
	return ""
}

type pathLegSpec struct {
	From        string
	To          string
	DurationSec int
	Waypoints   []pathCoord
}

// Directed inter-station geometries (ordered West-to-East / NJ-to-NY; reversed automatically for ToNJ).
var forwardLegPolylines = map[string]pathLegSpec{
	"NWK->HAR": {
		From: "NWK", To: "HAR", DurationSec: 120,
		Waypoints: []pathCoord{{-74.16417, 40.73454}, {-74.16020, 40.73720}, {-74.15587, 40.73942}},
	},
	"HAR->JSQ": {
		From: "HAR", To: "JSQ", DurationSec: 450,
		Waypoints: []pathCoord{
			{-74.15587, 40.73942},
			{-74.12200, 40.74180}, // Kearny / Meadows
			{-74.09200, 40.73850}, // Hackensack River Bridge
			{-74.06289, 40.73301},
		},
	},
	"JSQ->GRV": {
		From: "JSQ", To: "GRV", DurationSec: 210,
		Waypoints: []pathCoord{{-74.06289, 40.73301}, {-74.05180, 40.72520}, {-74.04312, 40.71966}},
	},
	"GRV->EXP": {
		From: "GRV", To: "EXP", DurationSec: 150,
		Waypoints: []pathCoord{{-74.04312, 40.71966}, {-74.03238, 40.71676}},
	},
	"EXP->WTC": {
		From: "EXP", To: "WTC", DurationSec: 210,
		Waypoints: []pathCoord{
			{-74.03238, 40.71676},
			{-74.02250, 40.71450}, // Downtown Hudson Tubes
			{-74.01193, 40.71271},
		},
	},
	"GRV->NEW": {
		From: "GRV", To: "NEW", DurationSec: 180,
		Waypoints: []pathCoord{{-74.04312, 40.71966}, {-74.03720, 40.72280}, {-74.03383, 40.72699}},
	},
	"NEW->EXP": {
		From: "NEW", To: "EXP", DurationSec: 150,
		Waypoints: []pathCoord{{-74.03383, 40.72699}, {-74.03310, 40.72180}, {-74.03238, 40.71676}},
	},
	"NEW->HOB": {
		From: "NEW", To: "HOB", DurationSec: 210,
		Waypoints: []pathCoord{{-74.03383, 40.72699}, {-74.03080, 40.73150}, {-74.02793, 40.73586}},
	},
	"NEW->CHR": {
		From: "NEW", To: "CHR", DurationSec: 300,
		Waypoints: []pathCoord{
			{-74.03383, 40.72699},
			{-74.02600, 40.72950}, // Uptown Hudson Tubes West
			{-74.01550, 40.73150}, // Morton St Portal
			{-74.00707, 40.73295},
		},
	},
	"HOB->CHR": {
		From: "HOB", To: "CHR", DurationSec: 270,
		Waypoints: []pathCoord{
			{-74.02793, 40.73586},
			{-74.01850, 40.73220}, // Uptown Hudson Tubes from Hoboken
			{-74.00707, 40.73295},
		},
	},
	"CHR->09S": {
		From: "CHR", To: "09S", DurationSec: 120,
		Waypoints: []pathCoord{{-74.00707, 40.73295}, {-73.99910, 40.73424}},
	},
	"09S->14S": {
		From: "09S", To: "14S", DurationSec: 90,
		Waypoints: []pathCoord{{-73.99910, 40.73424}, {-73.99684, 40.73735}},
	},
	"14S->23S": {
		From: "14S", To: "23S", DurationSec: 120,
		Waypoints: []pathCoord{{-73.99684, 40.73735}, {-73.99278, 40.74290}},
	},
	"23S->33S": {
		From: "23S", To: "33S", DurationSec: 120,
		Waypoints: []pathCoord{{-73.99278, 40.74290}, {-73.98827, 40.74912}},
	},
}

func getDirectedLeg(fromCode, toCode string) (pathLegSpec, bool) {
	if fwd, ok := forwardLegPolylines[fromCode+"->"+toCode]; ok {
		return fwd, true
	}
	if rev, ok := forwardLegPolylines[toCode+"->"+fromCode]; ok {
		pts := make([]pathCoord, len(rev.Waypoints))
		for i := range rev.Waypoints {
			pts[i] = rev.Waypoints[len(rev.Waypoints)-1-i]
		}
		return pathLegSpec{
			From:        fromCode,
			To:          toCode,
			DurationSec: rev.DurationSec,
			Waypoints:   pts,
		}, true
	}
	s1, ok1 := canonicalPATHStations[fromCode]
	s2, ok2 := canonicalPATHStations[toCode]
	if ok1 && ok2 {
		return pathLegSpec{
			From:        fromCode,
			To:          toCode,
			DurationSec: 180,
			Waypoints:   []pathCoord{{s1.Lon, s1.Lat}, {s2.Lon, s2.Lat}},
		}, true
	}
	return pathLegSpec{}, false
}

// routeStopsToNY returns the ordered NJ -> NY station sequence for a canonical PATH route (with optional via-Hoboken flag).
func routeStopsToNY(routeID string, viaHoboken bool) []string {
	switch routeID {
	case "NWK-WTC":
		return []string{"NWK", "HAR", "JSQ", "GRV", "EXP", "WTC"}
	case "HOB-33":
		return []string{"HOB", "CHR", "09S", "14S", "23S", "33S"}
	case "HOB-WTC":
		return []string{"HOB", "NEW", "EXP", "WTC"}
	case "JSQ-33":
		if viaHoboken {
			return []string{"JSQ", "GRV", "NEW", "HOB", "CHR", "09S", "14S", "23S", "33S"}
		}
		return []string{"JSQ", "GRV", "NEW", "CHR", "09S", "14S", "23S", "33S"}
	default:
		return []string{"NWK", "HAR", "JSQ", "GRV", "EXP", "WTC"}
	}
}

func directedStopSequence(routeID string, toNY bool, viaHoboken bool) []string {
	base := routeStopsToNY(routeID, viaHoboken)
	if toNY {
		out := make([]string, len(base))
		copy(out, base)
		return out
	}
	out := make([]string, len(base))
	for i := range base {
		out[i] = base[len(base)-1-i]
	}
	return out
}

func computeBearingDeg(lon1, lat1, lon2, lat2 float64) float64 {
	dLon := (lon2 - lon1) * math.Pi / 180.0
	phi1 := lat1 * math.Pi / 180.0
	phi2 := lat2 * math.Pi / 180.0
	y := math.Sin(dLon) * math.Cos(phi2)
	x := math.Cos(phi1)*math.Sin(phi2) - math.Sin(phi1)*math.Cos(phi2)*math.Cos(dLon)
	brng := math.Atan2(y, x) * 180.0 / math.Pi
	return math.Mod(brng+360.0, 360.0)
}

func haversineMeters(lon1, lat1, lon2, lat2 float64) float64 {
	const earthR = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthR * math.Asin(math.Sqrt(math.Max(0, math.Min(1, a))))
}

func interpolatePolyline(pts []pathCoord, frac float64) (lon, lat, bearing, totalMeters float64) {
	if len(pts) == 0 {
		return -74.03238, 40.71676, 90, 0
	}
	if len(pts) == 1 {
		return pts[0].Lon, pts[0].Lat, 90, 0
	}
	if frac < 0 {
		frac = 0
	}
	if frac > 1 {
		frac = 1
	}
	segLens := make([]float64, len(pts)-1)
	for i := 0; i < len(pts)-1; i++ {
		d := haversineMeters(pts[i].Lon, pts[i].Lat, pts[i+1].Lon, pts[i+1].Lat)
		segLens[i] = d
		totalMeters += d
	}
	if totalMeters <= 0.1 {
		return pts[len(pts)-1].Lon, pts[len(pts)-1].Lat, 90, 0
	}
	targetDist := frac * totalMeters
	acc := 0.0
	for i, segLen := range segLens {
		if acc+segLen >= targetDist || i == len(segLens)-1 {
			localT := 0.0
			if segLen > 0.01 {
				localT = math.Max(0, math.Min(1, (targetDist-acc)/segLen))
			}
			lon = pts[i].Lon + (pts[i+1].Lon-pts[i].Lon)*localT
			lat = pts[i].Lat + (pts[i+1].Lat-pts[i].Lat)*localT
			bearing = computeBearingDeg(pts[i].Lon, pts[i].Lat, pts[i+1].Lon, pts[i+1].Lat)
			return lon, lat, bearing, totalMeters
		}
		acc += segLen
	}
	last := pts[len(pts)-1]
	prev := pts[len(pts)-2]
	return last.Lon, last.Lat, computeBearingDeg(prev.Lon, prev.Lat, last.Lon, last.Lat), totalMeters
}

// ridePathFeed models PANYNJ's official https://www.panynj.gov/bin/portauthority/ridepath.json schema.
type ridePathFeed struct {
	Results []struct {
		ConsideredStation string `json:"consideredStation"`
		Destinations      []struct {
			Label    string `json:"label"`
			Messages []struct {
				Target             string `json:"target"`
				SecondsToArrival   string `json:"secondsToArrival"`
				ArrivalTimeMessage string `json:"arrivalTimeMessage"`
				LineColor          string `json:"lineColor"`
				HeadSign           string `json:"headSign"`
				LastUpdated        string `json:"lastUpdated"`
			} `json:"messages"`
		} `json:"destinations"`
	} `json:"results"`
}

func classifyRidePATHRoute(stationCode, dirLabel, targetCode, headSign, lineColor string) (routeID string, toNY bool, viaHob bool) {
	upperHead := strings.ToUpper(strings.TrimSpace(headSign))
	upperColor := strings.ToUpper(strings.TrimSpace(lineColor))
	upperDir := strings.ToUpper(strings.TrimSpace(dirLabel))

	viaHob = strings.Contains(upperHead, "VIA HOB") || strings.Contains(upperColor, ",")

	switch targetCode {
	case "NWK":
		return "NWK-WTC", false, false
	case "JSQ":
		if stationCode == "NWK" || stationCode == "HAR" || strings.Contains(upperColor, "EE352E") || strings.Contains(upperColor, "D93A30") {
			return "NWK-WTC", true, false
		}
		return "JSQ-33", false, viaHob
	case "33S":
		if viaHob {
			return "JSQ-33", true, true
		}
		if stationCode == "HOB" || strings.Contains(upperHead, "HOBOKEN") || upperColor == "4D92FB" || upperColor == "009CDE" {
			return "HOB-33", true, false
		}
		return "JSQ-33", true, false
	case "HOB":
		if stationCode == "WTC" || stationCode == "EXP" || upperColor == "65C100" || upperColor == "009B3A" {
			return "HOB-WTC", false, false
		}
		if stationCode == "JSQ" || stationCode == "GRV" {
			return "JSQ-33", true, true
		}
		return "HOB-33", false, false
	case "WTC":
		if stationCode == "HOB" || stationCode == "NEW" || upperColor == "65C100" || upperColor == "009B3A" {
			return "HOB-WTC", true, false
		}
		return "NWK-WTC", true, false
	}

	toNY = upperDir != "TONJ"
	switch {
	case strings.Contains(upperHead, "NEWARK") || strings.Contains(upperColor, "EE352E") || strings.Contains(upperColor, "D93A30"):
		return "NWK-WTC", toNY, false
	case strings.Contains(upperColor, "65C100") || strings.Contains(upperColor, "009B3A"):
		return "HOB-WTC", toNY, false
	case strings.Contains(upperColor, "4D92FB") || strings.Contains(upperColor, "009CDE"):
		return "HOB-33", toNY, false
	case strings.Contains(upperHead, "33") || strings.Contains(upperHead, "JOURNAL"):
		return "JSQ-33", toNY, viaHob
	case strings.Contains(upperHead, "WORLD TRADE"):
		return "NWK-WTC", true, false
	default:
		return "JSQ-33", toNY, viaHob
	}
}

type candidateTrain struct {
	etaSec int
	record gtfsutil.VehicleRecord
}

// ParseRidePATHJSON converts PANYNJ's official live RidePATH JSON payload into deduplicated physical VehicleRecords
// positioned along PATH's curved rail corridors.
func ParseRidePATHJSON(body []byte, now time.Time) ([]gtfsutil.VehicleRecord, error) {
	var feed ridePathFeed
	if err := json.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("failed parsing ridepath json: %w", err)
	}
	if len(feed.Results) == 0 {
		return nil, fmt.Errorf("ridepath json contained 0 station results")
	}

	nowUTC := now.UTC()
	byVehicleID := make(map[string]candidateTrain)

	for _, stRes := range feed.Results {
		stnCode := normalizePATHStopCode(stRes.ConsideredStation)
		if stnCode == "" {
			continue
		}
		for _, dest := range stRes.Destinations {
			for _, msg := range dest.Messages {
				etaSec, err := strconv.Atoi(strings.TrimSpace(msg.SecondsToArrival))
				if err != nil || etaSec < 0 {
					continue
				}
				targetCode := normalizePATHStopCode(msg.Target)
				routeID, toNY, viaHob := classifyRidePATHRoute(stnCode, dest.Label, targetCode, msg.HeadSign, msg.LineColor)
				stops := directedStopSequence(routeID, toNY, viaHob)

				stopIdx := -1
				for i, code := range stops {
					if code == stnCode {
						stopIdx = i
						break
					}
				}
				if stopIdx < 0 {
					continue
				}

				msgTime := nowUTC
				if parsedTime, tErr := time.Parse(time.RFC3339, strings.TrimSpace(msg.LastUpdated)); tErr == nil {
					if math.Abs(parsedTime.Sub(nowUTC).Seconds()) <= 600 {
						msgTime = parsedTime.UTC()
					}
				}

				var lon, lat, bearing, speedMPS float64
				var status string

				if stopIdx == 0 {
					// Origin terminal: include trains actively boarding or departing within 60 seconds
					if etaSec > 60 {
						continue
					}
					stnDef := canonicalPATHStations[stnCode]
					lon = stnDef.Lon
					lat = stnDef.Lat
					if len(stops) >= 2 {
						if leg, ok := getDirectedLeg(stops[0], stops[1]); ok && len(leg.Waypoints) >= 2 {
							bearing = computeBearingDeg(leg.Waypoints[0].Lon, leg.Waypoints[0].Lat, leg.Waypoints[1].Lon, leg.Waypoints[1].Lat)
						}
					}
					status = "STOPPED_AT"
					speedMPS = 0
				} else {
					prevCode := stops[stopIdx-1]
					leg, ok := getDirectedLeg(prevCode, stnCode)
					if !ok || leg.DurationSec <= 0 {
						continue
					}
					// Only materialize the train from its immediate upcoming station block so downstream stations do not duplicate it
					if etaSec > leg.DurationSec+45 {
						continue
					}
					frac := 1.0 - float64(etaSec)/float64(leg.DurationSec)
					if frac < 0.04 {
						frac = 0.04
					}
					if frac > 1.0 {
						frac = 1.0
					}
					var legMeters float64
					lon, lat, bearing, legMeters = interpolatePolyline(leg.Waypoints, frac)

					upperMsg := strings.ToUpper(strings.TrimSpace(msg.ArrivalTimeMessage))
					switch {
					case etaSec <= 12 || strings.Contains(upperMsg, "BOARDING") || upperMsg == "0 MIN":
						status = "STOPPED_AT"
						speedMPS = 0
						stnDef := canonicalPATHStations[stnCode]
						lon = stnDef.Lon
						lat = stnDef.Lat
					case etaSec <= 35 || strings.Contains(upperMsg, "ARRIVING"):
						status = "INCOMING_AT"
						speedMPS = 6.2
					default:
						status = "IN_TRANSIT_TO"
						speedMPS = math.Max(7.5, math.Min(24.5, legMeters/float64(leg.DurationSec)))
					}
				}

				// Compute projected arrival epoch at final terminal so the physical train keeps a stable vehicle_id across polls
				remSec := etaSec
				for k := stopIdx; k < len(stops)-1; k++ {
					if leg, ok := getDirectedLeg(stops[k], stops[k+1]); ok {
						remSec += leg.DurationSec
					} else {
						remSec += 150
					}
				}
				projTerminalEpoch := msgTime.Unix() + int64(remSec)
				headwaySlot := (projTerminalEpoch + 45) / 90
				dirTag := "NJ"
				if toNY {
					dirTag = "NY"
				}
				vehID := fmt.Sprintf("PATH_%s_%s_%d", routeID, dirTag, headwaySlot)

				latVal := math.Round(lat*100000) / 100000
				lonVal := math.Round(lon*100000) / 100000
				rec := gtfsutil.VehicleRecord{
					VehicleID: vehID,
					RouteID:   routeID,
					TripID:    vehID,
					StationID: stnCode,
					Status:    status,
					Latitude:  &latVal,
					Longitude: &lonVal,
					Bearing:   math.Round(bearing*10) / 10,
					Speed:     math.Round(speedMPS*100) / 100,
					EventTime: msgTime.Format(time.RFC3339),
				}

				if prev, exists := byVehicleID[vehID]; !exists || etaSec < prev.etaSec {
					byVehicleID[vehID] = candidateTrain{etaSec: etaSec, record: rec}
				}
			}
		}
	}

	if len(byVehicleID) == 0 {
		return nil, fmt.Errorf("ridepath json yielded 0 active in-corridor trains")
	}

	keys := make([]string, 0, len(byVehicleID))
	for k := range byVehicleID {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	records := make([]gtfsutil.VehicleRecord, 0, len(keys))
	for _, k := range keys {
		records = append(records, byVehicleID[k].record)
	}
	return records, nil
}

func normalizeGTFSRouteID(rawRouteID string, stopCodes []string) (routeID string, viaHob bool) {
	clean := strings.ToUpper(strings.TrimSpace(rawRouteID))
	switch clean {
	case "NWK-WTC", "862":
		return "NWK-WTC", false
	case "JSQ-33", "861":
		return "JSQ-33", false
	case "JSQ-33-HOB", "1024":
		return "JSQ-33", true
	case "HOB-33", "859":
		return "HOB-33", false
	case "HOB-WTC", "860":
		return "HOB-WTC", false
	}

	hasNWK, hasJSQ, hasHOB, hasWTC, has33S := false, false, false, false, false
	for _, c := range stopCodes {
		switch c {
		case "NWK", "HAR":
			hasNWK = true
		case "JSQ":
			hasJSQ = true
		case "HOB":
			hasHOB = true
		case "WTC":
			hasWTC = true
		case "33S", "23S", "14S", "09S", "CHR":
			has33S = true
		}
	}
	switch {
	case hasNWK || (hasJSQ && hasWTC && !hasHOB):
		return "NWK-WTC", false
	case hasJSQ && has33S:
		return "JSQ-33", hasHOB
	case hasHOB && hasWTC:
		return "HOB-WTC", false
	case hasHOB && has33S:
		return "HOB-33", false
	default:
		return "NWK-WTC", false
	}
}

// ParsePATHGTFSRealtime parses a GTFS-RT Protobuf feed for PATH, handling both VehiclePosition entities
// and TripUpdate entities (such as https://path.transitdata.nyc/gtfsrt).
func ParsePATHGTFSRealtime(body []byte, now time.Time) ([]gtfsutil.VehicleRecord, error) {
	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("failed unmarshaling PATH protobuf: %w", err)
	}
	if len(feed.GetEntity()) == 0 {
		return nil, fmt.Errorf("PATH protobuf contained 0 entities")
	}

	// 1. Prefer explicit VehiclePosition entities when present with valid coordinates or station IDs.
	vpRecords := gtfsutil.ParseGTFSVehiclePositions(&feed, "PORT_AUTHORITY_PATH")
	if len(vpRecords) > 0 {
		for i := range vpRecords {
			code := normalizePATHStopCode(vpRecords[i].StationID)
			if code != "" {
				vpRecords[i].StationID = code
				if vpRecords[i].Latitude == nil || vpRecords[i].Longitude == nil {
					if stn, ok := canonicalPATHStations[code]; ok {
						lat := stn.Lat
						lon := stn.Lon
						vpRecords[i].Latitude = &lat
						vpRecords[i].Longitude = &lon
					}
				}
			}
			rID, _ := normalizeGTFSRouteID(vpRecords[i].RouteID, []string{code})
			vpRecords[i].RouteID = rID
		}
		return vpRecords, nil
	}

	// 2. Reconstruct active train positions from TripUpdate StopTimeUpdates.
	nowUnix := now.UTC().Unix()
	evTimeStr := now.UTC().Format(time.RFC3339)
	if hdrTs := int64(feed.GetHeader().GetTimestamp()); hdrTs > 0 && math.Abs(float64(hdrTs-nowUnix)) <= 600 {
		nowUnix = hdrTs
		evTimeStr = time.Unix(hdrTs, 0).UTC().Format(time.RFC3339)
	}

	var records []gtfsutil.VehicleRecord
	for _, entity := range feed.GetEntity() {
		tu := entity.GetTripUpdate()
		if tu == nil {
			continue
		}
		stus := tu.GetStopTimeUpdate()
		if len(stus) == 0 {
			continue
		}

		stopCodes := make([]string, 0, len(stus))
		for _, stu := range stus {
			if code := normalizePATHStopCode(stu.GetStopId()); code != "" {
				stopCodes = append(stopCodes, code)
			}
		}
		if len(stopCodes) == 0 {
			continue
		}

		routeID, viaHob := normalizeGTFSRouteID(tu.GetTrip().GetRouteId(), stopCodes)

		nextIdx := -1
		var nextArr int64
		for i, stu := range stus {
			t := stu.GetArrival().GetTime()
			if t == 0 {
				t = stu.GetDeparture().GetTime()
			}
			if t >= nowUnix-15 {
				nextIdx = i
				nextArr = t
				break
			}
		}
		if nextIdx < 0 {
			continue
		}

		nextCode := normalizePATHStopCode(stus[nextIdx].GetStopId())
		if nextCode == "" {
			continue
		}
		etaSec := int(nextArr - nowUnix)
		if etaSec < 0 {
			etaSec = 0
		}

		var lon, lat, bearing, speedMPS float64
		var status string

		if nextIdx == 0 {
			// Skip future trips that haven't begun boarding yet
			if etaSec > 60 {
				continue
			}
			stn := canonicalPATHStations[nextCode]
			lon = stn.Lon
			lat = stn.Lat
			status = "STOPPED_AT"
			speedMPS = 0
			if len(stus) >= 2 {
				secondCode := normalizePATHStopCode(stus[1].GetStopId())
				if leg, ok := getDirectedLeg(nextCode, secondCode); ok && len(leg.Waypoints) >= 2 {
					bearing = computeBearingDeg(leg.Waypoints[0].Lon, leg.Waypoints[0].Lat, leg.Waypoints[1].Lon, leg.Waypoints[1].Lat)
				}
			}
		} else {
			prevSTU := stus[nextIdx-1]
			prevDep := prevSTU.GetDeparture().GetTime()
			if prevDep == 0 {
				prevDep = prevSTU.GetArrival().GetTime()
			}
			prevCode := normalizePATHStopCode(prevSTU.GetStopId())
			leg, ok := getDirectedLeg(prevCode, nextCode)
			if !ok {
				continue
			}
			legDur := leg.DurationSec
			if prevDep > 0 && nextArr > prevDep && int(nextArr-prevDep) <= 900 {
				legDur = int(nextArr - prevDep)
			}
			if etaSec > legDur+45 {
				continue
			}
			frac := 1.0 - float64(etaSec)/float64(legDur)
			if frac < 0.04 {
				frac = 0.04
			}
			if frac > 1.0 {
				frac = 1.0
			}
			var legMeters float64
			lon, lat, bearing, legMeters = interpolatePolyline(leg.Waypoints, frac)
			switch {
			case etaSec <= 12:
				status = "STOPPED_AT"
				speedMPS = 0
				stn := canonicalPATHStations[nextCode]
				lon = stn.Lon
				lat = stn.Lat
			case etaSec <= 35:
				status = "INCOMING_AT"
				speedMPS = 6.2
			default:
				status = "IN_TRANSIT_TO"
				speedMPS = math.Max(7.5, math.Min(24.5, legMeters/float64(legDur)))
			}
			_ = viaHob
		}

		tripID := tu.GetTrip().GetTripId()
		if tripID == "" {
			tripID = entity.GetId()
		}
		vehID := tu.GetVehicle().GetId()
		if vehID == "" {
			vehID = "PATH_" + tripID
		}
		latVal := math.Round(lat*100000) / 100000
		lonVal := math.Round(lon*100000) / 100000

		records = append(records, gtfsutil.VehicleRecord{
			VehicleID: vehID,
			RouteID:   routeID,
			TripID:    tripID,
			StationID: nextCode,
			Status:    status,
			Latitude:  &latVal,
			Longitude: &lonVal,
			Bearing:   math.Round(bearing*10) / 10,
			Speed:     math.Round(speedMPS*100) / 100,
			EventTime: evTimeStr,
		})
	}

	if len(records) == 0 {
		return nil, fmt.Errorf("PATH TripUpdate feed yielded 0 active trains")
	}
	return records, nil
}

func fetchAndDecodePATHSource(ctx context.Context, client *http.Client, url string, now time.Time) ([]gtfsutil.VehicleRecord, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, application/x-protobuf, application/octet-stream, */*")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(body))
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("empty body from %s", url)
	}

	if strings.HasPrefix(trimmed, "{") {
		return ParseRidePATHJSON(body, now)
	}
	return ParsePATHGTFSRealtime(body, now)
}

func (p *PATHGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	allowSynthetic := os.Getenv("STRAPHANGER_ALLOW_SYNTHETIC") == "true"
	client := &http.Client{Timeout: 10 * time.Second}
	now := time.Now().UTC()

	var candidateURLs []string
	if customURL := strings.TrimSpace(os.Getenv("PATH_GTFS_RT_URL")); customURL != "" {
		candidateURLs = append(candidateURLs, customURL)
	}
	candidateURLs = append(candidateURLs, DefaultRidePATHURL, FallbackCommunityGTFSURL)

	var lastErr error
	for _, u := range candidateURLs {
		records, err := fetchAndDecodePATHSource(ctx, client, u, now)
		if err == nil && len(records) > 0 {
			return json.Marshal(gtfsutil.VehiclesPayload{Vehicles: records})
		}
		lastErr = err
	}

	if allowSynthetic {
		return json.Marshal(gtfsutil.VehiclesPayload{Vehicles: gtfsutil.GeneratePATHFleet()})
	}
	if lastErr != nil {
		return nil, fmt.Errorf("all PATH realtime sources failed (last error: %w)", lastErr)
	}
	return nil, fmt.Errorf("PATH realtime sources produced 0 vehicle records")
}

func (p *PATHGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'PORT_AUTHORITY_PATH' as agency_id,
			v.route_id,
			v.trip_id,
			v.station_id,
			v.vehicle_id,
			COALESCE(v.status, 'IN_TRANSIT_TO') as status,
			v.latitude,
			v.longitude,
			v.bearing,
			v.speed,
			v.occupancy_status,
			to_json(v)::VARIANT as raw_payload
		FROM (
			SELECT unnest(from_json(decode(payload), '{"vehicles": ["STRUCT(vehicle_id VARCHAR, route_id VARCHAR, trip_id VARCHAR, station_id VARCHAR, status VARCHAR, latitude DOUBLE, longitude DOUBLE, bearing DOUBLE, speed DOUBLE, occupancy_status VARCHAR, event_time VARCHAR)"]}').vehicles) as v
			FROM %s
		)
		WHERE v.vehicle_id IS NOT NULL
	`, rawTable)
}

func (p *PATHGTFSPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		INSERT INTO transit_v2.fact_vehicle_positions (
			event_date,
			event_time,
			agency_id,
			route_id,
			trip_id,
			station_id,
			vehicle_id,
			status,
			latitude,
			longitude,
			bearing,
			speed,
			occupancy_status,
			raw_payload
		)
		%s;
	`, p.TransformSelect(rawTable))
}
