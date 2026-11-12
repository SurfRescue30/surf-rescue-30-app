// What the app guide says about each component. One entry per numbered
// marker; `selector` is measured on the live app to place the marker.
// Keep this in step with the app: when a component changes, update its text
// here and re-run `node docs/guide/build-guide.mjs`, then republish.
//
// Fields: what (what it is), use (how the crew use it), data (where its
// information comes from), note (status, limits, open questions).

export const SCREENS = [
  {
    id: 'start',
    title: 'Start of patrol',
    blurb: 'Shown once when a patrol begins, and again whenever someone taps the crew bar to make a change. After that the app opens straight to the log until New Patrol is tapped.',
    components: [
      { selector: '#start-screen .start-group:nth-of-type(1)', title: 'Duty',
        what: 'Patrol, Training or Other, matching the Duty line on the paper Patrol Operations Log.',
        use: 'Patrol is already selected. Tap Training or Other; Other opens a box to describe the duty.',
        data: 'Saved on the device with the patrol.' },
      { selector: '#patrol-date', title: 'Date',
        what: 'The patrol date, defaulting to today.',
        use: 'Change it only when logging a patrol after the fact. Times on and off are not entered here; they are filled in afterwards.',
        data: 'The phone\'s local date (Sydney time).' },
      { selector: '#crew-skipper', title: 'Skipper (S) and Driver (D)',
        what: 'Skipper and driver, using the award codes from the paper form. Optional, like everything on this screen.',
        use: 'Type a name or pick one the phone remembers from earlier patrols.',
        data: 'Names are remembered on this device only.' },
      { selector: '#crew-extras', title: 'Crew (C)',
        what: 'Optional crew rows: two to start (four spots with skipper and driver), and as many more as needed.',
        use: 'Tap ✕ to remove an empty row. Mid-patrol the button reads Log off and records the time that person left.',
        note: 'Crew changes are written into the log automatically, so the report shows who was on board when.' },
      { selector: '#add-crew-btn', title: '+ Add crew',
        what: 'Adds another crew row.',
        use: 'Use it for extra crew or a replacement joining mid-patrol.' },
      { selector: '#start-btn', title: 'Start Patrol',
        what: 'Saves the duty, date and crew and opens the log.',
        use: 'Nothing is required, so it always opens the log. Names left blank can be added later by tapping the crew bar.' }
    ]
  },
  {
    id: 'log',
    title: 'Log',
    blurb: 'The main screen. The red and yellow header scrolls away; the blue tabs and the 2 NM bar stay pinned at the top, and the microphone stays at the bottom.',
    components: [
      { selector: '#tabs', title: 'Tabs',
        what: 'Log, Weather, Tools and Info. They stay pinned while the page scrolls.',
        use: 'The red number on Weather is the count of current BOM warnings for Sydney waters.',
        note: 'The app reopens on whichever tab was last used.' },
      { selector: '#boundary-bar', title: '2 NM boundary bar',
        what: 'Live distance from the nearest land, island, rock platform or reef, and how far inside (or beyond) the 2 NM limit the boat is.',
        use: 'Green inside the limit, yellow within 500 m of it, flashing red beyond it. Tap it to open the boundary map. Turned on in Tools.',
        data: 'Phone GPS against OpenStreetMap coastline and outcrops.',
        note: 'Works only while the app is open on screen; web apps get no GPS in the background. An aid only: the plotter is the authority.' },
      { selector: '#new-patrol-btn', title: 'New Patrol',
        what: 'Clears the log and crew and goes back to the start screen.',
        use: 'Asks for confirmation first. Send the End of Shift report before using it, as the log is cleared.' },
      { selector: '#report-btn', title: 'End of Shift',
        what: 'Builds the shift report: duty, date, crew (including who logged off and when), every entry with its time and position.',
        use: 'Opens the phone\'s share sheet (email, Notes, Messages…). On a computer it downloads a text file.' },
      { selector: '#warning-banner', title: 'Warning banner',
        what: 'The first current BOM warning for Sydney waters, and how many more there are.',
        use: 'Tap it to open the Weather tab.',
        data: 'BOM warnings, refreshed every 30 minutes.' },
      { selector: '#shift-summary', title: 'Crew bar',
        what: 'Duty, date and crew for this patrol.',
        use: 'Tap it to correct details, log a crew member off or add someone. Entries are kept.' },
      { selector: '.log-entry', title: 'Log entry',
        what: 'One observation: time it was started, the words, and the position with the nearest landmark (for example "0.2 NM 096°T from Boora Point").',
        use: 'Tap to edit or delete. Swipe sideways also deletes, after an in-app confirmation. Entries are saved instantly and survive the app closing.',
        data: 'Speech to text with local place names, marine terms and 24-hour times corrected; phone GPS.' },
      { selector: '#mark-btn', title: 'Mark',
        what: 'Logs the current GPS position immediately, with no speaking.',
        use: 'For a person overboard, a sighting or a turning point. Edit the entry afterwards to add detail.' },
      { selector: '#dictate-btn', title: 'Log Entry (microphone)',
        what: 'Starts and stops a voice entry.',
        use: 'Push to talk: tap once and speak after the tone, tap Stop & Save when finished. One tone at the start and one at the end.',
        note: 'If the phone stops listening by itself after a long pause, what was heard is saved and the button changes to Continue entry for a minute: tap it to keep adding to the same entry. Dictation needs mobile signal.' }
    ]
  },
  {
    id: 'recording',
    title: 'Recording a voice entry',
    blurb: 'What the bottom of the Log looks like while the mic is on.',
    components: [
      { selector: '#live-box', title: 'Live box',
        what: 'Shows the words as they are heard, a LIVE marker and a timer.',
        use: 'Grey words are still being worked out; they firm up as you speak. Check them before tapping Stop.',
        note: 'The screen is kept awake while recording.' },
      { selector: '#dictate-btn', title: 'Stop & Save Entry',
        what: 'Finishes the entry and saves it with the time recording started and the GPS position.' }
    ]
  },
  {
    id: 'weather',
    title: 'Weather',
    blurb: 'Conditions off Malabar, BOM warnings and the official BOM marine forecast, all inside the app.',
    components: [
      { selector: '.unit-row', title: 'Wind speed units',
        what: 'Knots or km/h. The selected one is filled yellow with a tick.',
        use: 'Each phone remembers its own choice. Applies to the tiles, the 24-hour strip and observed wind.',
        note: 'The Windy map keeps the units it opened with; it has its own unit setting on the map legend.' },
      { selector: '#warnings-card', title: 'Warnings',
        what: 'Current BOM warnings for Sydney waters (Sydney Coast and Sydney Enclosed Waters): strong wind, gale, hazardous surf, and severe weather for Sydney.',
        use: 'Collapsed to one line to save room; tap to see the list.',
        data: 'BOM via its public FTP service, fetched every 30 minutes by a GitHub job.',
        note: 'If there is no signal, the last saved copy is shown with its age.' },
      { selector: '#wx-now .tile:nth-child(1)', title: 'Wind',
        what: 'Wind speed and direction now, with gusts. Direction is where it comes from.',
        data: 'Open-Meteo weather model (free, no account).' },
      { selector: '#wx-now .tile:nth-child(2)', title: 'Swell',
        what: 'Ocean swell height, direction and period (seconds between waves).',
        data: 'Open-Meteo marine model.' },
      { selector: '#wx-now .tile:nth-child(3)', title: 'Tide',
        what: 'Rising or falling, then the next high and low in time order (the next tide first), each with its height in 24-hour time. Within 15 minutes of a turn it says "Near high" or "Near low".',
        data: 'Calculated on the phone from Fort Denison tide constants fitted to the measured tide-gauge record (University of Hawaii Sea Level Center). Free, and works with no signal.',
        note: 'Checked against three months of real readings: high and low times within 3 minutes (median), 90% within 8 minutes. Heights are above chart datum. Botany Bay and the open coast turn within a few minutes of Fort Denison.' },
      { selector: '#wx-now .tile:nth-child(4)', title: 'Water',
        what: 'Sea surface temperature, with air temperature.' },
      { selector: '#wx-now .tile:nth-child(5)', title: 'Sunrise / Sunset',
        what: 'Calculated on the phone for Malabar, so it works without signal.' },
      { selector: '#wx-now .tile:nth-child(6)', title: 'First / Last Light',
        what: 'Civil twilight: when it is light enough to work without lights.',
        data: 'Calculated on the phone.' },
      { selector: '#wx-now .tile-moon', title: 'Moon',
        what: 'Moon phase, how much of it is lit, whether it is up now, and the next moonrise and moonset. The drawing is the moon as seen from Sydney: a waxing moon is lit on the left.',
        data: 'Calculated on the phone, so it works without signal. Rise and set within a few minutes.',
        note: 'For night work, % lit and whether the moon is up tell you how dark it will be on the water.' },
      { selector: '#wx-strip', title: 'Next 24 hours',
        what: 'Hour-by-hour strip: sky, temperature, rain, wind and gusts (coloured by strength), wind direction arrows, swell height, period and direction, and tide direction. Night hours have a dark time and sky cell: a clear or partly cloudy night shows the moon at its phase when it is up, or a star (dark sky) when it is down.',
        use: 'Swipe sideways for later hours. The outlined column is now; a thick line marks midnight.',
        data: 'Day or night from the weather model; moon calculated on the phone.' },
      { selector: '#map-pills', title: 'Live map',
        what: 'Windy map with Wind, Waves and Radar layers, and a Full screen map button.',
        use: 'Loads when you scroll to it, so the rest of the tab is quick; a spinner shows while a layer loads. Use Full screen map for pinch zoom, so the page can\'t take the gesture. On Radar a white dot marks Malabar (it hides once you move the map); tap ▶ to play the last hour.',
        note: 'Windy\'s free embed has no autoplay setting.' },
      { selector: '#bom-card', title: 'BOM Marine Forecast',
        what: 'The official BOM forecast for Sydney Coast (Broken Bay to Port Hacking): winds, seas, swell, weather and cautions for today and tomorrow.',
        data: 'BOM coastal waters forecast (FTP), every 30 minutes.' },
      { selector: '.source-links', title: 'BOM links',
        what: 'Links to the full BOM pages for Sydney waters, warnings and the radar loop, for anything not shown in the app.' }
    ]
  },
  {
    id: 'tools',
    title: 'Tools',
    blurb: 'Planning aids for a job. They are aids only; the plotter and charts are the authority.',
    components: [
      { selector: '#route-from-btn', title: 'Job Route: From',
        what: 'Where you are: current GPS or a named place. Tapping it opens a full-screen place chooser with an empty search box and the keyboard up; places are grouped by area and the current one is highlighted.',
        use: 'Type part of a name, or close the keyboard and scroll the whole list, then tap a place. Scrolling never closes the chooser; Close backs out without a change.',
        data: '334 places chosen by the crew in the SR30 Route Locations list, from Scarborough to Norah Head, with boat ramps and wharves first. Positions from OpenStreetMap.' },
      { selector: '#route-to-btn', title: 'Job Route: To',
        what: 'The job location, chosen the same way.' },
      { selector: '#route-speed', title: 'Speed',
        what: 'Planned speed in knots, used for the time to the job and the ETA.',
        use: 'Remembered on the device.' },
      { selector: '#route-result', title: 'Route result',
        what: 'Distance by water, time at your speed, numbered courses (degrees true and distance for each leg), straight-line distance and ETA if leaving now.',
        use: 'A spinner shows while the route is worked out (under a second). Changing the speed updates the times straight away without working out the route again.',
        note: 'Detailed from Era Beach to Long Reef, the harbour, Botany Bay to Tom Uglys Bridge and Port Hacking: routes go around headlands and rocks, keep mid-channel and follow charted channels where mapped. Anywhere else the route is marked approx.: a straight line when it is clear of land, otherwise around land (e.g. into Pittwater round Barrenjoey), but not around rocks or shallows. A route into river or estuary water (Georges River, Port Hacking, Pittwater, Hawkesbury and Cowan Creek, Brisbane Water, Lake Macquarie) shows a yellow warning box: check the depth (the tool does not confirm depth) and the tide, with the next tide turn at Fort Denison.' },
      { selector: '#route-map', title: 'Route map',
        what: 'The route drawn over the coastline: green start, red job location, dashed red track. Each place name sits on whichever side of its dot has room, so it is never cut off.' },
      { selector: '#sdt-speed', title: 'Calculator: Speed, Distance, Time',
        what: 'Fill in any two and the third is worked out. Knots and nautical miles by default; km/h and km available.',
        use: 'Time answers also show the ETA if leaving now.' },
      { selector: '#fuel-onboard', title: 'Fuel & Range',
        what: 'Endurance and radius from fuel on board, burn rate and cruise speed, using the rule of thirds (⅓ out, ⅓ back, ⅓ reserve).',
        use: 'For long searches, tows or jobs outside the usual area. Use a higher burn rate when towing or in heavy seas.',
        note: 'Needs the real burn rate from the skipper. Tank capacity 450 L.' },
      { selector: '#boundary-toggle', title: '2 NM boundary alarm',
        what: 'Turns the boundary watch on or off.',
        use: 'Turn on once under way. Warns 500 m before the 2 NM limit and again beyond it, with sound, vibration (Android) and a notification (Android, or iPhone/iPad with the app on the Home Screen).',
        note: 'Keep the app open on screen while it is on; see How GPS works.' },
      { selector: '#boundary-map', title: 'Boundary map',
        what: 'The 2 NM limit (red) and the 500 m warning line (dashed), measured from the outermost land, island, rock platform or reef, with the boat\'s position.',
        note: 'Mapped from South Head to Cape Baily.' }
    ]
  },
  {
    id: 'info',
    title: 'Info',
    blurb: 'Setup check and reference material. Draft content to be confirmed against current SLSA SOPs.',
    components: [
      { selector: '#setup-card', title: 'Phone Setup Check',
        what: 'Shows whether Microphone, Location and Notifications are Allowed, Blocked or Not asked yet.',
        use: 'Each crew member taps Allow access once at the start of a patrol, or taps any row that says Not asked yet. Tapping a Blocked row opens the steps to unblock it: once blocked, phones only let you change it in settings.' },
      { selector: '#panel-info details:nth-of-type(1)', title: 'Surf Rescue 30 quick facts',
        what: 'Callsign, base, coverage, operations, vessel, survey, fuel, tasking (13SURF), comms, navigation, safety gear, equipment and the ORB coordinator contact.' },
      { selector: '#panel-info details:nth-of-type(2)', title: 'Distress, urgency & safety calls',
        what: 'MAYDAY, PAN-PAN and SÉCURITÉ call formats, channel 16, and the Vessel Traffic Services channels: Botany Bay VHF Ch 12, Sydney Harbour VHF Ch 13.' },
      { selector: '#panel-info details:nth-of-type(3)', title: 'Phonetic alphabet & prowords' },
      { selector: '#panel-info details:nth-of-type(4)', title: 'Beaufort scale',
        what: 'Force, knots, description and sea state, with the Strong Wind and Gale Warning thresholds.' }
    ]
  },
  {
    id: 'edit',
    title: 'Editing an entry',
    blurb: 'Tapping any log entry opens this.',
    components: [
      { selector: '#edit-text', title: 'Entry text',
        what: 'The words of the entry, ready to correct (for example a misheard place name).' },
      { selector: '#edit-delete', title: 'Delete', what: 'Removes the entry after a confirmation.' },
      { selector: '#edit-save', title: 'Save', what: 'Keeps the corrected text. The time and position stay as recorded.' }
    ]
  }
];

