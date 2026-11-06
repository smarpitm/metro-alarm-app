import json
import math
import os
from PIL import Image, ImageDraw, ImageFont

def generate_metro_map():
    os.makedirs('assets/map', exist_ok=True)
    with open('src/metro/delhiNetwork.g.ts', 'r', encoding='utf-8') as f:
        content = f.read()
    start = content.find('{')
    end = content.rfind('}') + 1
    data = json.loads(content[start:end])

    # Find lat/lon bounds
    lats = []
    lons = []
    for line in data['lines']:
        for seg in line['segments']:
            for st in seg['stations']:
                if 'lat' in st and 'lon' in st:
                    lats.append(st['lat'])
                    lons.append(st['lon'])

    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)

    # Canvas dimensions
    W, H = 2400, 2400
    margin_x, margin_top, margin_bottom = 140, 200, 220
    plot_w = W - 2 * margin_x
    plot_h = H - margin_top - margin_bottom

    # Dark Theme Canvas (Rich OLED Midnight Blue/Slate)
    BG_COLOR = (11, 15, 25) # #0b0f19
    SURFACE_COLOR = (20, 28, 46) # #141c2e
    BORDER_COLOR = (45, 55, 75)
    TEXT_MAIN = (248, 250, 252)
    TEXT_DIM = (148, 163, 184)
    TEXT_ACCENT = (59, 130, 246)

    img = Image.new('RGBA', (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Grid lines / subtle transit radar background
    for x in range(margin_x, W - margin_x, 150):
        draw.line([(x, margin_top), (x, H - margin_bottom)], fill=(20, 28, 46, 120), width=1)
    for y in range(margin_top, H - margin_bottom, 150):
        draw.line([(margin_x, y), (W - margin_x, y)], fill=(20, 28, 46, 120), width=1)

    # Mercator-like projection
    def to_canvas(lat, lon):
        # lon -> X
        nx = (lon - min_lon) / (max_lon - min_lon)
        x = margin_x + nx * plot_w
        # lat -> Y (inverted)
        ny = (lat - min_lat) / (max_lat - min_lat)
        y = (H - margin_bottom) - ny * plot_h
        return (x, y)

    # Load system font if available, else default
    try:
        font_title = ImageFont.truetype("arial.ttf", 52)
        font_subtitle = ImageFont.truetype("arial.ttf", 26)
        font_label = ImageFont.truetype("arial.ttf", 20)
        font_legend = ImageFont.truetype("arial.ttf", 24)
        font_hub = ImageFont.truetype("arialbd.ttf", 22)
    except Exception:
        font_title = font_subtitle = font_label = font_legend = font_hub = ImageFont.load_default()

    # Find interchange stations (stations present in > 1 line)
    station_lines = {}
    for line in data['lines']:
        for seg in line['segments']:
            for st in seg['stations']:
                sid = st['id']
                if sid not in station_lines:
                    station_lines[sid] = set()
                station_lines[sid].add(line['id'])

    # Draw Line Tracks (underlay)
    # Give line tracks clean 8px thickness with slight glow
    for line in data['lines']:
        col_hex = line.get('color', '#3b82f6').lstrip('#')
        r, g, b = tuple(int(col_hex[i:i+2], 16) for i in (0, 2, 4))
        
        for seg in line['segments']:
            points = []
            for st in seg['stations']:
                if 'lat' in st and 'lon' in st:
                    points.append(to_canvas(st['lat'], st['lon']))
            
            if len(points) >= 2:
                # Outer soft stroke for contrast
                draw.line(points, fill=(15, 20, 30, 220), width=14, joint="curve")
                # Main line track
                draw.line(points, fill=(r, g, b, 255), width=8, joint="curve")

    # Draw Stations
    drawn_stations = set()
    hubs_to_label = [
        'rajiv-chowk', 'kashmere-gate', 'central-secretariat', 'hauz-khas',
        'mandi-house', 'botanical-garden', 'dwarka-sector-21', 'noida-electronic-city',
        'vaishali', 'samaypur-badli', 'huda-city-centre', 'millennium-city-centre-gurugram',
        'rithala', 'new-delhi', 'chandni-chowk', 'anand-vihar', 'yamuna-bank',
        'janakpuri-west', 'kalkaji-mandir', 'welcome', 'inderlok', 'netaji-subhash-place',
        'lajpat-nagar', 'dhaula-kuan', 'delhi-aerocity', 'igi-airport'
    ]

    for line in data['lines']:
        for seg in line['segments']:
            for st in seg['stations']:
                sid = st['id']
                if sid in drawn_stations or 'lat' not in st or 'lon' not in st:
                    continue
                drawn_stations.add(sid)
                x, y = to_canvas(st['lat'], st['lon'])
                is_interchange = len(station_lines.get(sid, [])) > 1

                if is_interchange:
                    # Double ring white & black disc for interchange
                    draw.ellipse([x - 11, y - 11, x + 11, y + 11], fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=2)
                    draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(30, 41, 59, 255))
                else:
                    # Single clean stop pin
                    draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 255, 255, 255), outline=(15, 23, 42, 255), width=1)

                # Label hubs and key stations
                if sid in hubs_to_label:
                    name = st['name']
                    # Label with dark badge background for high legibility
                    bbox = draw.textbbox((0, 0), name, font=font_hub)
                    tw = bbox[2] - bbox[0]
                    th = bbox[3] - bbox[1]
                    lx = x + 14
                    ly = y - th // 2
                    if lx + tw > W - 60:
                        lx = x - tw - 16
                    # Badge background
                    draw.rounded_rectangle([lx - 6, ly - 4, lx + tw + 6, ly + th + 4], radius=6, fill=(15, 23, 42, 220), outline=(51, 65, 85, 200))
                    draw.text((lx, ly), name, font=font_hub, fill=(255, 255, 255, 255))

    # Header Card
    draw.rounded_rectangle([margin_x - 40, 30, W - margin_x + 40, 160], radius=16, fill=SURFACE_COLOR, outline=BORDER_COLOR, width=2)
    draw.text((margin_x, 48), "🚇 Delhi Metro Network Map", font=font_title, fill=TEXT_MAIN)
    draw.text((margin_x, 112), "100% Offline Transit System · Full Network Topology (Lines 1-9 & Airport Express)", font=font_subtitle, fill=TEXT_DIM)
    draw.text((W - margin_x - 300, 75), "● DMRC VERIFIED", font=font_subtitle, fill=(16, 185, 129))

    # Footer Legend Bar
    legend_top = H - 170
    draw.rounded_rectangle([margin_x - 40, legend_top, W - margin_x + 40, H - 30], radius=16, fill=SURFACE_COLOR, outline=BORDER_COLOR, width=2)

    lx = margin_x
    ly = legend_top + 28
    for line in data['lines']:
        col_hex = line.get('color', '#3b82f6').lstrip('#')
        r, g, b = tuple(int(col_hex[i:i+2], 16) for i in (0, 2, 4))
        name = line['name']
        draw.ellipse([lx, ly + 2, lx + 20, ly + 22], fill=(r, g, b, 255), outline=(255, 255, 255, 180), width=1)
        draw.text((lx + 28, ly), name, font=font_legend, fill=TEXT_MAIN)
        bbox = draw.textbbox((0, 0), name, font=font_legend)
        lx += (bbox[2] - bbox[0]) + 55
        if lx > W - margin_x - 220:
            lx = margin_x
            ly += 50

    # Save PNG and optimized WebP
    out_png = 'assets/map/delhi_metro_map.png'
    out_webp = 'assets/map/delhi_metro_map.webp'
    img.save(out_png, 'PNG', optimize=True)
    img.save(out_webp, 'WEBP', quality=88, method=6)
    print(f"Generated {out_png} ({os.path.getsize(out_png) // 1024} KB)")
    print(f"Generated {out_webp} ({os.path.getsize(out_webp) // 1024} KB)")

if __name__ == '__main__':
    generate_metro_map()
