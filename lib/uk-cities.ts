// UK city/town dictionary used by the address-to-city extractor.
// Curated list of major cities, large towns and boroughs likely to appear
// in haulage/commercial-vehicle customer addresses across England, Scotland,
// Wales and Northern Ireland. Longest matches win.
export const UK_CITIES: string[] = [
  // England — major
  'London','Birmingham','Leeds','Sheffield','Manchester','Bradford','Liverpool','Bristol','Coventry','Leicester',
  'Nottingham','Newcastle upon Tyne','Newcastle','Brighton','Hove','Portsmouth','Plymouth','Southampton','Reading','Derby',
  'Stoke-on-Trent','Stoke on Trent','Wolverhampton','Sunderland','Milton Keynes','Northampton','Norwich','Walsall','Bournemouth','Peterborough',
  'Luton','Aldershot','Southend-on-Sea','Southend','Swindon','Crawley','Ipswich','Wigan','Mansfield','Oxford',
  'Warrington','Slough','Gloucester','Rotherham','Cambridge','Exeter','Eastbourne','Sutton Coldfield','Blackpool','Colchester',
  'Oldham','St Helens','Saint Helens','Woking','Doncaster','Rochdale','Basingstoke','Worthing','Chelmsford','Maidstone',
  'Basildon','Bedford','Worcester','Yeovil','Lincoln','Chester','Bath','Hereford','Salisbury','Carlisle',
  'Cheltenham','Birkenhead','Bolton','Bury','Halifax','Huddersfield','High Wycombe','Lancaster','Wakefield','Stevenage',
  'Crewe','Hartlepool','Hemel Hempstead','Watford','Burnley','Grimsby','Scunthorpe','Stockton-on-Tees','Stockton','Middlesbrough',
  'Darlington','Redcar','Telford','Tamworth','Loughborough','Kettering','Corby','Macclesfield','Hyde','Bredbury','Stockport',
  'Dukinfield','Atherton','Haydock','Ashton-under-Lyne','Ashton under Lyne','Trafford','Trafford Park','Salford','Stretford','Altrincham',
  'Eccles','Sale','Urmston','Bolton','Hindley','Knutsford','Wilmslow','Glossop','Buxton','Congleton',
  'Sandbach','Northwich','Winsford','Runcorn','Widnes','Ellesmere Port','Frodsham','Chester','Wrexham',
  // South
  'Guildford','Tunbridge Wells','Royal Tunbridge Wells','Hastings','Folkestone','Dover','Canterbury','Margate','Ramsgate','Ashford',
  'Sevenoaks','Tonbridge','Dartford','Gravesend','Bromley','Croydon','Sutton','Kingston upon Thames','Kingston','Richmond',
  'Twickenham','Hounslow','Ealing','Brentford','Uxbridge','Harrow','Wembley','Enfield','Barnet','Romford',
  'Ilford','Dagenham','Stratford','Greenwich','Lewisham','Wandsworth','Hammersmith','Fulham','Hackney','Tottenham',
  // North West
  'Liverpool','Wirral','Wallasey','Birkenhead','Bootle','Crosby','Maghull','Formby','Southport','Kirkby',
  'Skelmersdale','Ormskirk','Preston','Blackburn','Accrington','Burnley','Nelson','Colne','Clitheroe','Chorley',
  'Leyland','Lancaster','Morecambe','Kendal','Penrith','Workington','Whitehaven','Barrow-in-Furness','Barrow',
  // Yorkshire / Humberside
  'Leeds','Bradford','Wakefield','Halifax','Huddersfield','Dewsbury','Batley','Pontefract','Castleford','Goole',
  'Doncaster','Rotherham','Sheffield','Barnsley','York','Harrogate','Skipton','Keighley','Beverley','Hull',
  'Kingston upon Hull','Bridlington','Scarborough','Whitby',
  // East Midlands
  'Nottingham','Derby','Leicester','Lincoln','Loughborough','Mansfield','Worksop','Newark','Boston','Grantham',
  'Spalding','Skegness',
  // East of England
  'Norwich','Great Yarmouth','Lowestoft','King’s Lynn','Kings Lynn','Ipswich','Bury St Edmunds','Cambridge','Ely','Huntingdon',
  'St Neots','Bedford','Luton','Dunstable','Stevenage','Hitchin','Letchworth','Hertford','Hatfield','Welwyn Garden City',
  'St Albans','Borehamwood',
  // South West
  'Bristol','Bath','Weston-super-Mare','Yeovil','Taunton','Bridgwater','Exeter','Plymouth','Torquay','Paignton',
  'Newton Abbot','Truro','Penzance','St Austell','Falmouth','Bodmin','Tiverton','Honiton','Salisbury','Andover',
  // West Midlands
  'Birmingham','Wolverhampton','Coventry','Solihull','Walsall','Dudley','Sutton Coldfield','West Bromwich','Halesowen','Stourbridge',
  'Worcester','Kidderminster','Redditch','Bromsgrove','Telford','Shrewsbury','Stafford','Stoke-on-Trent','Newcastle-under-Lyme','Hereford',
  // North East
  'Newcastle upon Tyne','Gateshead','South Shields','North Shields','Sunderland','Washington','Durham','Chester-le-Street','Bishop Auckland','Consett',
  // Wales
  'Cardiff','Swansea','Newport','Wrexham','Barry','Bridgend','Caerphilly','Merthyr Tydfil','Pontypridd','Llanelli',
  'Carmarthen','Aberystwyth','Bangor','Llandudno','Rhyl','Colwyn Bay','Mold','Prestatyn',
  // Scotland
  'Glasgow','Edinburgh','Aberdeen','Dundee','Inverness','Stirling','Perth','Paisley','Hamilton','East Kilbride',
  'Cumbernauld','Livingston','Falkirk','Greenock','Kilmarnock','Ayr','Dunfermline','Kirkcaldy','Motherwell','Coatbridge',
  // Northern Ireland
  'Belfast','Londonderry','Derry','Lisburn','Bangor','Newry','Newtownabbey','Craigavon','Ballymena','Antrim',
  'Carrickfergus','Coleraine','Larne','Omagh','Enniskillen',
];

// Match the longest city name found in `address`. Case-insensitive,
// word-boundary aware so "Sheffield" doesn't match "Sheffield Road".
// Actually we want a loose substring match against the comma-separated parts:
// addresses are typically `street, area, city, county, postcode`.
export function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  // Normalise: split on commas/newlines/pipes
  const parts = address
    .split(/[,\n|]/g)
    .map((p) => p.trim())
    .filter(Boolean);
  // Reverse so we check city-ish parts first (cities tend to be late in the address)
  parts.reverse();

  // Build a Set for quick exact-match lookup (lowercased)
  const lookup = new Map<string, string>();
  for (const c of UK_CITIES) lookup.set(c.toLowerCase(), c);

  // 1. Try exact part match
  for (const p of parts) {
    const m = lookup.get(p.toLowerCase());
    if (m) return m;
  }
  // 2. Try multi-word match inside parts (e.g. "Stoke-on-Trent" inside a longer street)
  // Sort cities longest-first to avoid greedy short-match
  const sortedCities = [...UK_CITIES].sort((a, b) => b.length - a.length);
  const addrLower = address.toLowerCase();
  for (const c of sortedCities) {
    const re = new RegExp(`(^|\\W)${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
    if (re.test(addrLower)) return c;
  }
  return null;
}
