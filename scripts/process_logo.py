# Genera public/img/tienda-marca.png a partir de public/img/tienda.png:
# quita el fondo blanco OPACO de tienda.png (no es transparente de verdad,
# por eso usado tal cual se veia como una tarjeta blanca rotada en el Login)
# y recorta el sobrante. Requiere Pillow: pip install Pillow
#
# Correr de nuevo SOLO si tienda.png cambia y se le quiere regenerar la
# version "recortada" para el watermark del panel de Login. No toca el
# tienda.png original.
#
#   python scripts/process_logo.py public/img/tienda.png public/img/tienda-marca.png

from PIL import Image, ImageDraw
import sys

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')

# Flood-fill desde las 4 esquinas (fondo blanco conectado) hacia adentro,
# parando en el borde del propio logo (colores oscuros/saturados estan
# lejos de blanco en distancia de color, asi que el flood no se filtra).
# Esto deja intacto cualquier blanco ENCERRADO dentro del logo (el texto
# "COMERCIAL", los filos blancos) porque no esta conectado al fondo.
for corner in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
    if im.getpixel(corner)[3] == 0:
        continue  # ya transparente
    ImageDraw.floodfill(im, xy=corner, value=(255, 255, 255, 0), thresh=40)

# Recorta al area real del contenido (ya no hay relleno transparente de sobra)
bbox = im.getbbox()
if bbox:
    im = im.crop(bbox)

im.save(dst)
print('guardado:', dst, im.size)
