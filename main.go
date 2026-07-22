package main

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"html"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
	_ "modernc.org/sqlite"
)

// config is read from the environment; a .env file fills in blanks for local
// dev (godotenv.Load never overrides vars that are already set, so real env
// wins over the file).
type config struct {
	DBPath string `envconfig:"DB_PATH" default:"/data/trip.db"`
	Port   string `envconfig:"PORT" default:"8080"`
}

//go:embed all:web
var webFS embed.FS

var db *sql.DB

// trip ids are slugs — same charset the frontend enforces.
var tripRe = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

func validTrip(id string) bool { return tripRe.MatchString(id) }

// openDB opens (or creates) the SQLite store and ensures the schema.
func openDB(path string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := d.Exec(`CREATE TABLE IF NOT EXISTS trip(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)`); err != nil {
		return nil, err
	}
	// file: trip attachments (boarding passes, tickets, docs) — blobs kept out of
	// the /state JSON so they never hit its 1MB cap. Under /data with the db.
	if _, err := d.Exec(`CREATE TABLE IF NOT EXISTS file(id INTEGER PRIMARY KEY AUTOINCREMENT, trip TEXT, name TEXT, type TEXT, data BLOB, updated_at INTEGER)`); err != nil {
		return nil, err
	}
	return d, nil
}

// newMux wires every route. Split from main so tests can hit the handlers
// through httptest without starting the real server.
func newMux(web fs.FS) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// /whoami and /login only ever reach the app through the auth-private
	// ingress route, so a request arriving here has already cleared Authentik
	// forward-auth. The identity comes from the X-authentik-* headers the
	// outpost injects; reads (public routes) never hit these handlers.
	mux.HandleFunc("/whoami", whoamiHandler)
	mux.HandleFunc("/login", loginHandler)
	mux.HandleFunc("/state", stateHandler)
	mux.HandleFunc("/files", filesHandler)
	mux.HandleFunc("/expand", expandHandler)
	mux.Handle("/", http.FileServer(http.FS(web)))
	return mux
}

// whoamiHandler lets the SPA discover its login state. The ingress routes this
// path through forward-auth, so logged-out browsers get a 302 (which the
// SPA reads as "logged out" via fetch redirect:manual) and logged-in ones
// get this JSON back with their Authentik identity.
func whoamiHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]string{
		"user": r.Header.Get("X-authentik-email"),
		"name": r.Header.Get("X-authentik-username"),
	})
}

// loginHandler is the login trigger. Visiting it forces the forward-auth flow
// (Authentik + Google), which sets the session cookie; the handler then
// bounces the browser back to where it came from so subsequent writes carry
// the session. next is constrained to a local path to avoid open redirects.
func loginHandler(w http.ResponseWriter, r *http.Request) {
	next := r.URL.Query().Get("next")
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		next = "/"
	}
	http.Redirect(w, r, next, http.StatusFound)
}

// The only hosts /expand will fetch: the short-link domains Google Maps
// "share" hands out. Everything else is rejected up front — this endpoint
// must never become a proxy for arbitrary URLs.
var shortMapsHostRe = regexp.MustCompile(`^(maps\.app\.goo\.gl|goo\.gl|g\.co)$`)

// Hosts a short link may redirect through: the short domains themselves plus
// Google properties (www/maps/consent on any google TLD). A hop anywhere else
// stops the chain instead of being followed.
var googleHostRe = regexp.MustCompile(`^((www|maps|consent)\.)?google(\.com?)?(\.[a-z]{2})?$`)

const expandUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

var expandClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		host := req.URL.Hostname()
		if len(via) >= 10 || (!shortMapsHostRe.MatchString(host) && !googleHostRe.MatchString(host)) {
			return http.ErrUseLastResponse
		}
		// Go strips Cookie when a redirect crosses domains (goo.gl →
		// google.com); re-attach it so the consent opt-out survives the hop.
		req.Header.Set("Cookie", "SOCS=CAI")
		return nil
	},
}

