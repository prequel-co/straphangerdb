package colors

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

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&MTAColorsPlugin{})
}

type MTAColorsPlugin struct {
	HTTPClient *http.Client
}

func (p *MTAColorsPlugin) ID() string {
	return "mta_colors"
}

func (p *MTAColorsPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTAColorsPlugin) TargetTable() string {
	return "dim_routes"
}

func (p *MTAColorsPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *MTAColorsPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

type routeMetadata struct {
	BulletCode      string   `json:"bullet_code"`
	TextColorHex    string   `json:"text_color_hex"`
	Division        string   `json:"division,omitempty"`
	TrunkGroup      string   `json:"trunk_group,omitempty"`
	IsDiamond       bool     `json:"is_diamond,omitempty"`
	Aliases         []string `json:"aliases,omitempty"`
	TauranacColor   string   `json:"tauranac_color_hex,omitempty"`
	Ind1953Color    string   `json:"ind_1953_color_hex,omitempty"`
	RouteShortLabel string   `json:"route_short_label,omitempty"`
}

type stagedRouteRecord struct {
	RouteID    string        `json:"route_id"`
	AgencyID   string        `json:"agency_id"`
	RouteName  string        `json:"route_name"`
	ColorHex   string        `json:"color_hex"`
	Type       string        `json:"type"`
	RawPayload routeMetadata `json:"raw_payload"`
}

type sodaColorRow struct {
	Operator  string `json:"operator"`
	Service   string `json:"service"`
	Line      string `json:"line"`
	RouteID   string `json:"route_id"`
	HexColor  string `json:"hex_color"`
	Color     string `json:"color"`
	Name      string `json:"name"`
	RouteName string `json:"route_name"`
}

func defaultTextColorForHex(hex string) string {
	switch strings.ToUpper(strings.TrimSpace(hex)) {
	case "#FCCC0A", "#CE8E00", "#00B2A9", "#00A1DE", "#FF9900", "#F9A51A", "#FFD411", "#65C100":
		return "#000000"
	default:
		return "#FFFFFF"
	}
}

func normalizeHex(raw string, fallback string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.TrimPrefix(s, "#")
	if len(s) == 6 {
		valid := true
		for _, ch := range s {
			if !((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F')) {
				valid = false
				break
			}
		}
		if valid {
			return "#" + s
		}
	}
	return fallback
}

func buildCanonicalBaseRoutes() map[string]stagedRouteRecord {
	out := make(map[string]stagedRouteRecord)
	add := func(rec stagedRouteRecord) {
		if rec.RawPayload.BulletCode == "" {
			rec.RawPayload.BulletCode = rec.RouteID
		}
		if rec.RawPayload.TextColorHex == "" {
			rec.RawPayload.TextColorHex = defaultTextColorForHex(rec.ColorHex)
		}
		out[rec.AgencyID+":"+rec.RouteID] = rec
	}

	// 1. NYC Subway & SIR
	subwaySpecs := []struct {
		id, name, color, div, trunk, tau, ind53 string
		diamond                                 bool
		aliases                                 []string
	}{
		{"1", "Broadway-7 Avenue Local", "#EE352E", "IRT", "IRT 7th Ave Red", "#D82233", "#B8292F", false, nil},
		{"2", "7 Avenue Express", "#EE352E", "IRT", "IRT 7th Ave Red", "#D82233", "#B8292F", false, nil},
		{"3", "7 Avenue Express", "#EE352E", "IRT", "IRT 7th Ave Red", "#D82233", "#B8292F", false, nil},
		{"4", "Lexington Avenue Express", "#00933C", "IRT", "IRT Lexington Green", "#009952", "#B8292F", false, nil},
		{"5", "Lexington Avenue Express", "#00933C", "IRT", "IRT Lexington Green", "#009952", "#B8292F", false, nil},
		{"6", "Lexington Avenue Local", "#00933C", "IRT", "IRT Lexington Green", "#009952", "#B8292F", false, nil},
		{"6X", "Pelham Bay Park Express", "#00933C", "IRT", "IRT Lexington Green", "#009952", "#B8292F", true, []string{"<6>"}},
		{"7", "Flushing Local", "#B933AD", "IRT", "IRT Flushing Purple", "#9A38A1", "#B8292F", false, nil},
		{"7X", "Flushing Express", "#B933AD", "IRT", "IRT Flushing Purple", "#9A38A1", "#B8292F", true, []string{"<7>"}},
		{"A", "8 Avenue Express", "#0039A6", "IND", "IND 8th Ave Blue", "#006BB6", "#0039A6", false, nil},
		{"C", "8 Avenue Local", "#0039A6", "IND", "IND 8th Ave Blue", "#006BB6", "#3B6E8C", false, nil},
		{"E", "8 Avenue Local", "#0039A6", "IND", "IND 8th Ave Blue", "#006BB6", "#1B7F5C", false, nil},
		{"B", "Central Park West Local / 6 Avenue Express", "#FF6319", "IND", "IND 6th Ave Orange", "#F58220", "#D9531E", false, nil},
		{"D", "6 Avenue Express", "#FF6319", "IND", "IND 6th Ave Orange", "#F58220", "#D9531E", false, nil},
		{"F", "Queens Blvd Express / 6 Avenue Local", "#FF6319", "IND", "IND 6th Ave Orange", "#F58220", "#1B7F5C", false, nil},
		{"FX", "Culver Express", "#FF6319", "IND", "IND 6th Ave Orange", "#F58220", "#1B7F5C", true, []string{"<F>"}},
		{"M", "Queens Blvd Local / 6 Avenue Local", "#FF6319", "BMT", "IND 6th Ave Orange", "#8E5B3A", "#D99B00", false, nil},
		{"G", "Brooklyn-Queens Crosstown", "#6CBE45", "IND", "IND Crosstown Lime", "#7AC143", "#5E9E3E", false, nil},
		{"J", "Nassau Street Local", "#996633", "BMT", "BMT Nassau Brown", "#8E5B3A", "#6B4C35", false, nil},
		{"Z", "Nassau Street Express", "#996633", "BMT", "BMT Nassau Brown", "#8E5B3A", "#6B4C35", false, nil},
		{"L", "14 Street-Canarsie Local", "#A7A9AC", "BMT", "BMT Canarsie Grey", "#9EA2A2", "#D99B00", false, nil},
		{"N", "Broadway Express", "#FCCC0A", "BMT", "BMT Broadway Yellow", "#FCCC0A", "#D99B00", false, nil},
		{"Q", "Second Ave / Broadway Express", "#FCCC0A", "BMT", "BMT Broadway Yellow", "#FCCC0A", "#D99B00", false, nil},
		{"R", "Broadway Local", "#FCCC0A", "BMT", "BMT Broadway Yellow", "#FCCC0A", "#D99B00", false, nil},
		{"W", "Broadway Local", "#FCCC0A", "BMT", "BMT Broadway Yellow", "#FCCC0A", "#D99B00", false, nil},
		{"S", "42 Street Shuttle", "#808183", "IRT", "Shuttle / Neutral Slate", "#75787B", "#6E737B", false, nil},
		{"GS", "42 Street Shuttle", "#808183", "IRT", "Shuttle / Neutral Slate", "#75787B", "#6E737B", false, []string{"S"}},
		{"FS", "Franklin Avenue Shuttle", "#808183", "BMT", "Shuttle / Neutral Slate", "#75787B", "#6E737B", false, []string{"SF"}},
		{"H", "Rockaway Park Shuttle", "#808183", "IND", "Shuttle / Neutral Slate", "#75787B", "#6E737B", false, []string{"SR"}},
		{"T", "Second Avenue Local", "#00ADD0", "IND", "IND 2nd Ave Turquoise", "#00AEEF", "#00ADD0", false, nil},
		{"SI", "Staten Island Railway", "#0039A6", "SIR", "Staten Island Railway", "#006BB6", "#0039A6", false, []string{"SIR", "SS"}},
		{"SIR", "Staten Island Railway", "#0039A6", "SIR", "Staten Island Railway", "#006BB6", "#0039A6", false, []string{"SI", "SS"}},
		{"SS", "Staten Island Railway", "#0039A6", "SIR", "Staten Island Railway", "#006BB6", "#0039A6", false, []string{"SIR"}},
	}
	for _, s := range subwaySpecs {
		bullet := s.id
		if s.id == "6X" {
			bullet = "6"
		} else if s.id == "7X" {
			bullet = "7"
		} else if s.id == "FX" {
			bullet = "F"
		} else if s.id == "GS" || s.id == "FS" || s.id == "H" {
			bullet = "S"
		} else if s.id == "SI" || s.id == "SS" {
			bullet = "SIR"
		}
		tp := "subway"
		if s.div == "SIR" {
			tp = "rail"
		}
		add(stagedRouteRecord{
			RouteID:   s.id,
			AgencyID:  "MTA_NYCT_SUBWAY",
			RouteName: s.name,
			ColorHex:  s.color,
			Type:      tp,
			RawPayload: routeMetadata{
				BulletCode:    bullet,
				TextColorHex:  defaultTextColorForHex(s.color),
				Division:      s.div,
				TrunkGroup:    s.trunk,
				IsDiamond:     s.diamond,
				Aliases:       s.aliases,
				TauranacColor: s.tau,
				Ind1953Color:  s.ind53,
			},
		})
	}
	for _, sirID := range []string{"SI", "SIR"} {
		add(stagedRouteRecord{
			RouteID:   sirID,
			AgencyID:  "MTA_NYCT_SIR",
			RouteName: "Staten Island Railway",
			ColorHex:  "#0039A6",
			Type:      "rail",
			RawPayload: routeMetadata{
				BulletCode:    "SIR",
				TextColorHex:  "#FFFFFF",
				Division:      "SIR",
				TrunkGroup:    "Staten Island Railway",
				TauranacColor: "#006BB6",
				Ind1953Color:  "#0039A6",
				Aliases:       []string{"SI", "SIR", "SS"},
			},
		})
	}

	// 2. Metro-North Railroad (East-of-Hudson 1..6 + West-of-Hudson 14, 15)
	mnrSpecs := []struct {
		id, code, shortLabel, name, color string
		aliases                           []string
	}{
		{"1", "HUD", "Hudson", "Hudson Line", "#009B3A", []string{"HUD", "HUDSON", "HUDSON LINE"}},
		{"2", "HAR", "Harlem", "Harlem Line", "#0039A6", []string{"HAR", "HARLEM", "HARLEM LINE"}},
		{"3", "NH", "New Haven", "New Haven Line", "#EE0034", []string{"NH", "NEW_HAVEN", "NEW HAVEN", "NEW HAVEN LINE"}},
		{"4", "NC", "New Canaan", "New Canaan Branch", "#EE0034", []string{"NC", "NEW_CANAAN", "NEW CANAAN"}},
		{"5", "DAN", "Danbury", "Danbury Branch", "#EE0034", []string{"DAN", "DANBURY"}},
		{"6", "WAT", "Waterbury", "Waterbury Branch", "#EE0034", []string{"WAT", "WATERBURY"}},
		{"14", "PV", "Pascack", "Pascack Valley Line", "#8E258D", []string{"PV", "PASC", "PASCACK", "PASCACK_VALLEY", "PASCACK VALLEY", "PASCACK VALLEY LINE"}},
		{"15", "PJ", "Pt Jervis", "Port Jervis Line", "#FF7900", []string{"PJ", "MNBNP", "PORT_JERVIS", "PORT JERVIS", "PORT JERVIS LINE"}},
	}
	for _, m := range mnrSpecs {
		add(stagedRouteRecord{
			RouteID:   m.id,
			AgencyID:  "MTA_METRO_NORTH",
			RouteName: m.name,
			ColorHex:  m.color,
			Type:      "rail",
			RawPayload: routeMetadata{
				BulletCode:      m.code,
				TextColorHex:    defaultTextColorForHex(m.color),
				Division:        "MNR",
				TrunkGroup:      "Metro-North " + m.name,
				Aliases:         m.aliases,
				RouteShortLabel: m.shortLabel,
			},
		})
	}

	// 3. Long Island Rail Road (1..13)
	lirrSpecs := []struct {
		id, code, shortLabel, name, color string
		aliases                           []string
	}{
		{"1", "BAB", "Babylon", "Babylon Branch", "#00985F", []string{"BAB", "BABYLON", "BABYLON BRANCH"}},
		{"2", "HEM", "Hempstead", "Hempstead Branch", "#CE8E00", []string{"HEM", "HEMPSTEAD", "HEMPSTEAD BRANCH"}},
		{"3", "OB", "Oyster Bay", "Oyster Bay Branch", "#00AF3F", []string{"OB", "OYSTER_BAY", "OYSTER BAY"}},
		{"4", "RON", "Ronkonkoma", "Ronkonkoma Branch", "#A626AA", []string{"RON", "RONKONKOMA", "RONKONKOMA BRANCH"}},
		{"5", "MTK", "Montauk", "Montauk Branch", "#00B2A9", []string{"MTK", "MONTAUK"}},
		{"6", "LB", "Long Beach", "Long Beach Branch", "#FF6319", []string{"LB", "LONG_BEACH", "LONG BEACH"}},
		{"7", "FR", "Far Rock", "Far Rockaway Branch", "#6E3219", []string{"FR", "FAR_ROCKAWAY", "FAR ROCKAWAY"}},
		{"8", "WH", "W Hempstead", "West Hempstead Branch", "#00A1DE", []string{"WH", "WEST_HEMPSTEAD", "WEST HEMPSTEAD"}},
		{"9", "PW", "Pt Wash", "Port Washington Branch", "#C60C30", []string{"PW", "PORT_WASHINGTON", "PORT WASHINGTON"}},
		{"10", "PJF", "Pt Jeff", "Port Jefferson Branch", "#0039A6", []string{"PJF", "PORT_JEFFERSON", "PORT JEFFERSON", "HUNTINGTON"}},
		{"11", "BEL", "Belmont", "Belmont Park Branch", "#60269E", []string{"BEL", "BELMONT"}},
		{"12", "CTZ", "City Zone", "City Terminal Zone", "#4D5357", []string{"CTZ", "CITY_TERMINAL", "CITY TERMINAL ZONE"}},
		{"13", "GPT", "Greenport", "Greenport Branch", "#A626AA", []string{"GPT", "GREENPORT"}},
	}
	for _, l := range lirrSpecs {
		add(stagedRouteRecord{
			RouteID:   l.id,
			AgencyID:  "MTA_LIRR",
			RouteName: l.name,
			ColorHex:  l.color,
			Type:      "rail",
			RawPayload: routeMetadata{
				BulletCode:      l.code,
				TextColorHex:    defaultTextColorForHex(l.color),
				Division:        "LIRR",
				TrunkGroup:      "LIRR " + l.name,
				Aliases:         l.aliases,
				RouteShortLabel: l.shortLabel,
			},
		})
	}

	// 4. Port Authority PATH
	pathSpecs := []struct {
		id, code, name, color string
		aliases               []string
	}{
		{"NWK-WTC", "NWK", "Newark - World Trade Center", "#D93A30", []string{"NWK", "862"}},
		{"JSQ-33", "JSQ", "Journal Square - 33rd Street", "#F9A51A", []string{"JSQ", "JSQ-33 (VIA HOB)", "861", "1024"}},
		{"HOB-33", "H33", "Hoboken - 33rd Street", "#4D92FB", []string{"H33", "859"}},
		{"HOB-WTC", "HWT", "Hoboken - World Trade Center", "#65C100", []string{"HWT", "860"}},
	}
	for _, p := range pathSpecs {
		add(stagedRouteRecord{
			RouteID:   p.id,
			AgencyID:  "PORT_AUTHORITY_PATH",
			RouteName: p.name,
			ColorHex:  p.color,
			Type:      "rail",
			RawPayload: routeMetadata{
				BulletCode:      p.code,
				TextColorHex:    defaultTextColorForHex(p.color),
				Division:        "PATH",
				TrunkGroup:      "PATH " + p.name,
				Aliases:         p.aliases,
				RouteShortLabel: p.id,
			},
		})
	}

	// 5. MTA Bus (canonical M60-SBS / M60+ and major SBS routes; supplemented live from gtfs_m.zip)
	add(stagedRouteRecord{
		RouteID:   "M60-SBS",
		AgencyID:  "MTA_BUS",
		RouteName: "M60 Select Bus Service (West Side - LaGuardia Airport)",
		ColorHex:  "#0078C6",
		Type:      "bus",
		RawPayload: routeMetadata{
			BulletCode:      "M60",
			TextColorHex:    "#FFFFFF",
			Division:        "SBS",
			TrunkGroup:      "Select Bus Service",
			Aliases:         []string{"M60", "M60+", "MTA NYCT_M60+", "MTABC_M60+"},
			RouteShortLabel: "M60-SBS",
		},
	})
	add(stagedRouteRecord{
		RouteID:   "M60+",
		AgencyID:  "MTA_BUS",
		RouteName: "M60 Select Bus Service (West Side - LaGuardia Airport)",
		ColorHex:  "#0078C6",
		Type:      "bus",
		RawPayload: routeMetadata{
			BulletCode:      "M60",
			TextColorHex:    "#FFFFFF",
			Division:        "SBS",
			TrunkGroup:      "Select Bus Service",
			Aliases:         []string{"M60", "M60-SBS", "MTA NYCT_M60+", "MTABC_M60+"},
			RouteShortLabel: "M60-SBS",
		},
	})

	// 6. NYC Ferry
	ferrySpecs := []struct {
		id, name, color string
	}{
		{"ER", "East River", "#00839B"},
		{"AS", "Astoria", "#FF6B00"},
		{"SB", "South Brooklyn", "#F6A800"},
		{"RW", "Rockaway", "#B71C8C"},
		{"RWS", "Rockaway Shuttle", "#B71C8C"},
		{"RES", "Rockaway East Shuttle", "#B71C8C"},
		{"RS", "Rockaway / Soundview", "#B71C8C"},
		{"SV", "Soundview", "#532E8E"},
		{"SG", "St. George", "#78BE20"},
		{"GI", "Governors Island", "#6CBE45"},
		{"NYC_FERRY", "NYC Ferry", "#004B87"},
	}
	for _, f := range ferrySpecs {
		add(stagedRouteRecord{
			RouteID:   f.id,
			AgencyID:  "NYC_FERRY",
			RouteName: f.name,
			ColorHex:  f.color,
			Type:      "ferry",
			RawPayload: routeMetadata{
				BulletCode:      f.id,
				TextColorHex:    defaultTextColorForHex(f.color),
				Division:        "NYC_FERRY",
				TrunkGroup:      "NYC Ferry",
				RouteShortLabel: f.id,
			},
		})
	}

	// 7. NJ Transit Rail
	add(stagedRouteRecord{
		RouteID:   "NEC",
		AgencyID:  "NJ_TRANSIT",
		RouteName: "Northeast Corridor",
		ColorHex:  "#DD3439",
		Type:      "rail",
		RawPayload: routeMetadata{
			BulletCode:      "NEC",
			TextColorHex:    "#FFFFFF",
			Division:        "NJT",
			TrunkGroup:      "NJ Transit Northeast Corridor",
			Aliases:         []string{"10"},
			RouteShortLabel: "NEC",
		},
	})

	return out
}

func (p *MTAColorsPlugin) Fetch(ctx context.Context) ([]byte, error) {
	client := p.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}

	catalog := buildCanonicalBaseRoutes()

	// 1. Overlay official NY Open Data MTA Colors (3uhz-sej2)
	if body, err := fetchBytes(ctx, client, "https://data.ny.gov/resource/3uhz-sej2.json?$limit=500"); err == nil && json.Valid(body) {
		var sodaRows []sodaColorRow
		if json.Unmarshal(body, &sodaRows) == nil {
			for _, sr := range sodaRows {
				op := strings.TrimSpace(sr.Operator)
				if op == "MTA" || op == "Bridges & Tunnels" {
					continue
				}
				agencyID := "MTA_NYCT_SUBWAY"
				rType := "subway"
				switch op {
				case "Long Island Rail Road":
					agencyID = "MTA_LIRR"
					rType = "rail"
				case "Metro-North Railroad":
					agencyID = "MTA_METRO_NORTH"
					rType = "rail"
				case "Staten Island Railway":
					agencyID = "MTA_NYCT_SIR"
					rType = "rail"
				}
				rawSvc := sr.Service
				if rawSvc == "" {
					rawSvc = sr.Line
				}
				if rawSvc == "" {
					rawSvc = sr.RouteID
				}
				if rawSvc == "" {
					continue
				}
				hex := normalizeHex(firstNonEmpty(sr.HexColor, sr.Color), "")
				for _, tok := range strings.Split(rawSvc, ",") {
					rid := strings.TrimSpace(tok)
					if rid == "" {
						continue
					}
					key := agencyID + ":" + rid
					if existing, ok := catalog[key]; ok {
						if hex != "" {
							existing.ColorHex = hex
							existing.RawPayload.TextColorHex = defaultTextColorForHex(hex)
						}
						if name := firstNonEmpty(sr.Name, sr.RouteName); name != "" && existing.RouteName == "" {
							existing.RouteName = name
						}
						catalog[key] = existing
					} else if hex != "" {
						rName := firstNonEmpty(sr.Name, sr.RouteName, rid+" Line")
						catalog[key] = stagedRouteRecord{
							RouteID:   rid,
							AgencyID:  agencyID,
							RouteName: rName,
							ColorHex:  hex,
							Type:      rType,
							RawPayload: routeMetadata{
								BulletCode:   rid,
								TextColorHex: defaultTextColorForHex(hex),
							},
						}
					}
				}
			}
		}
	}

	// 2. Supplement MTA NYCT Bus routes from gtfs_m.zip
	if zipBytes, err := fetchBytes(ctx, client, "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip"); err == nil {
		for _, r := range parseGTFSRoutesZip(zipBytes) {
			rid := strings.TrimSpace(r["route_id"])
			if rid == "" {
				continue
			}
			shortName := firstNonEmpty(r["route_short_name"], rid)
			longName := firstNonEmpty(r["route_long_name"], shortName)
			isSBS := strings.HasSuffix(rid, "+") || strings.Contains(strings.ToUpper(shortName), "SBS")
			color := normalizeHex(r["route_color"], "#0039A6")
			if rid == "M60+" || shortName == "M60-SBS" {
				color = "#0078C6"
			}
			bullet := strings.TrimSuffix(strings.TrimSuffix(rid, "+"), "-SBS")
			if len(bullet) > 4 {
				bullet = bullet[:4]
			}
			div := "LOCAL"
			if isSBS {
				div = "SBS"
			}
			key := "MTA_BUS:" + rid
			if _, exists := catalog[key]; !exists {
				var aliases []string
				if shortName != rid {
					aliases = append(aliases, shortName)
				}
				catalog[key] = stagedRouteRecord{
					RouteID:   rid,
					AgencyID:  "MTA_BUS",
					RouteName: shortName + " - " + longName,
					ColorHex:  color,
					Type:      "bus",
					RawPayload: routeMetadata{
						BulletCode:      bullet,
						TextColorHex:    defaultTextColorForHex(color),
						Division:        div,
						TrunkGroup:      firstNonEmpty(r["route_desc"], "NYC Bus"),
						Aliases:         aliases,
						RouteShortLabel: shortName,
					},
				}
			}
			if isSBS && shortName != rid {
				sbsKey := "MTA_BUS:" + shortName
				if _, exists := catalog[sbsKey]; !exists {
					catalog[sbsKey] = stagedRouteRecord{
						RouteID:   shortName,
						AgencyID:  "MTA_BUS",
						RouteName: shortName + " - " + longName,
						ColorHex:  color,
						Type:      "bus",
						RawPayload: routeMetadata{
							BulletCode:      bullet,
							TextColorHex:    defaultTextColorForHex(color),
							Division:        "SBS",
							TrunkGroup:      firstNonEmpty(r["route_desc"], "Select Bus Service"),
							Aliases:         []string{rid},
							RouteShortLabel: shortName,
						},
					}
				}
			}
		}
	}

	// 3. Supplement NJ Transit Rail routes from rail_data.zip
	if zipBytes, err := fetchBytes(ctx, client, "https://www.njtransit.com/rail_data.zip"); err == nil {
		for _, r := range parseGTFSRoutesZip(zipBytes) {
			shortName := strings.TrimSpace(r["route_short_name"])
			rid := firstNonEmpty(shortName, r["route_id"])
			if rid == "" {
				continue
			}
			color := normalizeHex(r["route_color"], "#475569")
			key := "NJ_TRANSIT:" + rid
			if _, exists := catalog[key]; !exists {
				var aliases []string
				if rawID := strings.TrimSpace(r["route_id"]); rawID != "" && rawID != rid {
					aliases = append(aliases, rawID)
				}
				catalog[key] = stagedRouteRecord{
					RouteID:   rid,
					AgencyID:  "NJ_TRANSIT",
					RouteName: firstNonEmpty(r["route_long_name"], rid),
					ColorHex:  color,
					Type:      "rail",
					RawPayload: routeMetadata{
						BulletCode:      rid,
						TextColorHex:    defaultTextColorForHex(color),
						Division:        "NJT",
						TrunkGroup:      "NJ Transit Rail",
						Aliases:         aliases,
						RouteShortLabel: rid,
					},
				}
			}
		}
	}

	keys := make([]string, 0, len(catalog))
	for k := range catalog {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	records := make([]stagedRouteRecord, 0, len(keys))
	for _, k := range keys {
		records = append(records, catalog[k])
	}
	return json.Marshal(records)
}

func fetchBytes(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, application/zip, */*")
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

func parseGTFSRoutesZip(zipBytes []byte) []map[string]string {
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil
	}
	for _, f := range zr.File {
		if f.Name == "routes.txt" {
			rc, err := f.Open()
			if err != nil {
				return nil
			}
			defer rc.Close()
			cr := csv.NewReader(rc)
			cr.LazyQuotes = true
			headers, err := cr.Read()
			if err != nil {
				return nil
			}
			for i := range headers {
				headers[i] = strings.TrimSpace(strings.TrimPrefix(headers[i], "\ufeff"))
			}
			var out []map[string]string
			for {
				row, err := cr.Read()
				if err != nil {
					break
				}
				m := make(map[string]string, len(headers))
				for i, h := range headers {
					if i < len(row) {
						m[h] = strings.TrimSpace(row[i])
					}
				}
				out = append(out, m)
			}
			return out
		}
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if t := strings.TrimSpace(v); t != "" {
			return t
		}
	}
	return ""
}

func (p *MTAColorsPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(route_id VARCHAR, line VARCHAR, service VARCHAR, agency_id VARCHAR, operator VARCHAR, route_name VARCHAR, name VARCHAR, color_hex VARCHAR, color VARCHAR, hex_color VARCHAR, type VARCHAR, raw_payload JSON)"]')) AS r
			FROM %s
		),
		normalized AS (
			SELECT
				COALESCE(NULLIF(r.route_id, ''), NULLIF(r.line, ''), NULLIF(r.service, '')) AS route_id,
				COALESCE(
					NULLIF(r.agency_id, ''),
					CASE
						WHEN r.operator = 'Metro-North Railroad' THEN 'MTA_METRO_NORTH'
						WHEN r.operator = 'Long Island Rail Road' THEN 'MTA_LIRR'
						WHEN r.operator = 'Staten Island Railway' THEN 'MTA_NYCT_SIR'
						ELSE 'MTA_NYCT_SUBWAY'
					END
				) AS agency_id,
				COALESCE(NULLIF(r.route_name, ''), NULLIF(r.name, ''), 'Subway') AS route_name,
				COALESCE(NULLIF(r.color_hex, ''), NULLIF(r.color, ''), NULLIF(r.hex_color, '')) AS color_hex,
				COALESCE(NULLIF(r.type, ''), 'subway') AS type,
				COALESCE(r.raw_payload::VARIANT, to_json(r)::VARIANT) AS raw_payload
			FROM parsed
		),
		staged AS (
			SELECT
				n.route_id,
				n.agency_id,
				n.route_name,
				n.color_hex,
				n.type,
				n.raw_payload,
				ROW_NUMBER() OVER (PARTITION BY n.agency_id, n.route_id ORDER BY n.route_name) AS rn
			FROM normalized n
			WHERE n.route_id IS NOT NULL AND length(n.route_id) > 0
		)
		SELECT
			src.route_id,
			src.agency_id,
			src.route_name,
			src.color_hex,
			src.type,
			CURRENT_TIMESTAMP AS valid_from,
			CAST(NULL AS TIMESTAMPTZ) AS valid_to,
			true AS is_current,
			src.raw_payload
		FROM staged src
		WHERE src.rn = 1
	`, rawTable)
}

func (p *MTAColorsPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.dim_routes AS cur
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		FROM (
			%s
		) AS raw
		WHERE cur.route_id = raw.route_id
		  AND cur.agency_id = raw.agency_id
		  AND cur.is_current = true
		  AND (
			  cur.route_name IS DISTINCT FROM raw.route_name
			  OR cur.color_hex IS DISTINCT FROM raw.color_hex
			  OR cur.type IS DISTINCT FROM raw.type
			  OR cur.raw_payload::VARCHAR IS DISTINCT FROM raw.raw_payload::VARCHAR
		  );

		INSERT INTO transit_v2.dim_routes (
			route_id,
			agency_id,
			route_name,
			color_hex,
			type,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		)
		WITH staged_sel AS (
			%s
		)
		SELECT
			src.route_id,
			src.agency_id,
			src.route_name,
			src.color_hex,
			src.type,
			src.valid_from,
			src.valid_to,
			src.is_current,
			src.raw_payload
		FROM staged_sel src
		LEFT JOIN transit_v2.dim_routes cur
		  ON cur.route_id = src.route_id
		 AND cur.agency_id = src.agency_id
		 AND cur.is_current = true
		WHERE cur.route_id IS NULL
		   OR cur.route_name IS DISTINCT FROM src.route_name
		   OR cur.color_hex IS DISTINCT FROM src.color_hex
		   OR cur.type IS DISTINCT FROM src.type
		   OR cur.raw_payload::VARCHAR IS DISTINCT FROM src.raw_payload::VARCHAR;
	`, p.TransformSelect(rawTable), p.TransformSelect(rawTable))
}
