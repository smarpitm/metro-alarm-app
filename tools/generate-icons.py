import os
import json
from PIL import Image, ImageDraw

def create_circular_mask(size):
    mask = Image.new('L', (size * 4, size * 4), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)

def find_source_image(project_root):
    candidates = [
        os.path.join(project_root, 'assets', 'icon', 'app-icon.png'),
        os.path.join(project_root, 'assets', 'icon', 'app-icon.jpg'),
        os.path.join(project_root, 'assets', 'icon', 'PASTE_YOUR_ICON_HERE.png'),
        os.path.join(project_root, 'assets', 'icon', 'PASTE_YOUR_ICON_HERE.jpg'),
        os.path.join(project_root, 'assets', 'icon', 'icon.png'),
        os.path.join(project_root, 'assets', 'source-icon.png'),
        os.path.join(project_root, 'assets', 'icon.png'),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

def generate_icons():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    src_path = find_source_image(project_root)

    if not src_path:
        print("ERROR: No icon source found! Place your image at assets/icon/PASTE_YOUR_ICON_HERE.png")
        return

    print(f"Loading source icon from: {src_path}")
    im = Image.open(src_path).convert('RGBA')
    w, h = im.size

    # Create high-res 1024x1024 master icon
    master_size = 1024
    bg_color = (27, 40, 59, 255) # #1B283B navy background
    master = Image.new('RGBA', (master_size, master_size), bg_color)

    # Scale the uploaded illustration to fit with balanced padding
    scale = 960 / max(w, h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)

    offset_x = (master_size - new_w) // 2
    offset_y = (master_size - new_h) // 2
    master.paste(resized, (offset_x, offset_y), resized)

    # Save to assets
    assets_dir = os.path.join(project_root, 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    master.save(os.path.join(assets_dir, 'icon.png'))
    print("[OK] Saved master icon in assets/icon.png")

    # Android mipmaps
    android_res = os.path.join(project_root, 'android', 'app', 'src', 'main', 'res')
    android_densities = {
        'mipmap-mdpi': 48,
        'mipmap-hdpi': 72,
        'mipmap-xhdpi': 96,
        'mipmap-xxhdpi': 144,
        'mipmap-xxxhdpi': 192,
    }

    for folder, size in android_densities.items():
        folder_path = os.path.join(android_res, folder)
        os.makedirs(folder_path, exist_ok=True)

        # Standard square launcher
        square_icon = master.resize((size, size), Image.Resampling.LANCZOS)
        square_icon.save(os.path.join(folder_path, 'ic_launcher.png'))

        # Round launcher with anti-aliased circular alpha mask
        round_icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        mask = create_circular_mask(size)
        round_icon.paste(square_icon, (0, 0), mask)
        round_icon.save(os.path.join(folder_path, 'ic_launcher_round.png'))
        print(f"[OK] Generated Android {folder} ({size}x{size})")

    # iOS AppIcon.appiconset
    ios_iconset = os.path.join(project_root, 'ios', 'MetroAlarm', 'Images.xcassets', 'AppIcon.appiconset')
    os.makedirs(ios_iconset, exist_ok=True)

    ios_specs = [
        {"idiom": "iphone", "size": "20x20", "scale": "2x", "px": 40, "filename": "icon-20@2x.png"},
        {"idiom": "iphone", "size": "20x20", "scale": "3x", "px": 60, "filename": "icon-20@3x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "2x", "px": 58, "filename": "icon-29@2x.png"},
        {"idiom": "iphone", "size": "29x29", "scale": "3x", "px": 87, "filename": "icon-29@3x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "2x", "px": 80, "filename": "icon-40@2x.png"},
        {"idiom": "iphone", "size": "40x40", "scale": "3x", "px": 120, "filename": "icon-40@3x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "2x", "px": 120, "filename": "icon-60@2x.png"},
        {"idiom": "iphone", "size": "60x60", "scale": "3x", "px": 180, "filename": "icon-60@3x.png"},
        {"idiom": "ios-marketing", "size": "1024x1024", "scale": "1x", "px": 1024, "filename": "icon-1024.png"},
    ]

    contents_images = []
    for spec in ios_specs:
        px = spec["px"]
        fname = spec["filename"]
        target = master.resize((px, px), Image.Resampling.LANCZOS)
        target.save(os.path.join(ios_iconset, fname))
        contents_images.append({
            "filename": fname,
            "idiom": spec["idiom"],
            "scale": spec["scale"],
            "size": spec["size"],
        })
        print(f"[OK] Generated iOS {fname} ({px}x{px})")

    contents_json = {
        "images": contents_images,
        "info": {
            "author": "xcode",
            "version": 1
        }
    }

    with open(os.path.join(ios_iconset, 'Contents.json'), 'w') as f:
        json.dump(contents_json, f, indent=2)

    print("[OK] Updated iOS Contents.json successfully!")
    print("[SUCCESS] All icons updated successfully!")

if __name__ == '__main__':
    generate_icons()
