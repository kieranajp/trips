package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// newTestServer points the package-level db at a fresh temp SQLite file and
// returns a server wired exactly like production (minus the ingress, so
// every route is reachable — auth is enforced upstream, not here).
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	d, err := openDB(filepath.Join(t.TempDir(), "trip.db"))
	if err != nil {
		t.Fatal(err)
	}
	prev := db
	db = d
	t.Cleanup(func() { d.Close(); db = prev })

	web := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!DOCTYPE html>")}}
	srv := httptest.NewServer(newMux(web))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, method, url, contentType, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestValidTrip(t *testing.T) {
	valid := []string{"bilbao", "a", "trip-2", "0-9", strings.Repeat("x", 64)}
	for _, id := range valid {
		if !validTrip(id) {
			t.Errorf("validTrip(%q) = false, want true", id)
		}
	}
	invalid := []string{"", "Bilbao", "trip_2", "a b", "a/b", "../etc", "trip?x", strings.Repeat("x", 65)}
	for _, id := range invalid {
		if validTrip(id) {
			t.Errorf("validTrip(%q) = true, want false", id)
		}
	}
}

func TestStateRoundTrip(t *testing.T) {
	srv := newTestServer(t)

	// Nothing saved yet -> "{}".
	res := do(t, http.MethodGet, srv.URL+"/state?trip=bilbao", "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET status = %d", res.StatusCode)
	}
	if got := readBody(t, res); got != "{}" {
		t.Fatalf("empty state = %q, want {}", got)
	}

	// PUT then GET returns the same bytes.
	state := `{"pins":[{"id":"p_1","name":"Gure Toki"}],"categories":[]}`
	res = do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", state)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT status = %d: %s", res.StatusCode, readBody(t, res))
	}
	res = do(t, http.MethodGet, srv.URL+"/state?trip=bilbao", "", "")
	if got := readBody(t, res); got != state {
		t.Fatalf("GET after PUT = %q, want %q", got, state)
	}

	// A second PUT overwrites (upsert path).
	res = do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", `{"pins":[]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("second PUT status = %d", res.StatusCode)
	}
	res = do(t, http.MethodGet, srv.URL+"/state?trip=bilbao", "", "")
	if got := readBody(t, res); got != `{"pins":[]}` {
		t.Fatalf("GET after overwrite = %q", got)
	}

	// State is per trip.
	res = do(t, http.MethodGet, srv.URL+"/state?trip=other", "", "")
	if got := readBody(t, res); got != "{}" {
		t.Fatalf("other trip state = %q, want {}", got)
	}
}

func TestStatePutRejectsOversizedBody(t *testing.T) {
	srv := newTestServer(t)
	do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", `{"pins":[]}`)

	// >1MB must 413, not get truncated into corrupt JSON and stored.
	big := `{"pad":"` + strings.Repeat("x", 1<<20) + `"}`
	res := do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", big)
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized PUT status = %d, want 413", res.StatusCode)
	}

	res = do(t, http.MethodGet, srv.URL+"/state?trip=bilbao", "", "")
	if got := readBody(t, res); got != `{"pins":[]}` {
		t.Errorf("state after rejected PUT = %q, want previous state intact", got)
	}
}

func TestStatePutRejectsNonJSON(t *testing.T) {
	srv := newTestServer(t)
	do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", `{"pins":[]}`)

	for _, body := range []string{"", "not json", `{"pins":`} {
		res := do(t, http.MethodPut, srv.URL+"/state?trip=bilbao", "application/json", body)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("PUT %q status = %d, want 400", body, res.StatusCode)
		}
	}

	res := do(t, http.MethodGet, srv.URL+"/state?trip=bilbao", "", "")
	if got := readBody(t, res); got != `{"pins":[]}` {
		t.Errorf("state after rejected PUTs = %q, want previous state intact", got)
	}
}

func TestFilesPostRejectsOversizedBody(t *testing.T) {
	srv := newTestServer(t)
	res := do(t, http.MethodPost, srv.URL+"/files?trip=bilbao&name=huge.pdf", "application/pdf",
		strings.Repeat("x", 10<<20+1))
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized POST status = %d, want 413", res.StatusCode)
	}
	res = do(t, http.MethodGet, srv.URL+"/files?trip=bilbao", "", "")
	if got := strings.TrimSpace(readBody(t, res)); got != "[]" {
		t.Errorf("file list after rejected upload = %q, want []", got)
	}
}

