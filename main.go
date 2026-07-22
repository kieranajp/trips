package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"regexp"
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

var expandClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		host := req.URL.Hostname()
		if len(via) >= 10 || (!shortMapsHostRe.MatchString(host) && !googleHostRe.MatchString(host)) {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// expandHandler resolves a Google Maps short link (maps.app.goo.gl and
// friends) to the full URL it redirects to, so the frontend can pull
// coordinates out of it. The browser can't do this itself: CORS hides the
// Location header of a cross-origin redirect.
func expandHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target, err := url.Parse(r.URL.Query().Get("url"))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || !shortMapsHostRe.MatchString(target.Hostname()) {
		http.Error(w, "not a Google Maps short link", http.StatusBadRequest)
		return
	}
	target.Scheme = "https"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := expandClient.Do(req)
	if err != nil {
		http.Error(w, "could not expand link", http.StatusBadGateway)
		return
	}
	res.Body.Close() // only the final URL matters, never the page
	final := res.Request.URL
	// The EU consent wall wraps the real destination in a continue param.
	if final.Hostname() == "consent.google.com" {
		if next, err := url.Parse(final.Query().Get("continue")); err == nil && next.Host != "" {
			final = next
		}
	}
	// Still on a short host means the chain went somewhere we refused to
	// follow (or Google didn't redirect at all) — that's a failure, not a
	// result the frontend could parse coordinates from.
	if shortMapsHostRe.MatchString(final.Hostname()) {
		http.Error(w, "could not expand link", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": final.String()})
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
