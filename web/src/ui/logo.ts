/**
 * Transit Studio SVG Emblem
 * Iconic NYC Subway R33/R36 Redbird front-end emblem featuring the curved
 * charcoal roof crown, ruby marker lights, (7) route bullet & destination
 * rollsign, terracotta-red carbody, asymmetric cab & storm-door windows,
 * steel safety gate, curved safety chain, recessed headlight, and anti-climber.
 */
export function getTransitEmblemSvg(size = 26, className = 'dbtc-logo-emblem'): string {
  return `<svg class="${className}" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="DBTC Redbird Subway Logo">
  <!-- Deep subway tunnel backdrop -->
  <circle cx="32" cy="32" r="30.5" fill="#0F172A" stroke="#334155" stroke-width="1"/>
  <!-- Perspective steel rails & ties -->
  <path d="M21 52.5L11.5 61.5M43 52.5L52.5 61.5" stroke="#94A3B8" stroke-width="2.2" stroke-linecap="round" opacity="0.65"/>
  <path d="M16 56.5H48M13.5 59.5H50.5" stroke="#64748B" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>
  <!-- Underframe, coupler & wheel trucks -->
  <rect x="19" y="48.5" width="26" height="3.2" rx="1" fill="#1E293B"/>
  <rect x="28.5" y="49" width="7" height="4.8" rx="1" fill="#334155" stroke="#0F172A" stroke-width="0.7"/>
  <!-- Curved dark charcoal Redbird roof crown -->
  <path d="M15 21.5V15.5C15 13.8 21.5 10.5 32 10.5C42.5 10.5 49 13.8 49 15.5V21.5H15Z" fill="#1E242B"/>
  <path d="M16 15.6C19.5 13 25.5 11.4 32 11.4C38.5 11.4 44.5 13 48 15.6" stroke="#475569" stroke-width="1" stroke-linecap="round"/>
  <!-- Flanking ruby-red marker lights -->
  <circle cx="19" cy="17" r="2" fill="#DC2626"/>
  <circle cx="19" cy="17" r="0.9" fill="#FCA5A5"/>
  <circle cx="45" cy="17" r="2" fill="#DC2626"/>
  <circle cx="45" cy="17" r="0.9" fill="#FCA5A5"/>
  <!-- (7) Route bullet & destination rollsign -->
  <circle cx="26.5" cy="16.7" r="3.4" fill="#B933AD"/>
  <path d="M25.1 15.1H28L26.1 18.6" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="31.3" y="13.8" width="10.4" height="5.8" rx="1" fill="#0B0F14" stroke="#334155" stroke-width="0.6"/>
  <line x1="33" y1="15.7" x2="40" y2="15.7" stroke="#F8FAFC" stroke-width="1.15" stroke-linecap="round"/>
  <line x1="33" y1="17.7" x2="39" y2="17.7" stroke="#CBD5E1" stroke-width="1.05" stroke-linecap="round"/>
  <!-- Iconic terracotta-red Redbird body -->
  <rect x="15" y="21.2" width="34" height="25.3" rx="1.2" fill="#C44536"/>
  <!-- Subtle side bevel & storm-door panel framing -->
  <rect x="15" y="21.2" width="2.2" height="25.3" fill="#A93528" opacity="0.7"/>
  <rect x="46.8" y="21.2" width="2.2" height="25.3" fill="#A93528" opacity="0.7"/>
  <rect x="27.8" y="21.8" width="10.4" height="24.5" fill="#B63A2C" stroke="#8C281E" stroke-width="0.7"/>
  <!-- Asymmetric Redbird windows: left cab windshield + center-right storm-door window -->
  <rect x="17.6" y="23.4" width="8.6" height="9.4" rx="1.6" fill="#CFE2F3" stroke="#1E242B" stroke-width="1.1"/>
  <path d="M19 25L22.5 31M22 25L24.5 29.5" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
  <rect x="29.6" y="23.8" width="6.8" height="10" rx="2" fill="#CFE2F3" stroke="#1E242B" stroke-width="1.1"/>
  <path d="M31 25.5L34.5 31.8" stroke="#FFFFFF" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>
  <!-- Right-side subtle panel & number-plate detail -->
  <rect x="40.2" y="24.2" width="6.2" height="2.4" rx="0.5" fill="#1E242B" opacity="0.75"/>
  <line x1="41.4" y1="25.4" x2="45.2" y2="25.4" stroke="#E2E8F0" stroke-width="0.8" stroke-linecap="round"/>
  <!-- Signature black steel safety gate & curved storm-door chain -->
  <path d="M17.4 34.4V46M25.6 34.4V46M17.4 34.6H25.6M17.4 39.2H25.6" stroke="#1E242B" stroke-width="1.35" stroke-linecap="round"/>
  <path d="M28.4 35.2C30.8 37.8 35.2 37.8 37.6 35.2" stroke="#1E242B" stroke-width="1.15" stroke-linecap="round"/>
  <path d="M40.5 36.2V45.6M46.5 36.2V45.6M40.5 36.4H46.5" stroke="#1E242B" stroke-width="1.1" stroke-linecap="round" opacity="0.85"/>
  <!-- Lower-left recessed headlight & lower-right taillight -->
  <circle cx="21.5" cy="42.5" r="2.4" fill="#1E242B"/>
  <circle cx="21.5" cy="42.5" r="1.5" fill="#FEF08A"/>
  <circle cx="21.5" cy="42.5" r="0.7" fill="#FFFFFF"/>
  <circle cx="43.5" cy="42.5" r="1.4" fill="#1E242B"/>
  <circle cx="43.5" cy="42.5" r="0.85" fill="#EF4444"/>
  <!-- Ribbed anti-climber front bumper -->
  <rect x="13.8" y="45.8" width="36.4" height="3.4" rx="1.1" fill="#272E36"/>
  <line x1="15.5" y1="47.1" x2="48.5" y2="47.1" stroke="#64748B" stroke-width="0.8" stroke-linecap="round"/>
  <line x1="15.5" y1="48.2" x2="48.5" y2="48.2" stroke="#475569" stroke-width="0.7" stroke-linecap="round"/>
</svg>`;
}

