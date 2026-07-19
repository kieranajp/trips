// One-off: resolve googleMapsUri for each seed CATALOG entry + HOTEL, biased to
// its known coords. Prints `cid<TAB>uri` lines to paste into web/data.js.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

type entry struct {
	cid, name string
	lat, lng  float64
}

var seeds = []entry{
	{"gure", "Gure Toki", 43.2593788, -2.9222899},
	{"victor", "Víctor Montes", 43.2589036, -2.9223596},
	{"gatz", "Gatz", 43.25819, -2.92598},
	{"vina", "La Viña del Ensanche", 43.2617626, -2.9327006},
	{"fueros", "Los Fueros", 43.2595294, -2.9230478},
	{"ginfizz", "Gin Fizz", 43.2663742, -2.9313755},
	{"cigar", "La Antigua Cigarrería", 43.262581, -2.931292},
	{"craft", "The Craft Tabeerna", 43.2577402, -2.9249097},
	{"rufo", "Casa Rufo", 43.2585884, -2.9316117},
	{"getaria", "Asador Guetaria", 43.2631167, -2.9300831},
	{"ribera", "Mercado de la Ribera", 43.2555913, -2.9242454},
	{"azkuna", "Azkuna Zentroa", 43.2597198, -2.9371747},
	{"gugg", "Guggenheim Museum Bilbao", 43.2686712, -2.9340118},
	{"bridge", "Bizkaia Bridge", 43.3232857, -3.0171525},
	{"algorta", "Puerto Viejo de Algorta", 43.3490595, -3.014646},
	{"gaztel", "San Juan de Gaztelugatxe", 43.447, -2.785},
	{"mundaka", "Mundaka", 43.408017, -2.7002508},
	{"txomin", "Txomin Etxaniz", 43.2960394, -2.1942006},
	{"HOTEL", "Hotel Hesperia Bilbao", 43.2678833, -2.928129},
}

func main() {
	key := apiKey()
	if key == "" {
		log.Fatal("GOOGLE_PLACES_API_KEY not set")
	}
	for _, e := range seeds {
		uri := searchURI(key, e)
		if uri == "" {
			fmt.Fprintf(os.Stderr, "  ✗ %s — no result\n", e.name)
			continue
		}
		fmt.Printf("%s\t%s\n", e.cid, uri)
	}
}

func searchURI(key string, e entry) string {
	body, _ := json.Marshal(map[string]any{
		"textQuery":      e.name,
		"maxResultCount": 1,
		"locationBias":   map[string]any{"circle": map[string]any{"center": map[string]any{"latitude": e.lat, "longitude": e.lng}, "radius": 3000}},
	})
	req, _ := http.NewRequest("POST", "https://places.googleapis.com/v1/places:searchText", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", "places.googleMapsUri")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		log.Fatalf("Places API %d: %s", res.StatusCode, raw)
	}
	var out struct {
		Places []struct {
			GoogleMapsURI string `json:"googleMapsUri"`
		} `json:"places"`
	}
	if json.Unmarshal(raw, &out) != nil || len(out.Places) == 0 {
		return ""
	}
	return out.Places[0].GoogleMapsURI
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
		if v, ok := strings.CutPrefix(strings.TrimSpace(s.Text()), "GOOGLE_PLACES_API_KEY="); ok {
			return strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
	return ""
}
