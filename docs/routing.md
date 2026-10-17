# Route Planner Design — fastest & least-transfers

_status: draft v1 · covers: all Delhi Metro lines · last updated: Oct 2026_

## 1. Goal

Second use case of the app: pick any two stations on the network and instantly get
**two routes**:

1. **Best: by time (Fastest)**
2. **Best: changes (Least Changes)**

Both must be computed **on-device** — no network call, no server latency. On a mid-range
phone both results must render in < 50 ms so they can appear "instantly" as the user
types the station names.

This works for the full network but shares one data foundation with the alarm use case:
the same station/line data pack (alarm MVP uses the Blue Line subset of it).

## 2. Why this is easy on-device

The whole Delhi Metro graph is tiny: ~250 stations, ~6 edges per station (prev, next,
interchanges). A Dijkstra over a few hundred nodes runs in well under 1 ms on a phone.
The "fast" claim of this feature comes from being fully offline with a precomputed
compact graph, not from exotic algorithms.

## 3. Data model (shared with the app pack)

One `data/delhi_metro.json` (bag of files fine too):

```json
{
  "stations": [
    {
      "id": "rajiv_chowk",
      "name": "Rajiv Chowk",
      "lat": 28.6328, "lon": 77.2197,
      "lines": ["blue", "yellow"],
      "is_interchange": true
    }
  ],
  "lines": [
    {
      "id": "blue",
      "name": "Blue Line",
      "color": "#0057B7",
      "branches": [
        { "id": "noida", "stations": [
             { "id": "dwarka_sec21", "to_next_s": 165 },
             { "id": "dwarka_sec8",  "to_next_s": 150 }  // time from THIS station to next, forward direction
        ]},
        { "id": "vaishali", "stations": "..." }
      ]
    }
  ]
}
```

Assumptions:
- Inter-station travel times: median values (constant per segment) is enough for MVP;
  time-of-day fare/handicap is out of scope.
- Where branch lines split, travel time is constant from the branch point; the graph
  already handles splits as ordinary edges.

## 4. Graph construction

- **Nodes** = station "boarding points": (station, line, branch). A physical station with
  2 lines = 2 nodes (or 1 node + transfer edges — equivalent).
- **Edges**:
  - `ride edge`: Station A → next station on the same line/branch, weight = `to_next_s`
    (segment travel time).
  - `transfer edge`: within a physical interchange station, from (line A node) →
    (line B node), weight = `transfer_penalty_s` (walk + wait; default recipe ~300 s,
    tunable — used only by the fastest route).
- The graph is built once at app start (or shipped pre-built) — tiny memory footprint
  (a few KB of adjacency lists).

## 5. The two route computations

### 5.1 Fastest route

Plain **Dijkstra** from origin to destination over the weighted graph above.
Transfer penalty in the weights makes it naturally avoid silly one-extra-change routes
when riding 2 more stations is cheaper than walking across a big interchange.

### 5.2 Least-transfers route

Minimize **number of interchanges**, regardless of total time. Two ways; recommend (b):

- (a) Dijkstra with `transfer_penalty = ∞` (or huge). Simple, but can be cranky when
  no zero-transfer route exists (needs a tie-break behavior on time).
- (b) *Better fit for a product*: optimize **line graph** (nodes = actual route line
  changes): earliest-realizable routing with a two-objective step:
  1. BFS on line graph → gives min interchange count k*.
  2. Among all k*-transfer routes, pick the shortest in time (constrained Dijkstra:
     Dijkstra where state = (station, line, changes_used ≤ k*)).
  3. Result: "fewest possible changes AND, of those, the fastest" — the answer that
     actually makes sense to a rider.

### 5.3 Show route summary, not the algorithm

UI responses (for both routes):
- # transfers, total est. time (fastest route), stations count
- sequence of legs: board Line X at A → alight at Y (transfer) → … → destination
- per-leg: stations list visible on tap (uses the same per-line ordered station table
  the alarm feature uses)

## 6. Interface with the alarm feature

- Choosing a route with > 1 leg in MVP scope? MVP alarm only supports single-line
  travel. If the chosen route has a transfer, in MVP the alarm only watches
  the **final leg** (board, then alarm on last-leg destination) — matching the app's
  actual "wake me before my stop" purpose (documenting this as a known limitation).
- Post-MVP: alarm per leg (wake before each interchange if bound to alight there).

## 7. Performance verification plan (must be measured, not assumed)

- Microbenchmark in an RN release build (not dev mode): time-from-query-to-render for
  Dijkstra farthest stations (e.g., Dwarka Sec 21 ↔ Vaishali) — target < 50 ms p95,
  including UI state update.
- Assert per station-graph-compile < 10 ms at cold start; if exceeded, ship a
  pre-built adjacency JSON instead of building from the station list at boot.
- Test property: fastest and least-changes coincide when origin/destination share a line.

## 8. Verification & data quality checklist (harder than the algo)

- cross-check ~15 well-known journeys manually (Blue↔Yellow at Rajiv Chowk etc.)
- All "same station different branch" and "same name multiple stations" (e.g., two
  "Chandni Chowk"?) resolved during data pack preparation — the data pack lists those
  collisions explicitly (a record noting stations that span multiple lines or
  share names, flagged at collection time).

## 9. Open questions

- Pre-build vs build-at-boot for the graph — depends on the Phase P0 data pack size;
  expect trivial either way (a few hundred stations).
- Do we store per-direction times (`to_next_s` is direction-symmetric for MVP ≈ fine;
  real networks have slight asymmetry from gradients/turns — accept for MVP).
- Accessibility routing (e.g., prefer elevators) — post-MVP, needs station facility data.