func TestStateRejectsBadTripAndMethod(t *testing.T) {
	srv := newTestServer(t)
	for _, url := range []string{
		srv.URL + "/state",
		srv.URL + "/state?trip=",
		srv.URL + "/state?trip=Bad_Id",
		srv.URL + "/state?trip=../etc",
	} {
		res := do(t, http.MethodGet, url, "", "")
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("GET %s status = %d, want 400", url, res.StatusCode)
		}
	}
	res := do(t, http.MethodPost, srv.URL+"/state?trip=bilbao", "application/json", "{}")
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /state status = %d, want 405", res.StatusCode)
	}
	res = do(t, http.MethodDelete, srv.URL+"/state?trip=bilbao", "", "")
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("DELETE /state status = %d, want 405", res.StatusCode)
	}
}

func TestFilesLifecycle(t *testing.T) {
	srv := newTestServer(t)

	// Empty list.
	res := do(t, http.MethodGet, srv.URL+"/files?trip=bilbao", "", "")
	if got := strings.TrimSpace(readBody(t, res)); got != "[]" {
		t.Fatalf("empty list = %q, want []", got)
	}

	// Upload.
	res = do(t, http.MethodPost, srv.URL+"/files?trip=bilbao&name=pass.pdf", "application/pdf", "%PDF-fake")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST status = %d", res.StatusCode)
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &created); err != nil || created.ID == 0 {
		t.Fatalf("POST response missing id (err=%v)", err)
	}

	// List includes metadata, not blob bytes.
	res = do(t, http.MethodGet, srv.URL+"/files?trip=bilbao", "", "")
	var list []map[string]any
	if err := json.Unmarshal([]byte(readBody(t, res)), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0]["name"] != "pass.pdf" || list[0]["type"] != "application/pdf" {
		t.Fatalf("list = %v", list)
	}

	// Fetch bytes back with content type + inline disposition.
	fileURL := srv.URL + "/files?trip=bilbao&id=1"
	res = do(t, http.MethodGet, fileURL, "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET file status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); cd != `inline; filename="pass.pdf"` {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if got := readBody(t, res); got != "%PDF-fake" {
		t.Errorf("file bytes = %q", got)
	}

	// Files are scoped to their trip: another trip can't read them.
	res = do(t, http.MethodGet, srv.URL+"/files?trip=other&id=1", "", "")
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("cross-trip GET status = %d, want 404", res.StatusCode)
	}
	// ...or delete them.
	do(t, http.MethodDelete, srv.URL+"/files?trip=other&id=1", "", "")
	res = do(t, http.MethodGet, fileURL, "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("file gone after cross-trip delete (status %d)", res.StatusCode)
	}

	// Delete for real.
	res = do(t, http.MethodDelete, fileURL, "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("DELETE status = %d", res.StatusCode)
	}
	res = do(t, http.MethodGet, fileURL, "", "")
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("GET after delete status = %d, want 404", res.StatusCode)
	}
}

func TestFilesEmptyContentTypeFallsBack(t *testing.T) {
	srv := newTestServer(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/files?trip=bilbao&name=blob", strings.NewReader("data"))
	// Explicitly no Content-Type header.
	req.Header["Content-Type"] = nil
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	res = do(t, http.MethodGet, srv.URL+"/files?trip=bilbao&id=1", "", "")
	if ct := res.Header.Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("Content-Type = %q, want application/octet-stream", ct)
	}
}

func TestFileNameQuoteStripping(t *testing.T) {
	srv := newTestServer(t)
	res := do(t, http.MethodPost, srv.URL+`/files?trip=bilbao&name=`+`a%22b.pdf`, "application/pdf", "x")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST status = %d", res.StatusCode)
	}
	res = do(t, http.MethodGet, srv.URL+"/files?trip=bilbao&id=1", "", "")
	if cd := res.Header.Get("Content-Disposition"); strings.Count(cd, `"`) != 2 {
		t.Errorf("quotes not stripped from filename: %q", cd)
	}
}

