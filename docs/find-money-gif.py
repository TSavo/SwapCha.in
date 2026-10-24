# Renders docs/find-money.gif in the agent-call.gif style (header/footer reused from that GIF's last frame).
from PIL import Image, ImageDraw, ImageFont
# Run from docs/: python3 find-money-gif.py  (needs Pillow + DejaVu Sans Mono)
# Numbers are from a live find_money run on vitalik.eth (2026-10-24) and the P3D archive fixture in apps/api/src/recover.test.ts.
_src = Image.open('agent-call.gif'); _src.seek(_src.n_frames - 1)
base = _src.convert('RGB')
W = base.width
F = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
font, bold = ImageFont.truetype(F, 16), ImageFont.truetype(FB, 16)
big = ImageFont.truetype(FB, 20)
C = dict(o=(250,176,70), w=(232,226,240), m=(140,128,160), p=(196,140,255), g=(110,231,160), k=(244,140,200), y=(250,200,90))
LH, X0, TOP = 27, 131, 176
# script: list of lines; a line is list of (text, color, font)
def L(*parts): return [(t, C[c], f) for t, c, f in parts]
N, B = font, bold
lines = [
 L(('> ','o',B),("Here's my wallets, find me money.",'w',N)),
 L(('  vitalik.eth','m',N)),
 None,
 L(('▸ ','p',N),('find_money','p',B),('  10 checks · every chain the wallet touched','m',N)),
 'PROGRESS',
 None,
 [('I found $4,538 for you', C['g'], big)],
 L(('  1. ','m',N),('WETH · Ethereum   ','w',N),('1.4665 unwrapped  ','m',N),('$3,404  ','g',B),('→ withdraw(amount)  ','p',N),('/s/10r','m',N)),
 L(('  2. ','m',N),('WETH · Base       ','w',N),('0.2225 unwrapped  ','m',N),('  $517  ','g',B),('→ withdraw(amount)  ','p',N),('/s/10s','m',N)),
 L(('  3. ','m',N),('Aave v2 · Ethereum','w',N),('  $125.7 supplied  ','m',N),('  $126  ','g',B),('→ withdraw on Aave  ','p',N),('/s/10p','m',N)),
 L(('  4. ','m',N),('eBTC.b-5 vault    ','w',N),('ERC-4626 shares   ','m',N),('   $88  ','g',B),('→ redeem(all)       ','p',N),('/s/10t','m',N)),
 L(('  5. ','m',N),('WETH · Optimism   ','w',N),('0.0349 unwrapped  ','m',N),('   $81  ','g',B),('→ withdraw(amount)  ','p',N),('/s/10u','m',N)),
 L(('     + 64 more: idle stablecoins, dust, approvals','m',N)),
 L(('  archive replay · a real P3D wallet at block 26,095,609, the block before its 2026 recovery','m',N)),
 L(('  ★  ','y',N),('P3D dividends     ','w',N),('1.2727 ETH        ','m',N),('$2,954  ','g',B),('→ withdraw()        ','p',N),('same tx the owner signed','m',N)),
 None,
 L(('▸ ','p',N),('swap all to USDC','p',B),('  one guided batch  ','m',N),('swapchan.com/s/10U','y',N)),
 L(('  unsigned · your wallet signs · SwapChan never holds keys','k',N)),
 None,
 L(('> ','o',B),('yes, recover and swap','w',N)),
]
checks = ['wallet balances','Merkl rewards','legacy contracts','contract archaeology','lending','approvals','yields','dust','token risk','gas']
nl = len(lines)
bodyH = nl*LH + 30
top = base.crop((0,0,W,TOP)); bot = base.crop((0,596,W,base.height))
bd = ImageDraw.Draw(bot); bd.rectangle((1240,120,W,bot.height), fill=bot.getpixel((1230,150)))  # erase mouse cursor
H = TOP + bodyH + bot.height
canvas = Image.new('RGB',(W,H)); canvas.paste(top,(0,0)); canvas.paste(bot,(0,TOP+bodyH))
ra, rb = [top.getpixel((x,TOP-1)) for x in range(W)], [base.getpixel((x,595)) for x in range(W)]
px = canvas.load()
for y in range(bodyH):
    t = y/bodyH
    for x in range(W):
        a,b = ra[x], rb[x]; px[x,TOP+y] = tuple(round(a[i]+(b[i]-a[i])*t) for i in range(3))
def draw(img, upto, prog=None):
    d = ImageDraw.Draw(img)
    for i, ln in enumerate(lines[:upto]):
        y = TOP + 12 + i*LH; x = X0
        if ln is None: continue
        if ln == 'PROGRESS':
            n = prog if prog is not None else 10
            done = n == 10
            parts = L(('  ','m',N),('✓ ' if done else '◌ ','g' if done else 'y',B),('█'*n+'░'*(10-n),'g' if done else 'p',N),(f'  {n}/10  ','w',N),
                      (('69 findings · 0 errors · ~80s' if done else checks[min(n,9)]+' …'),'m',N))
            ln = parts
        for t, c, f in ln:
            d.text((x, y + (-2 if f is big else 0)), t, fill=c, font=f); x += d.textlength(t, font=f)
frames, durs = [], []
def add(upto, prog=None, ms=800):
    im = canvas.copy(); draw(im, upto, prog); frames.append(im); durs.append(ms)
add(0, ms=600); add(1); add(2); add(4, 0, 500)
for p in (2,4,6,8): add(5, p, 450)
add(5, 10)
for u in range(7, 13): add(u, 10, 700)
add(13,10); add(15,10,1200)
add(17,10); add(18,10,1000); add(20,10,3200)
pal = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
pal[0].save('find-money.gif', save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True)
print(len(frames), H)