// expandRequest builds the outbound request. A browser-ish UA gets the real
// page (with its server-rendered og: meta tags), and the SOCS cookie is a
// pre-made "reject all" consent choice that stops google.com bouncing EU
// requests to the consent wall.
func expandRequest(ctx context.Context, u string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", expandUA)
	req.Header.Set("Accept-Language", "en")
	req.Header.Set("Cookie", "SOCS=CAI")
	return req, nil
}

// readAtMost drains up to n bytes of a page; closing stays with the caller.
func readAtMost(r io.Reader, n int64) []byte {
	b, _ := io.ReadAll(io.LimitReader(r, n))
	return b
}

const maxPageBytes = 2 << 20

// Newer share links expand to a URL that names the place but carries no
// coordinates — those only exist inside the page. Only scrape bits that
// locate the *place* itself: the og:image static map (its center= is the
// pin) and the !3d<lat>!4d<lng> data blob from the canonical URL. The page
// also carries the map camera (/@lat,lng in URLs, APP_INITIALIZATION_STATE)
// — never scrape that: when the shared URL has no viewport, Google centres
// the camera by IP-geolocating the requester, i.e. wherever this server is
// running. Self-hosted at home, that pinned every such link to the house.
var pageCenterRe = regexp.MustCompile(`center=(-?\d[\d.]*)(?:%2C|,)(-?\d[\d.]*)`)
var pagePinRe = regexp.MustCompile(`!3d(-?\d[\d.]*)!4d(-?\d[\d.]*)`)

// Google's "location unknown" render centres on the geographic middle of the
// USA — it shows up as the og:image center= whenever the page carries no real
// location (newest share links, requests from datacenter IPs). It is never a
// real pin, so treat it as "no coordinates" and let the embed lookup run.
func isDefaultCenter(lat, lng float64) bool { return lat == 37.0625 && lng == -95.677068 }

func pageCoords(body []byte) (lat, lng float64, ok bool) {
	for _, re := range []*regexp.Regexp{pageCenterRe, pagePinRe} {
		m := re.FindSubmatch(body)
		if m == nil {
			continue
		}
		a, errA := strconv.ParseFloat(string(m[1]), 64)
		b, errB := strconv.ParseFloat(string(m[2]), 64)
		if errA != nil || errB != nil || isDefaultCenter(a, b) {
			continue
		}
		return a, b, true
	}
	return 0, 0, false
}

// The newest share links expand to a URL whose data blob holds only the
// place's feature id ("0x<fid>:0x<cid>") — neither the URL nor the page
// carries the pin; Google resolves the id client-side after the JS boots.
// The embed render is the one server-rendered view that still has it:
// /maps?cid=<cid>&output=embed returns a small page whose place record reads
// ["0x…:0x…","<address>",[lat,lng],"<cid>"]. The cid is the second half of
// the feature id in decimal.
var ftidCidRe = regexp.MustCompile(`!1s0x[0-9a-f]+:0x([0-9a-f]+)`)

func embedCoords(ctx context.Context, final *url.URL) (lat, lng float64, ok bool) {
	m := ftidCidRe.FindStringSubmatch(final.String())
	if m == nil {
		return 0, 0, false
	}
	cid, err := strconv.ParseUint(m[1], 16, 64)
	if err != nil {
		return 0, 0, false
	}
	id := strconv.FormatUint(cid, 10)
	req, err := expandRequest(ctx, "https://www.google.com/maps?cid="+id+"&output=embed")
	if err != nil {
		return 0, 0, false
	}
	res, err := expandClient.Do(req)
	if err != nil {
		log.Printf("embed cid=%s: %v", id, err)
		return 0, 0, false
	}
	body := readAtMost(res.Body, maxPageBytes)
	res.Body.Close()
	// Anchoring on the cid we asked for keeps the match unambiguous.
	pin := regexp.MustCompile(`\[(-?\d[\d.]*),(-?\d[\d.]*)\],"` + id + `"`).FindSubmatch(body)
	if pin == nil {
		return 0, 0, false
	}
	a, errA := strconv.ParseFloat(string(pin[1]), 64)
	b, errB := strconv.ParseFloat(string(pin[2]), 64)
	if errA != nil || errB != nil {
		return 0, 0, false
	}
	return a, b, true
}

