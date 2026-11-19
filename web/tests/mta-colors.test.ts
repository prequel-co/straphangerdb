import { describe, it, expect } from 'vitest';
import {
  resolveRouteColor,
  formatRouteBadge,
  NEUTRAL_SLATE_GREY,
  SUBWAY_TRUNK_COLORS,
} from '../src/viz/echarts-theme-mta.js';

describe('MTA Colors and Route Badges', () => {
  it('resolves subway trunk line hex colors accurately', () => {
    // 7th Ave (Red)
    expect(resolveRouteColor('1', 'MTA_NYCT_SUBWAY')).toBe('#EE352E');
    expect(resolveRouteColor('2', 'MTA_NYCT_SUBWAY')).toBe('#EE352E');
    expect(resolveRouteColor('3', 'MTA_NYCT_SUBWAY')).toBe('#EE352E');

    // Lexington (Green)
    expect(resolveRouteColor('4', 'MTA_NYCT_SUBWAY')).toBe('#00933C');
    expect(resolveRouteColor('5', 'MTA_NYCT_SUBWAY')).toBe('#00933C');
    expect(resolveRouteColor('6', 'MTA_NYCT_SUBWAY')).toBe('#00933C');
    expect(resolveRouteColor('6X', 'MTA_NYCT_SUBWAY')).toBe('#00933C');

    // Flushing (Purple)
    expect(resolveRouteColor('7', 'MTA_NYCT_SUBWAY')).toBe('#B933AD');
    expect(resolveRouteColor('7X', 'MTA_NYCT_SUBWAY')).toBe('#B933AD');

    // 8th Ave (Blue)
    expect(resolveRouteColor('A')).toBe('#0039A6');
    expect(resolveRouteColor('C')).toBe('#0039A6');
    expect(resolveRouteColor('E')).toBe('#0039A6');

    // 6th Ave (Orange)
    expect(resolveRouteColor('B')).toBe('#FF6319');
    expect(resolveRouteColor('D')).toBe('#FF6319');
    expect(resolveRouteColor('F')).toBe('#FF6319');
    expect(resolveRouteColor('M')).toBe('#FF6319');

    // Broadway (Yellow)
    expect(resolveRouteColor('N')).toBe('#FCCC0A');
    expect(resolveRouteColor('Q')).toBe('#FCCC0A');
    expect(resolveRouteColor('R')).toBe('#FCCC0A');
    expect(resolveRouteColor('W')).toBe('#FCCC0A');

    // Crosstown (Light Green)
    expect(resolveRouteColor('G')).toBe('#6CBE45');

    // Nassau (Brown)
    expect(resolveRouteColor('J')).toBe('#996633');
    expect(resolveRouteColor('Z')).toBe('#996633');

    // Canarsie (Grey)
    expect(resolveRouteColor('L')).toBe('#A7A9AC');

    // Staten Island Railway (Blue)
    expect(resolveRouteColor('SIR')).toBe('#0039A6');
  });

  it('preserves valid explicit hex color if provided', () => {
    expect(resolveRouteColor('1', 'MTA_NYCT_SUBWAY', '#123456')).toBe('#123456');
    expect(resolveRouteColor('UnknownRoute', null, '#ABCDEF')).toBe('#ABCDEF');
  });

  it('falls back to Neutral Slate Grey for ambiguous numeric routes without agencyId', () => {
    // Routes like 1, 2, 7 exist across subway and bus agencies
    expect(resolveRouteColor('7', null)).toBe(NEUTRAL_SLATE_GREY);
  });

  it('falls back to Neutral Slate Grey for unmapped non-subway routes', () => {
    expect(resolveRouteColor('XYZ999', 'UNKNOWN_AGENCY')).toBe(NEUTRAL_SLATE_GREY);
  });

  it('formats express diamond routes properly', () => {
    const badge6X = formatRouteBadge('6X', 'MTA_NYCT_SUBWAY');
    expect(badge6X.isDiamond).toBe(true);
    expect(badge6X.displayLabel).toBe('6');
    expect(badge6X.colorHex).toBe('#00933C');
    expect(badge6X.textColor).toBe('#FFFFFF');

    const badge7X = formatRouteBadge('7X', 'MTA_NYCT_SUBWAY');
    expect(badge7X.isDiamond).toBe(true);
    expect(badge7X.displayLabel).toBe('7');
    expect(badge7X.colorHex).toBe('#B933AD');
    expect(badge7X.textColor).toBe('#FFFFFF');

    const badgeRegular6 = formatRouteBadge('6', 'MTA_NYCT_SUBWAY');
    expect(badgeRegular6.isDiamond).toBe(false);
    expect(badgeRegular6.displayLabel).toBe('6');

    // Angle bracket express diamond syntax <6> and <7>
    const badgeAngle6 = formatRouteBadge('<6>', 'MTA_NYCT_SUBWAY');
    expect(badgeAngle6.isDiamond).toBe(true);
    expect(badgeAngle6.displayLabel).toBe('6');
    expect(badgeAngle6.colorHex).toBe('#00933C');

    const badgeAngle7 = formatRouteBadge('<7>', 'MTA_NYCT_SUBWAY');
    expect(badgeAngle7.isDiamond).toBe(true);
    expect(badgeAngle7.displayLabel).toBe('7');
    expect(badgeAngle7.colorHex).toBe('#B933AD');
  });

  it('sets black text color for high-luminance Broadway yellow', () => {
    const badgeN = formatRouteBadge('N');
    expect(badgeN.colorHex).toBe('#FCCC0A');
    expect(badgeN.textColor).toBe('#000000');
  });

  it('automatically assigns official MTA route bullet colors and Other Routes grey in donut and composition charts', async () => {
    const { inferRouteBulletColorFromLabel, MTA_ROUTE_BULLET_SWATCHES, applyChartColorOverrides } = await import(
      '../src/viz/echarts-theme-mta.js'
    );
    const { buildStandardBiOption } = await import('../src/viz/standard-bi.js');

    expect(MTA_ROUTE_BULLET_SWATCHES.length).toBeGreaterThanOrEqual(11);
    expect(inferRouteBulletColorFromLabel('D Train')).toEqual({ routeId: 'D', colorHex: '#FF6319' });
    expect(inferRouteBulletColorFromLabel('7 Train')).toEqual({ routeId: '7', colorHex: '#B933AD' });
    expect(inferRouteBulletColorFromLabel('<7> Train')).toEqual({ routeId: '<7>', colorHex: '#B933AD' });
    expect(inferRouteBulletColorFromLabel('1 Train')).toEqual({ routeId: '1', colorHex: '#EE352E' });
    expect(inferRouteBulletColorFromLabel('6 Train')).toEqual({ routeId: '6', colorHex: '#00933C' });
    expect(inferRouteBulletColorFromLabel('A Train')).toEqual({ routeId: 'A', colorHex: '#0039A6' });
    expect(inferRouteBulletColorFromLabel('L Train')).toEqual({ routeId: 'L', colorHex: '#A7A9AC' });
    expect(inferRouteBulletColorFromLabel('Other Routes')).toEqual({ routeId: 'S', colorHex: '#808183' });

    const donutRows = [
      { route_label: 'D Train', observed_trips: 207 },
      { route_label: '7 Train', observed_trips: 188 },
      { route_label: '1 Train', observed_trips: 177 },
      { route_label: '6 Train', observed_trips: 169 },
      { route_label: 'Other Routes', observed_trips: 1954 },
    ];
    const donutOpt = buildStandardBiOption('donut', donutRows, {}) as any;
    const pieSeries = donutOpt.series[0];
    expect(pieSeries.data[0].itemStyle.color).toBe('#FF6319');
    expect(pieSeries.data[1].itemStyle.color).toBe('#B933AD');
    expect(pieSeries.data[2].itemStyle.color).toBe('#EE352E');
    expect(pieSeries.data[3].itemStyle.color).toBe('#00933C');
    expect(pieSeries.data[4].itemStyle.color).toBe('#808183');

    // User customColors override default route bullet colors on any chart
    const overriddenOpt = buildStandardBiOption('donut', donutRows, {
      customColors: { 'D Train': '#00ADD0', 'Other Routes': '#334155' },
    }) as any;
    expect(overriddenOpt.series[0].data[0].itemStyle.color).toBe('#00ADD0');
    expect(overriddenOpt.series[0].data[4].itemStyle.color).toBe('#334155');

    // Custom colors also apply to bar, line, and transit series
    const barOpt = buildStandardBiOption(
      'bar',
      [
        { station_name: '34 St-Penn Station (A,C,E)', total_entries: 75087 },
        { station_name: '34 St-Penn Station (1,2,3)', total_entries: 60670 },
      ],
      {
        customColors: {
          '34 St-Penn Station (A,C,E)': '#0039A6',
          '34 St-Penn Station (1,2,3)': '#EE352E',
        },
        colorPalette: 'tauranac',
      }
    ) as any;
    expect(barOpt.color).toContain('#D82233');
    expect(barOpt.series[0].data[0].itemStyle.color).toBe('#0039A6');
    expect(barOpt.series[0].data[1].itemStyle.color).toBe('#EE352E');

    const lineOpt = applyChartColorOverrides(
      {
        series: [{ name: 'Line R', type: 'line', data: [120, 180] }],
      },
      { customColors: { R: '#B933AD' } }
    ) as any;
    expect(lineOpt.series[0].itemStyle.color).toBe('#B933AD');
    expect(lineOpt.series[0].lineStyle.color).toBe('#B933AD');
  });

  it('applies color and palette overrides cleanly across adherence-waterfall, multimodal-pulse, od-ridership-flow, marey-chart, maps, and KPI/radar/heatmap', async () => {
    const { applyChartColorOverrides } = await import('../src/viz/echarts-theme-mta.js');
    const { buildAdherenceWaterfallOption } = await import('../src/viz/transit/adherence-waterfall.js');
    const { buildMultimodalPulseOption } = await import('../src/viz/transit/multimodal-pulse.js');
    const { buildOdRidershipFlowOption } = await import('../src/viz/transit/od-ridership-flow.js');
    const { buildMareyChartOption } = await import('../src/viz/transit/marey-chart.js');
    const { buildRouteSegmentGeoJson } = await import('../src/viz/transit/route-segment-map.js');
    const { buildTrainFeatures } = await import('../src/viz/transit/train-position-map.js');
    const { buildStationWalkGradientGeoJson } = await import('../src/viz/transit/isochrone-map.js');
    const { renderKpiHtml, buildStandardBiOption } = await import('../src/viz/standard-bi.js');
    const { extractChartColorTargets } = await import('../src/ui/editorial-card.js');

    // 1. Adherence Waterfall: keeps Placeholder Base transparent under palette + applies bar customColors
    const wfOpt = applyChartColorOverrides(
      buildAdherenceWaterfallOption([
        { scheduled_trips: 100, ghost_trips: 10, unscheduled_trips: 5, observed_trips: 95 },
      ]),
      {
        colorPalette: 'tauranac',
        customColors: {
          'Scheduled Service': '#112233',
          'Ghost / Missing': '#445566',
        },
      }
    ) as any;
    expect(wfOpt.series[0].itemStyle.color).toBe('transparent');
    expect(wfOpt.series[1].data[0].itemStyle.color).toBe('#112233');
    expect(wfOpt.series[1].data[1].itemStyle.color).toBe('#445566');

    // 2. Multimodal Pulse: matches all 4 series names from extractChartColorTargets
    const mmTargets = extractChartColorTargets({
      cellId: 'c_mm' as any,
      chartType: 'multimodal-pulse',
      chartConfig: {},
    } as any);
    expect(mmTargets.map(t => t.key)).toEqual([
      'Subway Entries',
      'Citi Bikes Available',
      'Citi E-Bikes Available',
      'Empty Bike Docks',
    ]);
    const mmOpt = applyChartColorOverrides(
      buildMultimodalPulseOption([
        {
          event_hour: '2026-11-10T08:00:00Z',
          subway_entries: 1200,
          bikes_available: 15,
          ebikes_available: 8,
          docks_available: 20,
        },
      ]),
      {
        customColors: {
          'Subway Entries': '#111111',
          'Citi Bikes Available': '#222222',
          'Citi E-Bikes Available': '#333333',
          'Empty Bike Docks': '#444444',
        },
      }
    ) as any;
    expect(mmOpt.series[0].itemStyle.color).toBe('#111111');
    expect(mmOpt.series[1].itemStyle.color).toBe('#222222');
    expect(mmOpt.series[2].itemStyle.color).toBe('#333333');
    expect(mmOpt.series[3].itemStyle.color).toBe('#444444');

    // 3. OD Ridership Flow: strips (Origin) and (Dest) suffixes and applies customColors and palette
    const odOpt = applyChartColorOverrides(
      buildOdRidershipFlowOption([
        {
          origin_station_id: '635',
          destination_station_id: '631',
          estimated_ridership: 4500,
        },
      ]),
      {
        customColors: { '14 St-Union Sq': '#B933AD' },
      }
    ) as any;
    const unionSqNode = odOpt.series[0].data.find((n: any) =>
      String(n.name).includes('14 St-Union Sq')
    );
    expect(unionSqNode.itemStyle.color).toBe('#B933AD');
    expect(odOpt.series[0].links[0].lineStyle.color).toBe('#B933AD');

    // 4. Marey Chart: groups multi-trip palette slots by route name and re-tints route bullet markPoint & legend icons
    const mareyRaw = buildMareyChartOption([
      {
        trip_id: 't1',
        route_id: '7',
        station_id: '701',
        station_name: 'Flushing-Main St',
        stop_sequence: 1,
        arrival_time: '2026-11-10T07:00:00Z',
      },
      {
        trip_id: 't1',
        route_id: '7',
        station_id: '726',
        station_name: '34 St-Hudson Yards',
        stop_sequence: 2,
        arrival_time: '2026-11-10T07:45:00Z',
      },
      {
        trip_id: 't2',
        route_id: '7',
        station_id: '701',
        station_name: 'Flushing-Main St',
        stop_sequence: 1,
        arrival_time: '2026-11-10T07:10:00Z',
      },
      {
        trip_id: 't2',
        route_id: '7',
        station_id: '726',
        station_name: '34 St-Hudson Yards',
        stop_sequence: 2,
        arrival_time: '2026-11-10T07:55:00Z',
      },
    ]);
    const mareyOverridden = applyChartColorOverrides(mareyRaw, {
      customColors: { '7': '#00ADD0' },
    }) as any;
    expect(mareyOverridden.series[0].lineStyle.color).toBe('#00ADD0');
    expect(mareyOverridden.series[1].lineStyle.color).toBe('#00ADD0');
    const mpSymbol = mareyOverridden.series[0].markPoint?.data?.[0]?.symbol ?? '';
    expect(decodeURIComponent(mpSymbol)).toContain('#00ADD0');
    const legIcon = mareyOverridden.legend?.data?.[0]?.icon ?? '';
    expect(decodeURIComponent(legIcon)).toContain('#00ADD0');

    // 5. Maps: route-segment-map, train-position-map, and isochrone-map respect customColors
    const segGeo = buildRouteSegmentGeoJson(
      [
        {
          route_id: 'L',
          from_station_id: 'L01',
          to_station_id: 'L02',
          from_lat: 40.739,
          from_lon: -74.002,
          to_lat: 40.737,
          to_lon: -73.996,
          effective_speed_mph: 11,
        },
      ],
      { customColors: { slow: '#DC2626' } }
    );
    expect(segGeo.segmentsGeoJson.features[0]?.properties?.['speedTierColor']).toBe('#DC2626');

    const trainMap = new Map([
      [
        'MTA_NYCT_SUBWAY:v1',
        {
          routeId: '7X',
          agencyId: 'MTA_NYCT_SUBWAY',
          colorHex: '#00ADD0',
          positions: [
            {
              tripId: 't7x',
              vehicleId: 'v1',
              routeId: '7X',
              agencyId: 'MTA_NYCT_SUBWAY',
              lat: 40.75,
              lon: -73.85,
              bearing: 90,
              speedMph: 24,
              eventTime: 1794312000,
              stationId: '701',
              stationName: 'Flushing-Main St',
              status: 'IN_TRANSIT_TO',
              colorHex: '#00ADD0',
            },
          ],
        },
      ],
    ]);
    const trainFeats = buildTrainFeatures(trainMap);
    expect(trainFeats.geojson.features[0]?.properties?.['color']).toBe('#00ADD0');
    expect(trainFeats.geojson.features[0]?.properties?.['iconId']).toBe('diamond-7-00ADD0');

    const isoGeo = buildStationWalkGradientGeoJson(
      [{ stationId: '237', name: 'Grand Army Plaza', lat: 40.675, lon: -73.97, transitTimeMin: 5 }],
      [10, 20],
      80,
      800,
      [400],
      { customColors: { '10 min': '#9B26B6' } }
    );
    expect(isoGeo.features[0]?.properties?.['color']).toBe('#9B26B6');

    // 6. KPI, Radar, Heatmap, and pre-query 'Series 1' custom color persistence
    const kpiHtml = renderKpiHtml([{ active_trains: 412 }], {
      customColors: { 'Series 1': '#00933C' },
    });
    expect(kpiHtml).toContain('color: #00933C;');

    const radarOpt = buildStandardBiOption(
      'radar',
      [{ borough: 'Manhattan', entries: 500, exits: 480 }],
      { customColors: { Manhattan: '#EE352E' } }
    ) as any;
    expect(radarOpt.series[0].data[0].itemStyle.color).toBe('#EE352E');

    const heatOpt = buildStandardBiOption(
      'heatmap',
      [{ hour: '08:00', day: 'Mon', entries: 1200 }],
      { customColors: { 'Series 1': '#B933AD' } }
    ) as any;
    expect(heatOpt.visualMap.inRange.color).toContain('#B933AD');

    // 7. Preserves inferred route bullet colors on donut and single-series bar charts even when colorPalette is explicitly 'mta-trunk'
    const routeDonutMtaPalette = buildStandardBiOption(
      'donut',
      [
        { route_label: 'D Train', observed_trips: 207 },
        { route_label: '7 Train', observed_trips: 188 },
        { route_label: 'Other Routes', observed_trips: 1954 },
      ],
      { colorPalette: 'mta-trunk' }
    ) as any;
    expect(routeDonutMtaPalette.series[0].data[0].itemStyle.color).toBe('#FF6319');
    expect(routeDonutMtaPalette.series[0].data[1].itemStyle.color).toBe('#B933AD');
    expect(routeDonutMtaPalette.series[0].data[2].itemStyle.color).toBe('#808183');

    const routeBarDefault = buildStandardBiOption(
      'bar',
      [
        { route_label: 'D Train', observed_trips: 207 },
        { route_label: '7 Train', observed_trips: 188 },
        { route_label: 'Other Routes', observed_trips: 1954 },
      ]
    ) as any;
    expect(routeBarDefault.series[0].data[0].itemStyle.color).toBe('#FF6319');
    expect(routeBarDefault.series[0].data[1].itemStyle.color).toBe('#B933AD');
    expect(routeBarDefault.series[0].data[2].itemStyle.color).toBe('#808183');

    // 8. Switching to a non-mta-trunk palette (e.g. 'tauranac' or 'metro-north') overrides route-inferred bar colors
    const routeBarTauranac = buildStandardBiOption(
      'bar',
      [
        { route_label: 'D Train', observed_trips: 207 },
        { route_label: '7 Train', observed_trips: 188 },
        { route_label: 'Other Routes', observed_trips: 1954 },
      ],
      { colorPalette: 'tauranac' }
    ) as any;
    expect(routeBarTauranac.series[0].data[0].itemStyle.color).toBe('#D82233');
    expect(routeBarTauranac.series[0].data[1].itemStyle.color).toBe('#009952');
    expect(routeBarTauranac.series[0].data[2].itemStyle.color).toBe('#006BB6');
  });

  it('uses Editorial label, includes Metro-North bullets in color pickers, updates route bullet swatches per transit theme, and renders non-bullet preset chips for Editorial and High-Contrast Civic', async () => {
    const {
      CHART_COLOR_PALETTES,
      getThemeColorSwatches,
      resolveRouteColor,
      formatRouteBadge,
    } = await import('../src/viz/echarts-theme-mta.js');
    const { renderColorSwatchesHtml } = await import('../src/ui/editorial-card.js');

    // 1. Editorial label (never Datasette)
    expect(CHART_COLOR_PALETTES['editorial']?.label).toBe('Editorial');
    for (const spec of Object.values(CHART_COLOR_PALETTES)) {
      expect(spec.label).not.toMatch(/datasette/i);
    }

    // 2. Transit themes update route bullet swatches dynamically per era & include Metro-North bullets
    const mtaGroup = getThemeColorSwatches('mta-trunk');
    const mnrGroup = getThemeColorSwatches('metro-north');
    const tauGroup = getThemeColorSwatches('tauranac');
    const indGroup = getThemeColorSwatches('ind');

    expect(mtaGroup.isTransitTheme).toBe(true);
    expect(mnrGroup.isTransitTheme).toBe(true);
    expect(tauGroup.isTransitTheme).toBe(true);
    expect(indGroup.isTransitTheme).toBe(true);

    expect(mtaGroup.sectionTitle).toBe('MTA & Metro-North Route Bullet Swatches');
    expect(mnrGroup.sectionTitle).toBe('Metro-North, LIRR & PATH Bullet Swatches');
    expect(tauGroup.sectionTitle).toBe('1979 Tauranac & Metro-North Bullet Swatches');
    expect(indGroup.sectionTitle).toBe('1953 IND Bullet Swatches');

    expect(mtaGroup.swatches[0]?.colorHex).toBe('#EE352E');
    expect(mtaGroup.swatches.find(s => s.bulletRoute === 'HUD')?.colorHex).toBe('#009B3A');
    expect(mtaGroup.swatches.find(s => s.bulletRoute === 'HAR')?.colorHex).toBe('#0039A6');
    expect(mtaGroup.swatches.find(s => s.bulletRoute === 'NH')?.colorHex).toBe('#EE0034');
    expect(mnrGroup.swatches.find(s => s.bulletRoute === 'PV')?.colorHex).toBe('#8E258D');
    expect(mnrGroup.swatches.find(s => s.bulletRoute === 'PJ')?.colorHex).toBe('#FF7900');
    expect(mnrGroup.swatches.find(s => s.bulletRoute === 'NWK-WTC')?.colorHex).toBe('#D93A30');
    expect(mnrGroup.swatches.find(s => s.bulletRoute === 'JSQ-33')?.colorHex).toBe('#F9A51A');
    expect(tauGroup.swatches[0]?.colorHex).toBe('#D82233');
    expect(tauGroup.swatches.find(s => s.bulletRoute === 'HUD')?.colorHex).toBe('#009B3A');
    expect(indGroup.swatches.find(s => s.bulletRoute === 'F')?.colorHex).toBe('#1B7F5C');

    // Agency-aware route color & badge formatting for Metro-North, LIRR, and M60-SBS
    expect(resolveRouteColor('1', 'MTA_METRO_NORTH')).toBe('#009B3A');
    expect(formatRouteBadge('1', 'MTA_METRO_NORTH').displayLabel).toBe('HUD');
    expect(resolveRouteColor('2', 'MTA_METRO_NORTH')).toBe('#0039A6');
    expect(formatRouteBadge('2', 'MTA_METRO_NORTH').displayLabel).toBe('HAR');
    expect(resolveRouteColor('3', 'MTA_METRO_NORTH')).toBe('#EE0034');
    expect(formatRouteBadge('3', 'MTA_METRO_NORTH').displayLabel).toBe('NH');
    expect(resolveRouteColor('1', 'MTA_LIRR')).toBe('#00985F');
    expect(formatRouteBadge('1', 'MTA_LIRR').displayLabel).toBe('BAB');
    expect(resolveRouteColor('M60-SBS', 'MTA_BUS')).toBe('#0078C6');
    expect(formatRouteBadge('M60-SBS', 'MTA_BUS').displayLabel).toBe('M60');

    const mnrHtml = renderColorSwatchesHtml('metro-north');
    expect(mnrHtml).toContain('data-swatch-kind="route-bullet"');
    expect(mnrHtml).toContain('#009B3A');
    expect(mnrHtml).toContain('HUD');
    expect(mnrHtml).not.toContain('color-preset-chip');

    // 3. Editorial and High-Contrast Civic use non-bullet color chip presets
    const edGroup = getThemeColorSwatches('editorial');
    const civGroup = getThemeColorSwatches('civic');

    expect(edGroup.isTransitTheme).toBe(false);
    expect(civGroup.isTransitTheme).toBe(false);
    expect(edGroup.sectionTitle).toBe('Editorial Color Swatches');
    expect(civGroup.sectionTitle).toBe('High-Contrast Civic Swatches');
    expect(edGroup.swatches.every(s => s.kind === 'color-chip' && !s.bulletRoute)).toBe(true);
    expect(civGroup.swatches.every(s => s.kind === 'color-chip' && !s.bulletRoute)).toBe(true);

    const edHtml = renderColorSwatchesHtml('editorial');
    const civHtml = renderColorSwatchesHtml('civic');
    expect(edHtml).toContain('color-preset-chip');
    expect(edHtml).not.toContain('data-bullet-route=');
    expect(civHtml).toContain('color-preset-chip');
    expect(civHtml).not.toContain('data-bullet-route=');
  });
});
