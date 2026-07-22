// genicons is a one-off local tool (like cmd/import): it renders the PWA
// icon set into web/icons/ using only the stdlib. The PNGs are committed;
// re-run this only when the design changes.
//
//	go run ./cmd/genicons
package main

import (
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

var (
	ink   = color.NRGBA{0x1c, 0x23, 0x21, 0xff} // --ink
	paper = color.NRGBA{0xf3, 0xef, 0xe6, 0xff} // --paper
)

// pin is a classic teardrop map pin: a circle plus the triangle out to the
// tangent points of the tip, with a paper-coloured hole. All coordinates are
// fractions of the canvas so one shape serves every size; the whole glyph
// stays inside the central 80% maskable safe zone.
type pin struct {
	cx, cy, r    float64 // head circle
	tipY         float64 // point of the pin
	holeR        float64
	p1x, p1y     float64 // tangent points (computed)
	p2x, p2y     float64
	tipX, tipYpx float64
}

func newPin(size float64) *pin {
	p := &pin{
		cx:    size * 0.5,
		cy:    size * 0.42,
		r:     size * 0.185,
		tipY:  size * 0.74,
		holeR: size * 0.075,
	}
	d := p.tipY - p.cy
	theta := math.Acos(p.r / d)
	p.p1x, p.p1y = p.cx-p.r*math.Sin(theta), p.cy+p.r*math.Cos(theta)
	p.p2x, p.p2y = p.cx+p.r*math.Sin(theta), p.cy+p.r*math.Cos(theta)
	p.tipX, p.tipYpx = p.cx, p.tipY
	return p
}

func side(ax, ay, bx, by, px, py float64) float64 {
	return (bx-ax)*(py-ay) - (by-ay)*(px-ax)
}

func (p *pin) inside(x, y float64) bool {
	if math.Hypot(x-p.cx, y-p.cy) <= p.holeR {
		return false
	}
	if math.Hypot(x-p.cx, y-p.cy) <= p.r {
		return true
	}
	// triangle tip–p1–p2, all-same-sign test
	d1 := side(p.tipX, p.tipYpx, p.p1x, p.p1y, x, y)
	d2 := side(p.p1x, p.p1y, p.p2x, p.p2y, x, y)
	d3 := side(p.p2x, p.p2y, p.tipX, p.tipYpx, x, y)
	neg := d1 < 0 || d2 < 0 || d3 < 0
	pos := d1 > 0 || d2 > 0 || d3 > 0
	return !(neg && pos)
}

// render draws the pin on a paper square with 4x4 supersampling.
func render(size int) *image.NRGBA {
	p := newPin(float64(size))
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	const ss = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			hits := 0
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					fx := float64(x) + (float64(sx)+0.5)/ss
					fy := float64(y) + (float64(sy)+0.5)/ss
					if p.inside(fx, fy) {
						hits++
					}
				}
			}
			t := float64(hits) / (ss * ss)
			img.SetNRGBA(x, y, blend(paper, ink, t))
		}
	}
	return img
}

func blend(a, b color.NRGBA, t float64) color.NRGBA {
	lerp := func(x, y uint8) uint8 { return uint8(float64(x) + (float64(y)-float64(x))*t + 0.5) }
	return color.NRGBA{lerp(a.R, b.R), lerp(a.G, b.G), lerp(a.B, b.B), 0xff}
}

func main() {
	out := "web/icons"
	if err := os.MkdirAll(out, 0o755); err != nil {
		log.Fatal(err)
	}
	for name, size := range map[string]int{
		"icon-192.png":         192,
		"icon-512.png":         512,
		"apple-touch-icon.png": 180,
	} {
		f, err := os.Create(filepath.Join(out, name))
		if err != nil {
			log.Fatal(err)
		}
		if err := png.Encode(f, render(size)); err != nil {
			log.Fatal(err)
		}
		if err := f.Close(); err != nil {
			log.Fatal(err)
		}
		log.Printf("wrote %s/%s", out, name)
	}
}