var ogTitleRe = regexp.MustCompile(`property="og:title"[^>]*content="([^"]*)"|content="([^"]*)"[^>]*property="og:title"`)
var placePathRe = regexp.MustCompile(`/place/([^/@]+)`)

// placeName picks a human name for the pin. The expanded URL path is the
// reliable source — Google formats it "/place/Nikko,+Máximo+Aguirre..." — so
// take the segment before the first comma. og:title is only a fallback: on
// newer share pages it's the generic "Google Maps", useless as a pin name.
func placeName(final *url.URL, body []byte) string {
	if m := placePathRe.FindStringSubmatch(final.Path); m != nil {
		// final.Path is already percent-decoded; Google still uses + for spaces.
		name, _, _ := strings.Cut(strings.ReplaceAll(m[1], "+", " "), ",")
		if name = strings.TrimSpace(name); name != "" {
			return name
		}
	}
	m := ogTitleRe.FindSubmatch(body)
	if m == nil {
		return ""
	}
	title := string(m[1])
	if title == "" {
		title = string(m[2])
	}
	// og:title reads "Name · Street address" — keep just the name.
	title, _, _ = strings.Cut(title, " · ")
	if title = html.UnescapeString(strings.TrimSpace(title)); title != "" && title != "Google Maps" {
		return title
	}
	return ""
}

