package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
