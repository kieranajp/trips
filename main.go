package main

import (
	"bufio"
	"database/sql"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed all:web
var webFS embed.FS

var db *sql.DB

// trip ids are slugs — same charset the frontend enforces.
var tripRe = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

func validTrip(id string) bool { return tripRe.MatchString(id) }

func main() {
	loadEnvFile(".env")

	path := os.Getenv("DB_PATH")
	if path == "" {
		path = "/data/trip.db"
	}
	var err error
	db, err = sql.Open("sqlite", path)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS trip(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)`); err != nil {
		log.Fatal(err)
	}
	// file: trip attachments (boarding passes, tickets, docs) — blobs kept out of
	// the /state JSON so they never hit its 1MB cap. Under /data with the db.
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS file(id INTEGER PRIMARY KEY AUTOINCREMENT, trip TEXT, name TEXT, type TEXT, data BLOB, updated_at INTEGER)`); err != nil {
		log.Fatal(err)
	}

	web, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// /whoami and /login only ever reach the app through the auth-private
	// ingress route, so a request arriving here has already cleared Authentik
	// forward-auth. The identity comes from the X-authentik-* headers the
	// outpost injects; reads (public routes) never hit these handlers.

	// /whoami lets the SPA discover its login state. The ingress routes this
	// path through forward-auth, so logged-out browsers get a 302 (which the
	// SPA reads as "logged out" via fetch redirect:manual) and logged-in ones
	// get this JSON back with their Authentik identity.
	http.HandleFunc("/whoami", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]string{
			"user": r.Header.Get("X-authentik-email"),
			"name": r.Header.Get("X-authentik-username"),
		})
	})

	// /login is the login trigger. Visiting it forces the forward-auth flow
	// (Authentik + Google), which sets the session cookie; the handler then
	// bounces the browser back to where it came from so subsequent writes carry
	// the session. next is constrained to a local path to avoid open redirects.
	http.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		next := r.URL.Query().Get("next")
		if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
			next = "/"
		}
		http.Redirect(w, r, next, http.StatusFound)
	})

	http.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
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
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // ponytail: 1MB cap, a bar list never gets near it
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
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
	})

	http.HandleFunc("/files", func(w http.ResponseWriter, r *http.Request) {
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
			body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // ponytail: 10MB cap, a boarding-pass PDF/photo is well under
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
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
	})

	http.Handle("/", http.FileServer(http.FS(web)))

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Println("trips listening on", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// loadEnvFile sets KEY=VALUE lines from path into the environment, without
// clobbering vars already set (real env wins over the file).
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if k = strings.TrimSpace(k); k != "" {
			if _, set := os.LookupEnv(k); !set {
				os.Setenv(k, strings.Trim(strings.TrimSpace(v), `"'`))
			}
		}
	}
}