// roundTripFunc lets tests script the responses /expand sees from Google,
// so no test ever touches the network.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func stubExpandTransport(t *testing.T, fn roundTripFunc) {
	t.Helper()
	prev := expandClient.Transport
	expandClient.Transport = fn
	t.Cleanup(func() { expandClient.Transport = prev })
}

func redirectTo(req *http.Request, location string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusFound,
		Header:     http.Header{"Location": []string{location}},
		Body:       io.NopCloser(strings.NewReader("")),
		Request:    req,
	}
}

func okPage(req *http.Request) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader("<html>")),
		Request:    req,
	}
}

func TestExpandFollowsShortLinkRedirect(t *testing.T) {
	srv := newTestServer(t)
	long := "https://www.google.com/maps/place/Gure+Toki/@43.2593,-2.9222,17z/data=!3d43.2593788!4d-2.9222899"
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Hostname() {
		case "maps.app.goo.gl":
			return redirectTo(req, long), nil
		case "www.google.com":
			return okPage(req), nil
		default:
			t.Errorf("unexpected outbound host %q", req.URL.Hostname())
			return okPage(req), nil
		}
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url=https%3A%2F%2Fmaps.app.goo.gl%2FH8VkkiU1bPjorJEU8", "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", res.StatusCode, readBody(t, res))
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got["url"] != long {
		t.Errorf("url = %q, want %q", got["url"], long)
	}
}

// placePage mimics the server-rendered head of a real maps place page: the
// og:title is the useless generic "Google Maps" (verified against a live
// share link), and the pin's coordinates live only in the og:image static
// map's center=. The place name comes from the expanded URL path, not here.
const placePage = `<html><head>
<meta content="Google Maps" property="og:title">
<meta content="https://maps.google.com/maps/api/staticmap?center=43.2593788%2C-2.9222899&amp;zoom=15" property="og:image">
</head><body></body></html>`

