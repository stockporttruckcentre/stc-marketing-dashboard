# Maps and geocoding

What the CRM site map runs on, why, and what has to change if it outgrows it.

## What is in use

| Piece | Choice | Key needed |
|---|---|---|
| Map rendering | Leaflet | No |
| Map tiles | OpenStreetMap standard tiles | No |
| Address to coordinates | Nominatim, via `/api/geo/search` | No |
| Coordinates to address | Nominatim, via `/api/geo/reverse` | No |

**Nothing needs an API key today.** That was the deciding factor: the map
works the moment the branch is deployed, with no account to open, no card
on file, and no key to rotate when the CRM moves to your own servers.

Both geocoding calls are proxied through this app rather than made from
the browser. Three reasons, and they all matter later:

1. Nominatim requires an identifying `User-Agent`. A browser cannot set one.
2. Its policy allows at most one request per second. The proxy enforces
   that with a shared timer and caches repeat lookups.
3. When the geocoder changes, two route files change and nothing else does.

## What this is not suitable for

Be honest about the free tier before it bites:

- **OpenStreetMap tiles** are donated infrastructure. The usage policy
  permits modest applications and explicitly rules out heavy or commercial
  use. A dozen people opening a site map occasionally is fine. Bulk
  loading, or an embedded map on a customer-facing page, is not.
- **Nominatim** is the same deal, plus the one-per-second limit. Geocoding
  a whole imported portfolio in one go would breach it. If Dave's full
  address book gets loaded, geocode it as a background job with the delay
  respected, not in a loop on page load.
- **Address quality** is OpenStreetMap's, which is good for streets and
  patchy for individual industrial units. Dropping a pin by hand is often
  faster than fighting the geocoder, which is exactly why the map lets you
  place and drag one.

## When to move, and to what

Pick by what starts hurting first.

**If volume is the problem** (tiles rate-limited, or the usage policy
becomes a compliance question):

- **Mapbox.** Free to 50,000 map loads a month, then paid. Needs a public
  token. Best balance of price, quality and effort. A drop-in swap for the
  tile URL, and its geocoder replaces the two `/api/geo` routes.
- **Google Maps.** Best UK coverage and the most familiar to end users.
  Needs a key and a billing account with a card, and is the most expensive
  per load of the three.

**If UK address accuracy is the problem** (units, estates, non-postal
addresses), the geocoder is the piece to change rather than the map:

- **Ordnance Survey Places API.** The authoritative UK address database,
  including industrial units. Free for public sector, paid otherwise.
- **getaddress.io** or **Ideal Postcodes.** Postcode lookup with a proper
  address picker. Inexpensive, and the usual choice for a UK business form.
  These do postcode to address well but are not map tile providers.

**If the CRM ends up genuinely offline**, on the internal network with no
outbound internet, none of the hosted options work and tiles have to be
self-hosted. That is a real project, so it is worth confirming early
whether the local servers will have outbound access.

## What I need from you

Nothing to get this working. It runs now.

Decide only if one of the above starts to bite. If it does, the questions
are: is the pain volume or address accuracy, and is there budget for a
paid geocoder. A Mapbox token is a five minute job and a two line change
here.

## How to swap the provider

- **Tiles**: one `L.tileLayer(...)` call in `components/crm/AddressMap.tsx`.
- **Geocoding**: `app/api/geo/search/route.ts` and
  `app/api/geo/reverse/route.ts`. Both return a fixed shape, so the
  component does not change.

Keep the reverse route's UK address formatting when swapping. It rebuilds
the address the way a UK address is written, one line per part, rather
than returning the geocoder's single display string.

## Schema

`supabase/migrations/002_address_geo.sql` adds `lat`, `lng`, `geo_source`
and `geo_updated_at` to `contact_addresses`.

**The map works without it.** Addresses are geocoded on the fly when a
position has not been stored, and every write falls back to saving just
the address text when the columns are missing. Running the migration makes
pins persist, which stops the geocoder being called on every open.

`geo_source` records whether a human placed the pin. A pin marked `manual`
must never be quietly overwritten by a later geocode, because somebody
moved it there for a reason.
