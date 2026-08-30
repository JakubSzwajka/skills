# Charts

Hand-authored SVG. No libraries, no `<style>` inside the SVG, no inline fills —
the classes in `base.css` carry every colour.

Before reaching for SVG, check whether `.bars` or `.meter` already does the job.
Ranked comparison and part-of-a-whole are better as HTML: they reflow on a phone,
SVG does not. SVG is for shapes HTML cannot make — columns over time, lines,
scatter, slope, ranges.

For anything past these six recipes, or any question about which chart fits, load
the **`dataviz` skill** and follow it. This file is the mechanics, not the theory.

## The frame

Same frame every time, so the pages look like one system.

```
viewBox = "0 0 900 320"
x0 = 56    left edge of the plot     (room for y labels)
x1 = 880   right edge
y0 = 20    top of the plot
y1 = 260   baseline                  (room for x labels below)
```

Wrap in `<figure class="wide">`, give the SVG `role="img"` and an `aria-label`
carrying the same claim as the `figcaption`.

Chart classes: `.axis` `.gridline` `.tick` `.val` `.plot-1`…`.plot-5`
`.plot-flat` `.plot-warn` `.line-1` `.line-2` `.line-3` `.line-dash`.

## Rules that survive every chart

1. **Bars and columns start at zero.** Truncating the axis to dramatise a
   difference is a lie told with geometry.
2. **Label directly.** Put the series name at the end of its line, the value on
   top of its column. A legend is what you fall back to at four-plus series.
3. **Print the number** wherever there is room. The shape is for the eye, the
   number is the fact the reader quotes.
4. **One accent per chart.** Everything not being argued about is `.plot-flat`.
   Use `--s2`…`--s5` only for genuinely categorical series, never for decoration.
5. **`.plot-warn` means risk**, the same as `.callout` and `.bar.warn`. Never use
   it because a bar needed a different colour.
6. **Round the drawing, not the fact.** Pixel positions can round; the label
   prints the real value.

---

## 1. Columns over time

```
slot = (x1 - x0) / n
bw   = slot * 0.62
x_i  = x0 + slot*i + (slot - bw)/2
h_i  = v_i / vmax * (y1 - y0)
y_i  = y1 - h_i
```

Worked, n = 5, vmax = 400, x0 = 56, x1 = 880, y0 = 20, y1 = 260:
slot = 164.8, bw = 102.2, plot height = 240. A value of 300 gives h = 180, y = 80.

```html
<svg viewBox="0 0 900 320" role="img" aria-label="Signups per month; March is the peak at 300.">
  <line class="gridline" x1="56" y1="140" x2="880" y2="140"/>
  <text class="tick" x="48" y="144" text-anchor="end">200</text>
  <rect class="plot-flat" x="87" y="140" width="102" height="120"/>
  <rect class="plot-1"    x="252" y="80"  width="102" height="180"/>
  <text class="val" x="303" y="72" text-anchor="middle">300</text>
  <line class="axis" x1="56" y1="260" x2="880" y2="260"/>
  <text class="tick" x="303" y="278" text-anchor="middle">Mar</text>
</svg>
```

Two to three gridlines. More is graph paper.

## 2. Line

```
x_i = x0 + i/(n-1) * (x1 - x0)
y_i = y1 - (v_i - vmin) / (vmax - vmin) * (y1 - y0)
```

Set `vmin = 0` unless the data lives in a narrow band far from zero, and say so in
the caption when it does not.

```html
<path class="line-1" d="M56,210 L262,150 L468,96 L674,84 L880,40"/>
<circle class="plot-1" cx="880" cy="40" r="3.5"/>
<text class="val" x="872" y="32" text-anchor="end">p95 2.4s</text>
<path class="line-dash" d="M56,240 L880,232"/>
<text class="tick" x="872" y="246" text-anchor="end">budget</text>
```

Label the line at its right end. Dashed grey is always the reference line: target,
budget, last year.

## 3. Slope — two points, many things

The best before/after chart. Two vertical axes, one segment per item. Crossing
lines are the finding.

```
xa = 220, xb = 680
y(v) = y1 - v/vmax * (y1 - y0)
```

```html
<text class="tick" x="220" y="14" text-anchor="middle">Before</text>
<text class="tick" x="680" y="14" text-anchor="middle">After</text>
<line class="gridline" x1="220" y1="20" x2="220" y2="260"/>
<line class="gridline" x1="680" y1="20" x2="680" y2="260"/>
<path class="line-1" d="M220,180 L680,60"/>
<text class="val" x="210" y="184" text-anchor="end">API 40</text>
<text class="val" x="690" y="64">80</text>
<path class="line-dash" d="M220,90 L680,150"/>
```

Accent the one or two items you are arguing about, `.line-dash` for the rest.

## 4. Scatter

```
x_i = x0 + (a_i - amin)/(amax - amin) * (x1 - x0)
y_i = y1 - (b_i - bmin)/(bmax - bmin) * (y1 - y0)
```

`r="4"` dots, `.plot-flat` for the cloud, `.plot-1` and a `<text class="val">` for
the two or three points you actually name. Label both axes with `.tick` at the
midpoint of each edge.

## 5. Ranges and schedules

Horizontal bars on a shared time axis. One row per item, `rowh = 26`.

```
y_i = y0 + i*rowh
x(t) = x0 + (t - t0)/(t1 - t0) * (x1 - x0)
```

```html
<text class="tick" x="48" y="38" text-anchor="end">migration</text>
<rect class="plot-1" x="120" y="26" width="240" height="14" rx="2"/>
<rect class="plot-warn" x="360" y="52" width="90" height="14" rx="2"/>
<line class="gridline" x1="480" y1="16" x2="480" y2="250"/>
<text class="tick" x="480" y="266" text-anchor="middle">launch</text>
```

The vertical gridline is a deadline or a release. Bars crossing it are the point
of the chart.

## 6. Histogram

Columns with no gap (`bw = slot`, `rx="0"`), one `.plot-1` column for the bucket
the reader cares about, `.plot-flat` for the rest. Label the axis at bucket
edges, not centres.

---

## Do not draw

- **Pie and donut.** Use `.meter` for parts of a whole, `.bars` for ranking.
- **Stacked bars with more than three segments.** Nobody can compare the middle
  layers. Split into small multiples.
- **Dual y-axes.** Any story it tells can be told with two stacked charts sharing
  an x-axis.
- **3D anything, gradients, drop shadows.**
- **A chart of four numbers.** That is a `.stats` row or a sentence.
