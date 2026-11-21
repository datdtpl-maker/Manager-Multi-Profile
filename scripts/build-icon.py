from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)


def draw_rounded_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def build_logo():
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # 1. Background diagonal emerald-teal gradient masked to squircle
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = grad.load()
    c1 = (13, 148, 136)   # #0D9488 Teal 600
    c2 = (6, 95, 70)      # #065F46 Emerald 800
    c3 = (15, 23, 42)     # deep slate corner depth
    for y in range(size):
        ty = y / (size - 1)
        for x in range(size):
            tx = x / (size - 1)
            t = 0.55 * tx + 0.45 * ty
            r = int(c1[0] * (1 - t) + c2[0] * t)
            g = int(c1[1] * (1 - t) + c2[1] * t)
            b = int(c1[2] * (1 - t) + c2[2] * t)
            # Subtle bottom-right depth
            d = max(0.0, (tx + ty - 1.15) * 0.55)
            r = int(r * (1 - d) + c3[0] * d)
            g = int(g * (1 - d) + c3[1] * d)
            b = int(b * (1 - d) + c3[2] * d)
            px[x, y] = (r, g, b, 255)

    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    pad = 44
    draw_rounded_rect(mdraw, (pad, pad, size - pad, size - pad), radius=220, fill=255)
    img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img, "RGBA")

    # Subtle outer rim highlight
    draw_rounded_rect(
        draw,
        (pad + 6, pad + 6, size - pad - 6, size - pad - 6),
        radius=214,
        outline=(153, 246, 228, 95),
        width=10,
    )

    # 2. Back stacked profile card (top-left, translucent mint)
    draw_rounded_rect(
        draw,
        (170, 195, 650, 560),
        radius=64,
        fill=(204, 251, 241, 95),
        outline=(204, 251, 241, 160),
        width=8,
    )

    # 3. Middle stacked profile card (center, frosted mint-white)
    draw_rounded_rect(
        draw,
        (255, 290, 755, 665),
        radius=68,
        fill=(240, 253, 250, 190),
        outline=(255, 255, 255, 220),
        width=8,
    )

    # 4. Front primary profile card (bottom-right, crisp white with shadow)
    draw_rounded_rect(
        draw,
        (338, 405, 858, 815),
        radius=72,
        fill=(6, 78, 59, 95),
    )
    draw_rounded_rect(
        draw,
        (330, 385, 850, 795),
        radius=72,
        fill=(255, 255, 255, 255),
    )

    # Top bar inside front card (browser profile header)
    draw_rounded_rect(
        draw,
        (330, 385, 850, 495),
        radius=72,
        fill=(241, 245, 249, 255),
    )
    draw.rectangle((330, 450, 850, 498), fill=(241, 245, 249, 255))
    draw.line((330, 498, 850, 498), fill=(226, 232, 240, 255), width=6)

    # 3 vibrant traffic-light dots in front card header
    dot_y = 442
    draw.ellipse((380, dot_y - 16, 412, dot_y + 16), fill=(249, 115, 22, 255))   # Orange
    draw.ellipse((430, dot_y - 16, 462, dot_y + 16), fill=(20, 184, 166, 255))   # Teal
    draw.ellipse((480, dot_y - 16, 512, dot_y + 16), fill=(16, 185, 129, 255))   # Emerald

    # Profile avatar badge & lines inside front card
    draw.ellipse((388, 548, 516, 676), fill=(13, 148, 136, 255))
    # Minimalist geometric person silhouette inside teal avatar
    draw.ellipse((428, 574, 476, 622), fill=(255, 255, 255, 255))
    draw.pieslice((406, 626, 498, 694), start=180, end=360, fill=(255, 255, 255, 255))

    # Content bars inside front card
    draw_rounded_rect(draw, (550, 566, 790, 602), radius=18, fill=(15, 23, 42, 220))
    draw_rounded_rect(draw, (550, 624, 735, 654), radius=15, fill=(148, 163, 184, 210))

    # Extension / Active orange-amber badge bottom-right of front card
    draw_rounded_rect(draw, (550, 686, 706, 736), radius=25, fill=(249, 115, 22, 255))
    draw_rounded_rect(draw, (724, 686, 790, 736), radius=25, fill=(204, 251, 241, 255))

    # Save 512x512 PNG and multi-size ICO
    png_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    png_path = ASSETS / "icon.png"
    ico_path = ASSETS / "icon.ico"
    png_512.save(png_path, format="PNG")
    png_512.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Generated {png_path} and {ico_path}")


if __name__ == "__main__":
    build_logo()