// expandHandler resolves a Google Maps short link (maps.app.goo.gl and
// friends) to the full URL it redirects to — the browser can't do this
// itself: CORS hides the Location header of a cross-origin redirect. When
// the expanded URL names a place without carrying its coordinates (the
// common case for newer share links), the coordinates and name scraped from
// the destination page ride along in the response.
func expandHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	short, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || (short.Scheme != "http" && short.Scheme != "https") || !shortMapsHostRe.MatchString(short.Hostname()) {
		http.Error(w, "not a Google Maps short link", http.StatusBadRequest)
		return
	}
	short.Scheme = "https"
	req, err := expandRequest(r.Context(), short.String())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := expandClient.Do(req)
	if err != nil {
		log.Printf("expand %s: %v", short, err)
		http.Error(w, "could not expand link", http.StatusBadGateway)
		return
	}
	body := readAtMost(res.Body, maxPageBytes)
	res.Body.Close()
	final := res.Request.URL

	// EU consent wall: the real destination hides in continue=, and the body
	// we just read is the wall itself — fetch the destination once more for
	// its metadata (the SOCS cookie usually prevents this hop entirely).
	if final.Hostname() == "consent.google.com" {
		if next, err := url.Parse(final.Query().Get("continue")); err == nil && googleHostRe.MatchString(next.Hostname()) {
			final = next
			body = nil
			if req2, err := expandRequest(r.Context(), final.String()); err == nil {
				if res2, err := expandClient.Do(req2); err == nil {
					if res2.Request.URL.Hostname() != "consent.google.com" {
						final = res2.Request.URL
						body = readAtMost(res2.Body, maxPageBytes)
					}
					res2.Body.Close()
				}
			}
		}
	}
	// Firebase-dynamic-link wrapper (old goo.gl/maps links): the destination
	// hides in ?link=.
	if l := final.Query().Get("link"); l != "" {
		if next, err := url.Parse(l); err == nil && googleHostRe.MatchString(next.Hostname()) {
			final = next
		}
	}
	// Still on a short host means the chain went somewhere we refused to
	// follow (or Google didn't redirect at all) — that's a failure, not a
	// result the frontend could parse coordinates from.
	if shortMapsHostRe.MatchString(final.Hostname()) {
		log.Printf("expand %s: stuck on %s", short, final)
		http.Error(w, "could not expand link", http.StatusBadGateway)
		return
	}
	out := map[string]any{"url": final.String()}
	if name := placeName(final, body); name != "" {
		out["name"] = name
	}
	lat, lng, ok := pageCoords(body)
	if !ok {
		lat, lng, ok = embedCoords(r.Context(), final)
	}
	if ok {
		out["lat"], out["lng"] = lat, lng
	}
	log.Printf("expand %s -> %s (coords: %t)", short, final, ok)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func stateHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	tripID := r.URL.Query().Get("trip")
	if !validTrip(tripID) {
		http.Error(w, "invalid or missing trip", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		var data string
		switch err := db.QueryRow(`SELECT data FROM trip WHERE id=?`, tripID).Scan(&data); err {
		case nil:
			io.WriteString(w, data)
		case sql.ErrNoRows:
			io.WriteString(w, "{}") // nothing saved yet
		default:
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	case http.MethodPut:
		// ponytail: 1MB cap, a bar list never gets near it. MaxBytesReader (not
		// LimitReader) so an oversized body is rejected outright rather than
		// silently truncated into corrupt JSON.
		body, err := readCapped(w, r, 1<<20)
		if err != nil {
			return // readCapped already wrote the status
		}
		if !json.Valid(body) {
			http.Error(w, "state must be valid JSON", http.StatusBadRequest)
			return
		}
		if _, err := db.Exec(
			`INSERT INTO trip(id,data,updated_at) VALUES(?,?,unixepoch())
			 ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
			tripID, string(body)); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		io.WriteString(w, "{}")
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func filesHandler(w http.ResponseWriter, r *http.Request) {
	tripID := r.URL.Query().Get("trip")
	if !validTrip(tripID) {
		http.Error(w, "invalid or missing trip", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if id := r.URL.Query().Get("id"); id != "" { // one file's bytes
			var name, ctype string
			var data []byte
			switch err := db.QueryRow(`SELECT name,type,data FROM file WHERE id=? AND trip=?`, id, tripID).Scan(&name, &ctype, &data); err {
			case nil:
			case sql.ErrNoRows:
				http.NotFound(w, r)
				return
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if ctype == "" {
				ctype = "application/octet-stream"
			}
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
			w.Write(data)
			return
		}
		rows, err := db.Query(`SELECT id,name,type FROM file WHERE trip=? ORDER BY id`, tripID) // list, no blobs
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []map[string]any{}
		for rows.Next() {
			var id int64
			var name, ctype string
			if err := rows.Scan(&id, &name, &ctype); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			list = append(list, map[string]any{"id": id, "name": name, "type": ctype})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		// ponytail: 10MB cap, a boarding-pass PDF/photo is well under. Rejected,
		// not truncated — a silently clipped PDF would store fine and open broken.
		body, err := readCapped(w, r, 10<<20)
		if err != nil {
			return // readCapped already wrote the status
		}
		res, err := db.Exec(`INSERT INTO file(trip,name,type,data,updated_at) VALUES(?,?,?,?,unixepoch())`,
			tripID, r.URL.Query().Get("name"), r.Header.Get("Content-Type"), body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		id, _ := res.LastInsertId()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"id": id})
	case http.MethodDelete:
		if _, err := db.Exec(`DELETE FROM file WHERE id=? AND trip=?`, r.URL.Query().Get("id"), tripID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		io.WriteString(w, "{}")
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// readCapped reads the whole request body up to limit bytes. Anything larger
// is answered with 413 (and any other read failure with 400); callers just
// bail on error.
func readCapped(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return nil, err
	}
	return body, nil
}

func main() {
	_ = godotenv.Load() // optional .env for local dev; missing file is fine

	var cfg config
	if err := envconfig.Process("", &cfg); err != nil {
		log.Fatal(err)
	}

	var err error
	db, err = openDB(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}

	web, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	addr := ":" + cfg.Port
	log.Println("trips listening on", addr)
	log.Fatal(http.ListenAndServe(addr, newMux(web)))
}