let loadingSvgClipSeq = 0;

/**
 * 125th Street Manhattan Valley Viaduct SVG Animation (Query Executing).
 * Features the Manhattanville skyline (red-brick housing towers, stepped
 * mid-rise buildings, white Beaux-Arts corner building, Broadway asphalt &
 * yellow median), teal-green parabolic steel arch bridge, lattice truss bents,
 * burgundy-roofed elevated 125 St station canopy, and an IRT (1) stainless
 * steel train gliding horizontally across the viaduct deck.
 */
export function getViaduct125LoadingSvg(width = 280, height = 84): string {
  const clipId = `viaduct125-clip-${++loadingSvgClipSeq}`;
  const frameClipId = `viaduct125-frame-${++loadingSvgClipSeq}`;
  return `<svg class="dbtc-loading-svg dbtc-viaduct-125-svg" viewBox="0 0 320 96" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="125th Street Viaduct subway animation">
  <defs>
    <clipPath id="${frameClipId}">
      <rect x="4" y="4" width="312" height="88" rx="8"/>
    </clipPath>
    <clipPath id="${clipId}">
      <rect x="8" y="10" width="304" height="32" rx="2"/>
    </clipPath>
  </defs>

  <!-- Crisp light editorial sky & horizon backdrop -->
  <rect x="4" y="4" width="312" height="88" rx="8" fill="#EFF6FF" stroke="#CBD5E1" stroke-width="1"/>

  <g clip-path="url(#${frameClipId})">
    <!-- Distant Harlem / Morningside skyline behind the viaduct -->
    <rect x="10" y="24" width="34" height="22" fill="#C9B29B"/>
    <rect x="46" y="20" width="42" height="26" fill="#D6C7B8"/>
    <!-- Stepped terracotta/limestone tower left-center -->
    <path d="M104 36V19H109V13H121V19H126V36H104Z" fill="#D6B89C"/>
    <!-- Mid-rise loft & commercial buildings center -->
    <rect x="138" y="17" width="24" height="22" fill="#CBD5E1"/>
    <rect x="165" y="22" width="26" height="17" fill="#E2E8F0"/>
    <!-- Iconic tall red-brick Manhattanville Houses towers on the right -->
    <rect x="210" y="9" width="16" height="32" fill="#8C4339"/>
    <rect x="228" y="4" width="66" height="36" fill="#7C3A32"/>
    <g fill="#4A211C" opacity="0.55">
      <rect x="233" y="8" width="4" height="3"/><rect x="241" y="8" width="4" height="3"/><rect x="249" y="8" width="4" height="3"/><rect x="257" y="8" width="4" height="3"/><rect x="265" y="8" width="4" height="3"/><rect x="273" y="8" width="4" height="3"/><rect x="281" y="8" width="4" height="3"/>
      <rect x="233" y="14" width="4" height="3"/><rect x="241" y="14" width="4" height="3"/><rect x="249" y="14" width="4" height="3"/><rect x="257" y="14" width="4" height="3"/><rect x="265" y="14" width="4" height="3"/><rect x="273" y="14" width="4" height="3"/><rect x="281" y="14" width="4" height="3"/>
    </g>

    <!-- Foreground streetscape under & beside the viaduct -->
    <!-- Left-side brick tenements behind truss -->
    <rect x="6" y="40" width="54" height="48" fill="#B89882"/>
    <g fill="#574335" opacity="0.45">
      <rect x="12" y="45" width="4" height="5"/><rect x="20" y="45" width="4" height="5"/><rect x="28" y="45" width="4" height="5"/>
      <rect x="12" y="54" width="4" height="5"/><rect x="20" y="54" width="4" height="5"/><rect x="28" y="54" width="4" height="5"/>
    </g>
    <!-- Low-rise yellow-brick corner building & green BP canopy left-center -->
    <rect x="52" y="60" width="68" height="28" fill="#EFE4C8" stroke="#C4B59B" stroke-width="0.6"/>
    <rect x="52" y="58" width="68" height="3" fill="#B45309" opacity="0.65"/>
    <rect x="114" y="65" width="28" height="4" rx="0.8" fill="#15803D"/>
    <line x1="120" y1="69" x2="120" y2="86" stroke="#CBD5E1" stroke-width="1.2"/>
    <line x1="136" y1="69" x2="136" y2="86" stroke="#CBD5E1" stroke-width="1.2"/>

    <!-- Broadway / 125th St asphalt roadway curving under the arch -->
    <path d="M148 50H174L258 92H186L148 50Z" fill="#475569"/>
    <path d="M161 50L220 92M163 50L224 92" stroke="#FACC15" stroke-width="1" stroke-dasharray="3 2"/>
    <!-- Tiny yellow cabs & shuttle on Broadway -->
    <rect x="176" y="68" width="7" height="3.5" rx="1" fill="#FACC15"/>
    <rect x="204" y="75" width="8" height="4" rx="1" fill="#FACC15"/>
    <rect x="191" y="72" width="6" height="4.5" rx="0.8" fill="#F8FAFC"/>

    <!-- Iconic white Beaux-Arts arched-window building on right foreground -->
    <rect x="278" y="34" width="38" height="56" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="0.8"/>
    <g fill="#94A3B8" opacity="0.6">
      <rect x="284" y="42" width="5" height="10" rx="2.5"/><rect x="293" y="42" width="5" height="10" rx="2.5"/><rect x="302" y="42" width="5" height="10" rx="2.5"/>
      <rect x="284" y="57" width="5" height="10" rx="2.5"/><rect x="293" y="57" width="5" height="10" rx="2.5"/><rect x="302" y="57" width="5" height="10" rx="2.5"/>
    </g>

    <path d="M4 88H316" stroke="#94A3B8" stroke-width="1.2"/>
  </g>

  <!-- Left & right steel lattice truss bents (125th St Viaduct teal-green) -->
  <g stroke="#1D5C57" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 38V88M46 38V88M68 38V88"/>
    <path d="M24 44L46 64M46 44L24 64M24 64L46 84M46 64L24 84" stroke-width="1"/>
    <path d="M46 44L68 64M68 44L46 64M46 64L68 84M68 64L46 84" stroke-width="1"/>
    <path d="M244 38V88M264 38V88"/>
    <path d="M244 44L264 64M264 44L244 64M244 64L264 84M264 64L244 84" stroke-width="1"/>
  </g>

  <!-- Iconic parabolic steel arch spanning 125th Street -->
  <path d="M84 88C106 46 214 46 236 88" stroke="#13423E" stroke-width="3.2" fill="none"/>
  <path d="M92 88C112 52 208 52 228 88" stroke="#2A7268" stroke-width="1.6" fill="none"/>
  <!-- Spandrel vertical struts connecting arch to viaduct deck -->
  <g stroke="#1D5C57" stroke-width="1.2">
    <line x1="100" y1="38" x2="100" y2="66"/>
    <line x1="120" y1="38" x2="120" y2="54"/>
    <line x1="140" y1="38" x2="140" y2="48"/>
    <line x1="160" y1="38" x2="160" y2="46"/>
    <line x1="180" y1="38" x2="180" y2="48"/>
    <line x1="200" y1="38" x2="200" y2="54"/>
    <line x1="220" y1="38" x2="220" y2="66"/>
  </g>

  <!-- Elevated viaduct steel deck girder -->
  <rect x="8" y="34" width="304" height="5" rx="1" fill="#1D5C57"/>
  <line x1="10" y1="36.5" x2="310" y2="36.5" stroke="#2B7A72" stroke-width="1"/>

  <!-- 125 St Station house canopy (burgundy roof + white window bays) -->
  <rect x="132" y="21" width="166" height="13" fill="#FFFFFF" stroke="#64748B" stroke-width="0.9"/>
  <g stroke="#94A3B8" stroke-width="0.8">
    <line x1="148" y1="21" x2="148" y2="34"/>
    <line x1="164" y1="21" x2="164" y2="34"/>
    <line x1="180" y1="21" x2="180" y2="34"/>
    <line x1="196" y1="21" x2="196" y2="34"/>
    <line x1="212" y1="21" x2="212" y2="34"/>
    <line x1="228" y1="21" x2="228" y2="34"/>
    <line x1="244" y1="21" x2="244" y2="34"/>
    <line x1="260" y1="21" x2="260" y2="34"/>
    <line x1="276" y1="21" x2="276" y2="34"/>
  </g>
  <path d="M128 21L136 15H296L302 21H128Z" fill="#8B2E2E" stroke="#681F1F" stroke-width="0.8"/>

  <!-- Passing 3-car stainless steel IRT (1) train along viaduct deck -->
  <g clip-path="url(#${clipId})">
    <g>
      <animateTransform attributeName="transform" type="translate" from="-175 0" to="335 0" dur="3.4s" repeatCount="indefinite"/>
      <!-- Car 1 -->
      <rect x="0" y="21" width="52" height="13" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="3" y="24" width="46" height="4.2" rx="0.8" fill="#1E293B"/>
      <line x1="2" y1="30.5" x2="50" y2="30.5" stroke="#94A3B8" stroke-width="0.8"/>
      <circle cx="5" cy="31.5" r="1.2" fill="#EE352E"/>
      <!-- Car 2 -->
      <rect x="54" y="21" width="52" height="13" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="57" y="24" width="46" height="4.2" rx="0.8" fill="#1E293B"/>
      <line x1="56" y1="30.5" x2="104" y2="30.5" stroke="#94A3B8" stroke-width="0.8"/>
      <!-- Lead Car 3 -->
      <rect x="108" y="21" width="54" height="13" rx="2" fill="#F1F5F9" stroke="#334155" stroke-width="0.9"/>
      <rect x="111" y="24" width="46" height="4.2" rx="0.8" fill="#1E293B"/>
      <line x1="110" y1="30.5" x2="158" y2="30.5" stroke="#94A3B8" stroke-width="0.8"/>
      <circle cx="155" cy="26" r="2.2" fill="#EE352E"/>
      <circle cx="159.5" cy="31" r="1.4" fill="#FEF08A"/>
      <path d="M161 30L174 27V35L161 32Z" fill="#FEF08A" opacity="0.45"/>
    </g>
  </g>
</svg>`;
}