func pageWith(req *http.Request, body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func TestExpandScrapesCoordsFromCoordinatelessPlacePage(t *testing.T) {
	srv := newTestServer(t)
	// A real expanded link: name in the path, place id in data=, no coords.
	long := "https://www.google.com/maps/place/Gure+Toki,+Plaza+Barria,+12/data=!4m2!3m1!1s0xdead:0xbeef"
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Hostname() {
		case "maps.app.goo.gl":
			return redirectTo(req, long), nil
		case "www.google.com":
			// The consent opt-out must survive the cross-domain hop (Go
			// strips Cookie on it) and the UA must look like a browser, or
			// Google serves the wall / a shell page instead of the og: tags.
			if c := req.Header.Get("Cookie"); !strings.Contains(c, "SOCS=CAI") {
				t.Errorf("google.com request Cookie = %q, want SOCS=CAI", c)
			}
			if ua := req.Header.Get("User-Agent"); !strings.Contains(ua, "Mozilla") {
				t.Errorf("google.com request User-Agent = %q", ua)
			}
			return pageWith(req, placePage), nil
		default:
			t.Errorf("unexpected outbound host %q", req.URL.Hostname())
			return okPage(req), nil
		}
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/H8VkkiU1bPjorJEU8"), "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", res.StatusCode, readBody(t, res))
	}
	var got struct {
		URL  string  `json:"url"`
		Name string  `json:"name"`
		Lat  float64 `json:"lat"`
		Lng  float64 `json:"lng"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got.URL != long {
		t.Errorf("url = %q, want %q", got.URL, long)
	}
	if got.Lat != 43.2593788 || got.Lng != -2.9222899 {
		t.Errorf("coords = %v,%v, want 43.2593788,-2.9222899", got.Lat, got.Lng)
	}
	// Name comes from the /place/ path (trimmed at the first comma), NOT the
	// generic "Google Maps" og:title.
	if got.Name != "Gure Toki" {
		t.Errorf("name = %q, want %q", got.Name, "Gure Toki")
	}
}

func TestExpandScrapesPinCoordsFromCanonicalDataBlob(t *testing.T) {
	srv := newTestServer(t)
	// No og:image static map — the pin only exists in the !3d/!4d blob of the
	// canonical URL embedded in the page.
	long := "https://www.google.com/maps/place/Gure+Toki,+Plaza+Barria,+12/data=!4m2!3m1!1s0xdead:0xbeef"
	page := `<html><head>
<meta content="Google Maps" property="og:title">
<link rel="canonical" href="https://www.google.com/maps/place/Gure+Toki/@43.2593788,-2.9222899,17z/data=!3m1!4b1!4m6!3m5!1s0xdead:0xbeef!8m2!3d43.2593788!4d-2.9222899">
</head><body></body></html>`
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "maps.app.goo.gl" {
			return redirectTo(req, long), nil
		}
		return pageWith(req, page), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	var got struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got.Lat != 43.2593788 || got.Lng != -2.9222899 {
		t.Errorf("coords = %v,%v, want 43.2593788,-2.9222899", got.Lat, got.Lng)
	}
}

func TestExpandNeverScrapesCameraCoords(t *testing.T) {
	srv := newTestServer(t)
	// A page with no place pin at all — only the map *camera*, which Google
	// centres by IP-geolocating the requester (this server). Scraping it pinned
	// every coordinate-less share link to wherever the server runs, so the
	// response must omit lat/lng entirely rather than return the camera.
	long := "https://www.google.com/maps/place/Gure+Toki/data=!4m2!3m1!1s0xdead:0xbeef"
	page := `<html><head>
<meta content="Google Maps" property="og:title">
<meta content="https://www.google.com/maps/@52.5170365,13.3888599,12z" property="og:url">
</head><body><script>window.APP_INITIALIZATION_STATE=[[[12.0,13.3888599,52.5170365]]];</script></body></html>`
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "maps.app.goo.gl" {
			return redirectTo(req, long), nil
		}
		return pageWith(req, page), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", res.StatusCode, readBody(t, res))
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["lat"]; ok {
		t.Errorf("response includes lat=%v scraped from the camera — must omit coords instead", got["lat"])
	}
	if got["url"] != long {
		t.Errorf("url = %v, want %q", got["url"], long)
	}
}

// The newest share links expand to a page with no place data at all: the
// og:image static map is centred on Google's "location unknown" default (the
// middle of the USA) and the URL's data blob carries only the feature id.
// The handler must reject that default centre and resolve the pin through
// the embed render instead. Regression: a real Bilbao link pinned to Kansas.
func TestExpandResolvesCoordinatelessLinkThroughEmbed(t *testing.T) {
	srv := newTestServer(t)
	long := "https://www.google.com/maps/place/El+Corte+Ingl%C3%A9s+Gran+V%C3%ADa,+Abando,+48001+Bilbao/data=!4m2!3m1!1s0xd4e4fd091ba0b45:0x80aecf60675a5b59!18m1!1e1"
	// Both pages verified against live responses (July 2026).
	defaultPage := `<html><head>
<meta content="Google Maps" property="og:title">
<meta content="https://maps.google.com/maps/api/staticmap?center=37.0625%2C-95.677068&amp;zoom=4" property="og:image">
</head><body></body></html>`
	embedPage := `<html><body><script>initEmbed([null,[[[2905.5,-2.9291572,43.2615854],[0,0,0]],null,null,[["0xd4e4fd091ba0b45:0x80aecf60675a5b59","El Corte Inglés Gran Vía, 48001 Bilbao, Biscay, Spain",[43.2615854,-2.9291572],"9272576695760214873"],"El Corte Inglés Gran Vía"]]])</script></body></html>`
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Hostname() == "maps.app.goo.gl":
			return redirectTo(req, long), nil
		case req.URL.Query().Get("output") == "embed":
			// The cid is the second half of the feature id, in decimal.
			if cid := req.URL.Query().Get("cid"); cid != "9272576695760214873" {
				t.Errorf("embed cid = %q, want 9272576695760214873", cid)
			}
			return pageWith(req, embedPage), nil
		case req.URL.Hostname() == "www.google.com":
			return pageWith(req, defaultPage), nil
		default:
			t.Errorf("unexpected outbound host %q", req.URL.Hostname())
			return okPage(req), nil
		}
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/jw51CPRjdASK3tCL7"), "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", res.StatusCode, readBody(t, res))
	}
	var got struct {
		Name string  `json:"name"`
		Lat  float64 `json:"lat"`
		Lng  float64 `json:"lng"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got.Lat != 43.2615854 || got.Lng != -2.9291572 {
		t.Errorf("coords = %v,%v, want 43.2615854,-2.9291572", got.Lat, got.Lng)
	}
	if got.Name != "El Corte Inglés Gran Vía" {
		t.Errorf("name = %q, want %q", got.Name, "El Corte Inglés Gran Vía")
	}
}

func TestExpandOmitsCoordsWhenOnlyDefaultCenterAndNoFeatureID(t *testing.T) {
	srv := newTestServer(t)
	// Default-centred page and no feature id to fall back on: the response
	// must omit lat/lng entirely, never return the middle of the USA.
	long := "https://www.google.com/maps/place/Gure+Toki"
	page := `<html><head>
<meta content="https://maps.google.com/maps/api/staticmap?center=37.0625%2C-95.677068&amp;zoom=4" property="og:image">
</head><body></body></html>`
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "maps.app.goo.gl" {
			return redirectTo(req, long), nil
		}
		return pageWith(req, page), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	var got map[string]any
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["lat"]; ok {
		t.Errorf("response includes lat=%v — the default centre must be rejected", got["lat"])
	}
}

func TestExpandNameFallsBackToOgTitleWithoutPlacePath(t *testing.T) {
	srv := newTestServer(t)
	// A /@lat,lng URL shape carries no /place/ segment, so the name must come
	// from a non-generic og:title instead.
	long := "https://www.google.com/maps/@43.2593788,-2.9222899,17z"
	page := `<html><head><meta property="og:title" content="Gatz · Bilbao"></head></html>`
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "maps.app.goo.gl" {
			return redirectTo(req, long), nil
		}
		return pageWith(req, page), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	var got struct {
		URL  string `json:"url"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "Gatz" {
		t.Errorf("name = %q, want %q (og:title fallback, address trimmed)", got.Name, "Gatz")
	}
	// The @lat,lng coords stay in the returned URL for the frontend to parse.
	if got.URL != long {
		t.Errorf("url = %q, want %q", got.URL, long)
	}
}

func TestExpandUnwrapsConsentWallAndRefetchesThePage(t *testing.T) {
	srv := newTestServer(t)
	long := "https://www.google.com/maps/place/Gure+Toki/data=!4m2!3m1!1s0xdead:0xbeef"
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		switch req.URL.Hostname() {
		case "maps.app.goo.gl":
			return redirectTo(req, "https://consent.google.com/m?continue="+neturl.QueryEscape(long)), nil
		case "consent.google.com":
			return pageWith(req, "<html>consent wall — no place data here</html>"), nil
		case "www.google.com":
			return pageWith(req, placePage), nil
		default:
			t.Errorf("unexpected outbound host %q", req.URL.Hostname())
			return okPage(req), nil
		}
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	var got struct {
		URL string  `json:"url"`
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got.URL != long {
		t.Errorf("url = %q, want %q", got.URL, long)
	}
	if got.Lat != 43.2593788 || got.Lng != -2.9222899 {
		t.Errorf("coords = %v,%v — the wall's page must not be the one scraped", got.Lat, got.Lng)
	}
}

func TestExpandUnwrapsDynamicLinkWrapper(t *testing.T) {
	srv := newTestServer(t)
	long := "https://www.google.com/maps/place/Gatz/@43.25819,-2.92598,17z"
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() != "maps.app.goo.gl" {
			t.Errorf("unexpected outbound host %q", req.URL.Hostname())
			return okPage(req), nil
		}
		if req.URL.Query().Get("link") != "" { // second hop: the wrapper page
			return okPage(req), nil
		}
		return redirectTo(req, "https://maps.app.goo.gl/?link="+neturl.QueryEscape(long)+"&apn=com.google.android.apps.maps"), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", res.StatusCode, readBody(t, res))
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(readBody(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if got["url"] != long {
		t.Errorf("url = %v, want %q", got["url"], long)
	}
}

func TestExpandRefusesToFollowOffGoogleRedirects(t *testing.T) {
	srv := newTestServer(t)
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() != "maps.app.goo.gl" {
			t.Errorf("followed redirect to %q — must stop at the short host", req.URL.Hostname())
			return okPage(req), nil
		}
		return redirectTo(req, "https://evil.test/steal"), nil
	})
	res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	if res.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", res.StatusCode)
	}
}

func TestExpandRejectsNonShortLinks(t *testing.T) {
	srv := newTestServer(t)
	stubExpandTransport(t, func(req *http.Request) (*http.Response, error) {
		t.Errorf("no outbound request should be made, got one to %q", req.URL)
		return okPage(req), nil
	})
	for _, raw := range []string{
		"",                                 // missing
		"https://example.com/x",            // arbitrary host — never proxied
		"https://www.google.com/maps/@1,2", // already a full link, nothing to expand
		"https://evilmaps.app.goo.gl.io/x", // lookalike host
		"ftp://maps.app.goo.gl/abc",        // wrong scheme
		"not a url",
	} {
		res := do(t, http.MethodGet, srv.URL+"/expand?url="+neturl.QueryEscape(raw), "", "")
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("url=%q status = %d, want 400", raw, res.StatusCode)
		}
	}
	res := do(t, http.MethodPost, srv.URL+"/expand?url="+neturl.QueryEscape("https://maps.app.goo.gl/abc"), "", "")
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want 405", res.StatusCode)
	}
}

func TestLoginRedirectStaysLocal(t *testing.T) {
	srv := newTestServer(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	cases := map[string]string{
		"/?trip=bilbao":      "/?trip=bilbao",
		"/foo":               "/foo",
		"":                   "/",
		"https://evil.test/": "/",
		"//evil.test/":       "/",
	}
	for next, want := range cases {
		res, err := client.Get(srv.URL + "/login?next=" + strings.ReplaceAll(next, "?", "%3F"))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusFound {
			t.Errorf("next=%q status = %d, want 302", next, res.StatusCode)
		}
		if got := res.Header.Get("Location"); got != want {
			t.Errorf("next=%q Location = %q, want %q", next, got, want)
		}
	}
}

func TestWhoamiEchoesIdentityHeaders(t *testing.T) {
	srv := newTestServer(t)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/whoami", nil)
	req.Header.Set("X-authentik-email", "kieran@example.com")
	req.Header.Set("X-authentik-username", "kieran")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got map[string]string
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got["user"] != "kieran@example.com" || got["name"] != "kieran" {
		t.Errorf("whoami = %v", got)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

// TestPWAAssetsEmbedded checks the installability wiring against the real
// embedded FS: the manifest parses, every icon it points at is actually
// embedded, and the shell links the manifest + registers the service worker.
// Catches the classic PWA rot: renaming/moving an icon without updating the
// manifest (or vice versa) breaks install silently.
func TestPWAAssetsEmbedded(t *testing.T) {
	manifest, err := webFS.ReadFile("web/manifest.json")
	if err != nil {
		t.Fatalf("manifest.json not embedded: %v", err)
	}
	var m struct {
		StartURL string `json:"start_url"`
		Display  string `json:"display"`
		Icons    []struct {
			Src string `json:"src"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(manifest, &m); err != nil {
		t.Fatalf("manifest.json invalid: %v", err)
	}
	if m.StartURL != "/" || m.Display != "standalone" {
		t.Errorf("manifest start_url=%q display=%q, want / and standalone", m.StartURL, m.Display)
	}
	if len(m.Icons) == 0 {
		t.Error("manifest has no icons")
	}
	for _, ic := range m.Icons {
		if _, err := webFS.ReadFile("web" + ic.Src); err != nil {
			t.Errorf("manifest icon %s not embedded: %v", ic.Src, err)
		}
	}
	if _, err := webFS.ReadFile("web/sw.js"); err != nil {
		t.Errorf("sw.js not embedded: %v", err)
	}
	index, err := webFS.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`rel="manifest"`, `rel="apple-touch-icon"`, `name="theme-color"`} {
		if !strings.Contains(string(index), want) {
			t.Errorf("index.html missing %s", want)
		}
	}
	app, err := webFS.ReadFile("web/app.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(app), `serviceWorker.register("/sw.js")`) {
		t.Error("app.js does not register /sw.js")
	}
}
