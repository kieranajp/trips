// One-off: Takeout CSV -> Google Places (New) -> bilbao-import.json (app export format).
// Run: go run ./cmd/import  (reads GOOGLE_PLACES_API_KEY from .env or env)
package main

import (
	"bufio"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const csvPath = "Takeout/Saved/Bilbao.csv"
const outPath = "bilbao-import.json"

// Bilbao centre — where a place Google can't find lands, ready to be dragged.
var center = struct{ lat, lng float64 }{43.263, -2.935}

// Seed categories, mirrored from web/data.js so a merge/replace import keeps the bucket set.
var seedCats = []map[string]string{
	{"id": "coffee", "name": "Coffee", "color": "#6f4e37"},
	{"id": "lightbites", "name": "Light bites", "color": "#9c8b3b"},
	{"id": "pintxos", "name": "Pintxos", "color": "#d9822b"},
	{"id": "dinner", "name": "Dinner", "color": "#5f7d4a"},
	{"id": "wine", "name": "Wine", "color": "#8c2f4a"},
	{"id": "beer", "name": "Beer", "color": "#caa03a"},
	{"id": "cocktails", "name": "Cocktails", "color": "#a34a76"},
	{"id": "sights", "name": "Sights", "color": "#3f6ea3"},
	{"id": "coast", "name": "Coast & day trips", "color": "#2c8f96"},
	{"id": "saved", "name": "Saved", "color": "#5b6672"},
}

type pin struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Cat  string  `json:"cat"`
	Note string  `json:"note"`
	URL  string  `json:"url,omitempty"`
	Src  *string `json:"src"`
}

func main() {
	key := apiKey()
	if key == "" {
		log.Fatal("GOOGLE_PLACES_API_KEY not set (checked .env and env)")
	}

	f, err := os.Open(csvPath)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		log.Fatal(err)
	}

	var pins []pin
	located, missed := 0, 0
	for i, r := range rows {
		if i == 0 || len(r) < 3 || strings.TrimSpace(r[0]) == "" {
			continue // header / blank / malformed
		}
		title, note, takeoutURL := strings.TrimSpace(r[0]), strings.TrimSpace(r[1]), strings.TrimSpace(r[2])

		lat, lng, uri, ok := searchText(key, title)
		p := pin{ID: fmt.Sprintf("p_saved_%d", i), Name: title, Cat: "saved", Note: note}
		if ok {
			p.Lat, p.Lng, p.URL = round6(lat), round6(lng), firstNonEmpty(uri, takeoutURL)
			located++
			fmt.Printf("  ✓ %-40s %.5f, %.5f\n", title, p.Lat, p.Lng)
		} else {
			p.Lat, p.Lng, p.URL = center.lat, center.lng, takeoutURL
			if note != "" {
				p.Note = note + " — "
			}
			p.Note += "⚠ Google couldn't place it, drag me"
			missed++
			fmt.Printf("  ✗ %-40s (dropped at centre)\n", title)
		}
		pins = append(pins, p)
		time.Sleep(120 * time.Millisecond) // gentle; paid API but no need to hammer
	}

	out := map[string]any{
		"version":    1,
		"exported":   time.Now().Format(time.RFC3339),
		"categories": seedCats,
		"pins":       pins,
	}
	buf, _ := json.MarshalIndent(out, "", "  ")
	if err := os.WriteFile(outPath, buf, 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("\n%d located, %d missed → %s\n", located, missed, outPath)
}

// searchText resolves a place name to coords via Places API (New) Text Search.
func searchText(key, name string) (lat, lng float64, uri string, ok bool) {
	body, _ := json.Marshal(map[string]any{
		"textQuery":      name + ", Bilbao, Spain",
		"maxResultCount": 1,
		"regionCode":     "ES",
	})
	req, _ := http.NewRequest("POST", "https://places.googleapis.com/v1/places:searchText", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", "places.location,places.googleMapsUri")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("request failed: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		// A hard error (bad key, wrong API) will hit every row — stop and show it.
		log.Fatalf("Places API %d: %s\n(enable \"Places API (New)\" for this key and check billing)", res.StatusCode, raw)
	}

	var out struct {
		Places []struct {
			Location struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			GoogleMapsURI string `json:"googleMapsUri"`
		} `json:"places"`
	}
	if json.Unmarshal(raw, &out) != nil || len(out.Places) == 0 {
		return 0, 0, "", false
	}
	p := out.Places[0]
	return p.Location.Latitude, p.Location.Longitude, p.GoogleMapsURI, true
}

func apiKey() string {
	if k := os.Getenv("GOOGLE_PLACES_API_KEY"); k != "" {
		return k
	}
	f, err := os.Open(".env")
	if err != nil {
		return ""
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if v, found := strings.CutPrefix(line, "GOOGLE_PLACES_API_KEY="); found {
			return strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	return ""
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func round6(f float64) float64 {
	return float64(int64(f*1e6+sign(f)*0.5)) / 1e6
}
func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	return 1
}