// Text-only sections shown after the screens: how things behave over time,
// which a screenshot can't show.
export const EXPLAINERS = [
  {
    id: 'gps',
    title: 'How GPS works',
    blurb: 'The app is a website, so it only gets GPS while it is open on screen. Here is exactly when a position is taken.',
    rows: [
      { when: 'Voice entry', what: 'One GPS fix is taken when you tap Log Entry. The entry is stamped with it, plus the nearest landmark. If the fix arrives after you tap Stop, it is added to the entry a moment later.' },
      { when: 'Mark button', what: 'One fresh GPS fix, taken the moment you tap it (waits up to 20 seconds for a good fix).' },
      { when: 'Job Route from "Current GPS position"', what: 'One fix when the route is worked out. It does not follow the boat; pick the start again to recalculate.' },
      { when: '2 NM boundary alarm', what: 'Watches GPS continuously while the alarm is on and the app is open on screen, updating every few seconds as the boat moves. The screen is kept awake so it stays on.' },
      { when: 'Phone locked, or another app open', what: 'GPS stops. Phones pause websites in the background, so the boundary alarm cannot warn you while the phone is locked or you are in another app. Nothing is recorded in the meantime.' },
      { when: 'Back in the app', what: 'The boundary alarm resumes automatically and takes a new fix within a few seconds. Earlier entries keep the positions they were saved with.' },
      { when: 'No signal', what: 'GPS still works with no mobile signal (it comes from satellites), so positions and the boundary alarm keep working. Voice entry and weather need signal.' }
    ],
    note: 'For continuous tracking with the phone locked, a native app would be needed. The boat\'s plotter is the authority for position.'
  }
];