/**
 * 53rd Street Bilevel Station Cross-Section SVG Animation (DuckDB-Wasm Booting).
 * Longitudinal cutaway showing two stacked subway levels with authentic
 * Fifth Ave / 53rd St terracotta-red & white square ceramic wall tiling,
 * slatted ceiling baffles, yellow tactile platform edge strips, and trains
 * moving horizontally in opposite directions along upper and lower trackbeds.
 */
export function getBilevel53rdLoadingSvg(width = 280, height = 91): string {
  const seq = ++loadingSvgClipSeq;
  const upperClipId = `bilevel53-upper-${seq}`;
  const lowerClipId = `bilevel53-lower-${seq}`;
  const whiteTileId = `bilevel53-wtile-${seq}`;
  const redTileId = `bilevel53-rtile-${seq}`;
  const slatCeilId = `bilevel53-slat-${seq}`;
  return `<svg class="dbtc-loading-svg dbtc-bilevel-53rd-svg" viewBox="0 0 320 104" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="53rd Street bilevel station cross-section animation">
  <defs>
    <clipPath id="${upperClipId}">
      <rect x="16" y="13" width="288" height="33"/>
    </clipPath>
    <clipPath id="${lowerClipId}">
      <rect x="16" y="57" width="288" height="33"/>
    </clipPath>
    <!-- White square ceramic subway wall tiles -->
    <pattern id="${whiteTileId}" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="#F8FAFC"/>
      <path d="M4 0H0V4" stroke="#CBD5E1" stroke-width="0.55"/>
    </pattern>
    <!-- Glazed terracotta-red 5th Ave / 53rd St upper wall tiles -->
    <pattern id="${redTileId}" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="#C83722"/>
      <path d="M4 0H0V4" stroke="#F1F5F9" stroke-width="0.45" opacity="0.7"/>
    </pattern>
    <!-- Slatted metal baffle ceiling -->
    <pattern id="${slatCeilId}" width="4" height="2" patternUnits="userSpaceOnUse">
      <rect width="4" height="2" fill="#E2E8F0"/>
      <line x1="0" y1="1.5" x2="4" y2="1.5" stroke="#94A3B8" stroke-width="0.6"/>
    </pattern>
  </defs>

  <!-- Architectural cutaway concrete shell (stone-beige section fill) -->
  <rect x="4" y="4" width="312" height="96" rx="8" fill="#ECE6E1" stroke="#334155" stroke-width="1.2"/>

  <!-- Upper Level Chamber with 5th Ave / 53rd St ceramic tiling -->
  <rect x="14" y="12" width="292" height="35" rx="2" fill="#FFFFFF" stroke="#334155" stroke-width="1.1"/>
  <!-- Slatted ceiling + fluorescent light bar -->
  <rect x="14.5" y="12.5" width="291" height="4.5" fill="url(#${slatCeilId})"/>
  <line x1="16" y1="16.8" x2="304" y2="16.8" stroke="#FFFFFF" stroke-width="1.1" opacity="0.9"/>
  <!-- Red glazed tile band + white square ceramic wall tiles -->
  <rect x="14.5" y="17" width="291" height="10" fill="url(#${redTileId})"/>
  <rect x="14.5" y="27" width="291" height="15" fill="url(#${whiteTileId})"/>
  <!-- White mosaic "Fifth Avenue" tile name tablet & black-framed subway posters -->
  <rect x="206" y="17.8" width="34" height="3.2" rx="0.4" fill="#B91C1C" stroke="#F8FAFC" stroke-width="0.45"/>
  <line x1="210" y1="19.4" x2="236" y2="19.4" stroke="#FFFFFF" stroke-width="1" stroke-linecap="round"/>
  <rect x="176" y="22.5" width="18" height="11" fill="#1E293B" stroke="#F8FAFC" stroke-width="0.5"/>
  <rect x="178" y="24" width="14" height="8" fill="#F8FAFC"/>
  <rect x="180" y="25.5" width="4" height="5" fill="#0039A6"/>
  <rect x="186" y="25.5" width="4" height="5" fill="#FF6319"/>
  <rect x="256" y="22.5" width="18" height="11" fill="#1E293B" stroke="#F8FAFC" stroke-width="0.5"/>
  <rect x="258" y="24" width="14" height="8" fill="#F8FAFC"/>
  <circle cx="265" cy="28" r="2.2" fill="#1E293B"/>

  <!-- Support columns -->
  <g fill="#E2E8F0" stroke="#64748B" stroke-width="0.7">
    <rect x="74" y="16" width="4.5" height="26"/>
    <rect x="158" y="16" width="4.5" height="26"/>
    <rect x="242" y="16" width="4.5" height="26"/>
  </g>
  <!-- Iconic Exit / 5th Ave hanging MTA sign -->
  <line x1="46" y1="12" x2="46" y2="17" stroke="#334155" stroke-width="0.9"/>
  <rect x="24" y="17" width="46" height="8" rx="1" fill="#0F172A"/>
  <rect x="25" y="18" width="14" height="6" rx="0.5" fill="#DC2626"/>
  <line x1="42" y1="21" x2="66" y2="21" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/>
  <!-- Upper commuter silhouette & yellow tactile platform strip -->
  <circle cx="102" cy="33" r="1.8" fill="#1E293B"/>
  <path d="M100 35.5H104L104.5 42H99.5L100 35.5Z" fill="#1E293B"/>
  <rect x="14.5" y="41.5" width="291" height="1.8" fill="#FACC15"/>
  <rect x="14" y="43" width="292" height="4" fill="#94A3B8"/>
  <line x1="14" y1="43" x2="306" y2="43" stroke="#475569" stroke-width="0.9"/>

  <!-- Mezzanine Structural Concrete Floor Slab separating the two levels -->
  <rect x="10" y="47" width="300" height="9" fill="#E2D9D3" stroke="#334155" stroke-width="1"/>
  <!-- Stairwell / transfer shaft cutaway between levels -->
  <rect x="130" y="47" width="24" height="9" fill="#F8FAFC" stroke="#64748B" stroke-width="0.7"/>
  <path d="M132 55L152 48" stroke="#64748B" stroke-width="1" stroke-dasharray="2 1.5"/>

  <!-- Lower Level Chamber (stacked directly below) with matching 53rd St tiling -->
  <rect x="14" y="56" width="292" height="35" rx="2" fill="#FFFFFF" stroke="#334155" stroke-width="1.1"/>
  <rect x="14.5" y="56.5" width="291" height="4" fill="url(#${slatCeilId})"/>
  <rect x="14.5" y="60.5" width="291" height="9.5" fill="url(#${redTileId})"/>
  <rect x="14.5" y="70" width="291" height="15.5" fill="url(#${whiteTileId})"/>
  <!-- Lower level subway poster & columns -->
  <rect x="92" y="65.5" width="18" height="10.5" fill="#1E293B" stroke="#F8FAFC" stroke-width="0.5"/>
  <rect x="94" y="67" width="14" height="7.5" fill="#F8FAFC"/>
  <rect x="96" y="68.5" width="10" height="4.5" fill="#FACC15"/>
  <g fill="#E2E8F0" stroke="#64748B" stroke-width="0.7">
    <rect x="74" y="59" width="4.5" height="27"/>
    <rect x="158" y="59" width="4.5" height="27"/>
    <rect x="242" y="59" width="4.5" height="27"/>
  </g>
  <!-- Lower level station sign, commuter silhouette & yellow tactile edge -->
  <rect x="218" y="60" width="44" height="7" rx="1" fill="#0F172A"/>
  <circle cx="224" cy="63.5" r="2.2" fill="#0039A6"/>
  <line x1="229" y1="63.5" x2="258" y2="63.5" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round"/>
  <circle cx="192" cy="77" r="1.8" fill="#1E293B"/>
  <path d="M190 79.5H194L194.5 86H189.5L190 79.5Z" fill="#1E293B"/>
  <rect x="14.5" y="85.5" width="291" height="1.8" fill="#FACC15"/>
  <rect x="14" y="87" width="292" height="4" fill="#94A3B8"/>
  <line x1="14" y1="87" x2="306" y2="87" stroke="#475569" stroke-width="0.9"/>

  <!-- Upper Level Train (E train, moving left-to-right horizontally) -->
  <g clip-path="url(#${upperClipId})">
    <g>
      <animateTransform attributeName="transform" type="translate" from="-170 0" to="325 0" dur="3.0s" repeatCount="indefinite"/>
      <rect x="0" y="29" width="50" height="13.5" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="3" y="32" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="2" y="38.5" width="46" height="1.6" fill="#0039A6"/>
      <rect x="52" y="29" width="50" height="13.5" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="55" y="32" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="54" y="38.5" width="46" height="1.6" fill="#0039A6"/>
      <rect x="104" y="29" width="52" height="13.5" rx="2" fill="#F1F5F9" stroke="#334155" stroke-width="0.9"/>
      <rect x="107" y="32" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="106" y="38.5" width="46" height="1.6" fill="#0039A6"/>
      <circle cx="149" cy="34" r="2.2" fill="#0039A6"/>
      <circle cx="153.5" cy="39.5" r="1.3" fill="#FEF08A"/>
      <path d="M155 38.5L168 36V43L155 40.5Z" fill="#FEF08A" opacity="0.45"/>
    </g>
  </g>

  <!-- Lower Level Train (F train, moving right-to-left horizontally) -->
  <g clip-path="url(#${lowerClipId})">
    <g>
      <animateTransform attributeName="transform" type="translate" from="325 0" to="-170 0" dur="2.6s" repeatCount="indefinite"/>
      <rect x="0" y="73" width="52" height="13.5" rx="2" fill="#F1F5F9" stroke="#334155" stroke-width="0.9"/>
      <rect x="5" y="76" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="4" y="82.5" width="46" height="1.6" fill="#FF6319"/>
      <circle cx="7" cy="78" r="2.2" fill="#FF6319"/>
      <circle cx="2.5" cy="83.5" r="1.3" fill="#FEF08A"/>
      <path d="M1 82.5L-12 80V87L1 84.5Z" fill="#FEF08A" opacity="0.45"/>
      <rect x="54" y="73" width="50" height="13.5" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="57" y="76" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="56" y="82.5" width="46" height="1.6" fill="#FF6319"/>
      <rect x="106" y="73" width="50" height="13.5" rx="2" fill="#E2E8F0" stroke="#475569" stroke-width="0.9"/>
      <rect x="109" y="76" width="44" height="4.2" rx="0.8" fill="#1E293B"/>
      <rect x="108" y="82.5" width="46" height="1.6" fill="#FF6319"/>
    </g>
  </g>
</svg>`;
}
