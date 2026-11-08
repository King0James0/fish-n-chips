#!/usr/bin/env python3
"""Scale pass: grow all three creatures ~20-30% and add real anatomy.

Collision radii (f.r) are deliberately UNTOUCHED so every level and every
fit-test still behaves identically — only the drawing is scaled, via ctx.scale,
and the light radii are nudged up to match the larger bodies.
"""
import sys

P = '/a0/usr/workdir/nightshift/js/main.js'
lines = open(P).read().split('\n')

# ---- sanity: the region we are about to splice is what we think it is ----------
START, END = 1072, 1244          # 1-indexed, inclusive
assert lines[START - 1] == "    if (f.key === 'eel') {", repr(lines[START - 1])
assert lines[END - 1] == '    }', repr(lines[END - 1])
assert lines[END] == '    ctx.restore();', repr(lines[END])

NEW = r"""    const VS = f.key === 'eel' ? 1.3 : f.key === 'angler' ? 1.24 : 1.2;
    if (f.key === 'eel') {
      ctx.rotate(ang);
      ctx.scale(VS, VS);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, rgba(f.glow, 0.2)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
      ctx.restore();
      // ---- EEL: undulating tapered body, fin membrane, chevrons, gills, barbels
      const seg = 11, pitch = 6.2;
      const spine = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const wob = Math.sin(this.time * 8 - i * 0.75) * (2.0 + speed * 0.014) * t;
        spine.push({ x: -i * pitch, y: wob, r: 7.4 * (1 - t * 0.78) + 1.1 });
      }
      const tl = spine[spine.length - 1];
      // caudal fin
      ctx.fillStyle = rgba(f.glow, 0.3);
      ctx.beginPath();
      ctx.moveTo(tl.x + 1.5, tl.y);
      ctx.lineTo(tl.x - 10, tl.y - 7.6); ctx.lineTo(tl.x - 5, tl.y); ctx.lineTo(tl.x - 10, tl.y + 7.6);
      ctx.closePath(); ctx.fill();
      // dorsal + anal fin membranes (translucent ribbons riding the spine)
      ctx.fillStyle = rgba(f.glow, 0.15);
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y - spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y - s.r - 3.4);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y - spine[i].r);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y + spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y + s.r + 2.6);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y + spine[i].r);
      ctx.closePath(); ctx.fill();
      // body silhouette
      ctx.fillStyle = '#04141c';
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y - spine[0].r);
      for (const s of spine) ctx.lineTo(s.x, s.y - s.r);
      for (let i = spine.length - 1; i >= 0; i--) ctx.lineTo(spine[i].x, spine[i].y + spine[i].r);
      ctx.closePath(); ctx.fill();
      // volume + muscle chevrons, clipped to the body
      ctx.save(); ctx.clip();
      const bg = ctx.createLinearGradient(0, -9, 0, 9);
      bg.addColorStop(0, rgba(f.body, 0.32)); bg.addColorStop(0.55, 'rgba(4,20,28,0)');
      bg.addColorStop(1, rgba(f.glow, 0.12));
      ctx.fillStyle = bg; ctx.fillRect(-80, -12, 100, 24);
      ctx.strokeStyle = rgba(f.body, 0.26); ctx.lineWidth = 1;
      for (let i = 1; i < spine.length - 2; i++) {
        const s = spine[i];
        ctx.beginPath();
        ctx.moveTo(s.x + 2.2, s.y - s.r * 0.82);
        ctx.lineTo(s.x - 2.4, s.y);
        ctx.lineTo(s.x + 2.2, s.y + s.r * 0.82);
        ctx.stroke();
      }
      ctx.restore();
      // lateral line
      ctx.setLineDash([2.4, 3]); ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < spine.length; i++) {
        const s = spine[i];
        i ? ctx.lineTo(s.x, s.y - s.r * 0.18) : ctx.moveTo(s.x, s.y - s.r * 0.18);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // glowing belly
      ctx.strokeStyle = rgba(f.glow, 0.85); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < spine.length; i++) {
        const s = spine[i];
        i ? ctx.lineTo(s.x, s.y + s.r) : ctx.moveTo(s.x, s.y + s.r);
      }
      ctx.stroke();
      // flank speckles
      ctx.fillStyle = rgba(f.glow, 0.5);
      for (let i = 2; i < spine.length - 1; i += 2) {
        const s = spine[i];
        ctx.beginPath(); ctx.arc(s.x - 1, s.y - s.r * 0.45, 0.85, 0, 7); ctx.fill();
      }
      // pectoral fin
      ctx.save(); ctx.rotate(Math.sin(this.time * 6) * 0.18);
      ctx.fillStyle = rgba(f.glow, 0.26);
      ctx.beginPath(); ctx.moveTo(-0.5, 4);
      ctx.quadraticCurveTo(-4, 11.5, -9.5, 12.5);
      ctx.quadraticCurveTo(-5.5, 6.5, -0.5, 6.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // gill slits
      ctx.strokeStyle = rgba(f.glow, 0.7); ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        const x = -2.4 - i * 2.7;
        ctx.beginPath(); ctx.moveTo(x, -4.6); ctx.quadraticCurveTo(x - 1.8, 0, x, 4.8); ctx.stroke();
      }
      // head: collar, skull, jaw, eye, barbels
      ctx.fillStyle = rgba(f.body, 0.95);
      ctx.beginPath(); ctx.ellipse(2.4, 0, 9.2, 7.1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#04141c';
      ctx.beginPath(); ctx.ellipse(3.2, 0.8, 7.4, 5.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.55); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10.6, 1.8); ctx.lineTo(3.6, 5.2); ctx.stroke();
      ctx.fillStyle = '#dff8f0';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(9.6 - i * 1.9, 3.4); ctx.lineTo(9 - i * 1.9, 5.1); ctx.lineTo(8.2 - i * 1.9, 3.4);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(9.5, 2.6);
      ctx.quadraticCurveTo(13.5, 5 + Math.sin(this.time * 5) * 0.9, 16, 7.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9.5, 3.4);
      ctx.quadraticCurveTo(12.5, 6.5 + Math.cos(this.time * 4.4) * 0.9, 14, 9.2); ctx.stroke();
      ctx.fillStyle = '#eafff9'; ctx.beginPath(); ctx.arc(5.8, -2.8, 2.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#03201b'; ctx.beginPath(); ctx.arc(6.5, -2.8, 1.35, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(4.9, -3.7, 0.7, 0, 7); ctx.fill();
    } else if (f.key === 'angler') {
      ctx.rotate(ang * 0.35);
      ctx.scale(VS, VS);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
      g.addColorStop(0, rgba(f.glow, 0.18)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
      ctx.restore();
      // ---- ANGLERFISH: huge jaw, canines, operculum, fin fans, photophores
      // caudal fin with rays
      ctx.save(); ctx.rotate(Math.sin(this.time * 5.5) * 0.16);
      ctx.fillStyle = rgba(f.glow, 0.3);
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-27, -11); ctx.lineTo(-21.5, 0); ctx.lineTo(-27, 11);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 0.8;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-25, i * 4.2); ctx.stroke();
      }
      ctx.restore();
      // dorsal spines
      ctx.strokeStyle = rgba(f.body, 0.75); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = -11 + i * 3.9;
        ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x - 1.8, -16.5 - (i % 3) * 2.6); ctx.stroke();
      }
      // pectoral fin fan
      ctx.save(); ctx.rotate(Math.sin(this.time * 4.4) * 0.22);
      ctx.fillStyle = rgba(f.glow, 0.22);
      ctx.beginPath(); ctx.moveTo(2, 5);
      ctx.quadraticCurveTo(-3, 15, -11, 17);
      ctx.quadraticCurveTo(-7, 8.5, 2, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      // body
      ctx.fillStyle = '#241705';
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 12.2, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.clip();
      const bg2 = ctx.createLinearGradient(0, -13, 0, 13);
      bg2.addColorStop(0, rgba(f.body, 0.3)); bg2.addColorStop(0.5, 'rgba(36,23,5,0)');
      bg2.addColorStop(1, rgba(f.glow, 0.14));
      ctx.fillStyle = bg2; ctx.fillRect(-20, -14, 40, 28);
      // mottled hide
      ctx.fillStyle = rgba(f.body, 0.13);
      const mott = [[-8, -5, 4.2], [-2, -7, 3.1], [-11, 2, 3.6], [-4, 4, 4.6], [3, -6, 2.8], [6, 5, 3.2]];
      for (const [mx, my, mr] of mott) { ctx.beginPath(); ctx.ellipse(mx, my, mr, mr * 0.7, 0.4, 0, 7); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = rgba(f.glow, 0.7); ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 12.2, 0, 0, 7); ctx.stroke();
      // operculum (gill cover)
      ctx.strokeStyle = rgba(f.glow, 0.55); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(4.5, -8.5); ctx.quadraticCurveTo(8.5, 0, 4.5, 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2.5, -7.5); ctx.quadraticCurveTo(6, 0, 2.5, 8); ctx.stroke();
      // photophore rows along the belly
      ctx.fillStyle = rgba(f.glow, 0.8);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-12 + i * 4.2, 8.4, 1.1, 0, 7); ctx.fill(); }
      ctx.fillStyle = rgba(f.glow, 0.45);
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-11 + i * 4.4, -9.6, 0.9, 0, 7); ctx.fill(); }
      // gaping jaw
      ctx.fillStyle = '#120a01';
      ctx.beginPath();
      ctx.moveTo(4, -7.5); ctx.quadraticCurveTo(22, -5, 19.5, 1.2);
      ctx.quadraticCurveTo(13, 10, 3, 8.8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(f.glow, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4, -7.5); ctx.quadraticCurveTo(22, -5, 19.5, 1.2); ctx.stroke();
      // teeth: two long canines plus a full set
      ctx.fillStyle = '#fff6dd';
      const teeth = [[6, -5.6, 3.4], [9.6, -4.4, 3.9], [13.2, -2.4, 3.1], [16, 0.4, 2.4],
                     [7.2, 6.8, -3.4], [11, 5.6, -3.8], [14.2, 3.4, -2.8]];
      for (const [tx, ty, th] of teeth) {
        ctx.beginPath(); ctx.moveTo(tx - 1.7, ty); ctx.lineTo(tx, ty + th); ctx.lineTo(tx + 1.7, ty);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#fffbe9';
      ctx.beginPath(); ctx.moveTo(8.4, -5.8); ctx.lineTo(9.9, -1.2); ctx.lineTo(11.4, -5.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9.4, 7.2); ctx.lineTo(10.8, 2.6); ctx.lineTo(12.2, 6.6); ctx.closePath(); ctx.fill();
      // eye with lid + catchlight
      ctx.fillStyle = '#f7f2df'; ctx.beginPath(); ctx.arc(5.6, -6.4, 4.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#140c02'; ctx.beginPath(); ctx.arc(6.6, -6.4, 2.1, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(4.4, -7.7, 1.1, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(f.body, 0.8); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(5.6, -6.4, 4.1, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      // illicium (segmented rod) + esca (lure) with filaments
      const lx = 22 + Math.sin(this.time * 2.1) * 2.6, ly = -25 + Math.cos(this.time * 1.6) * 2.6;
      ctx.strokeStyle = rgba(f.body, 0.95); ctx.lineWidth = 1.9;
      ctx.beginPath(); ctx.moveTo(6.5, -11.5); ctx.quadraticCurveTo(19, -22, lx, ly); ctx.stroke();
      ctx.fillStyle = rgba(f.glow, 0.9);
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const bx = (1 - t) * (1 - t) * 6.5 + 2 * (1 - t) * t * 19 + t * t * lx;
        const by = (1 - t) * (1 - t) * -11.5 + 2 * (1 - t) * t * -22 + t * t * ly;
        ctx.beginPath(); ctx.arc(bx, by, 1.2, 0, 7); ctx.fill();
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 16);
      lg.addColorStop(0, 'rgba(255,246,210,0.85)'); lg.addColorStop(0.35, 'rgba(255,205,110,0.32)'); lg.addColorStop(1, 'rgba(255,180,60,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 16, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,235,180,0.7)'; ctx.lineWidth = 0.9;
      for (let i = 0; i < 5; i++) {
        const a = i * (Math.PI * 2 / 5) + this.time * 0.8;
        ctx.beginPath(); ctx.moveTo(lx + Math.cos(a) * 3, ly + Math.sin(a) * 3);
        ctx.lineTo(lx + Math.cos(a) * 7.5, ly + Math.sin(a) * 7.5); ctx.stroke();
      }
      ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, 7); ctx.fill();
    } else {
      ctx.scale(VS, VS);
      // ---- JELLY: domed bell, ocelli, lappets, radial canals, gonads, beaded arms
      const sq = 1 + Math.sin(this.time * 3.0) * 0.13;
      const bw = 15.5 * sq, bh = 11.5 / sq;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -4, 0, 0, -4, 30);
      g.addColorStop(0, rgba(f.glow, 0.2)); g.addColorStop(1, rgba(f.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -4, 30, 0, 7); ctx.fill();
      ctx.restore();
      ctx.lineCap = 'round';
      // long beaded tentacles, drawn first so the bell laps over their roots
      for (let i = 0; i < 12; i++) {
        const ox = -13.5 + i * 2.45;
        const len = 30 + (i % 4) * 9;
        const sw = Math.sin(this.time * 2.5 + i * 0.7) * 7;
        ctx.strokeStyle = rgba(f.glow, 0.45); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(ox, 0);
        ctx.bezierCurveTo(ox + sw * 0.4, len * 0.4, ox + sw, len * 0.72, ox + sw * 0.6, len);
        ctx.stroke();
        ctx.fillStyle = rgba(f.glow, 0.75);
        for (let k = 1; k <= 3; k++) {
          const t = k / 4;
          const bx = ox + sw * t * 0.85, by = len * t;
          ctx.beginPath(); ctx.arc(bx, by, 0.9, 0, 7); ctx.fill();
        }
      }
      // oral arms: frilled ribbons hanging centrally
      for (let i = 0; i < 4; i++) {
        const ox = -6 + i * 4;
        const sw = Math.sin(this.time * 2.2 + i * 1.1) * 5;
        ctx.fillStyle = rgba(f.body, 0.4);
        ctx.beginPath();
        ctx.moveTo(ox - 2.4, 0);
        ctx.quadraticCurveTo(ox + sw * 0.6 - 2, 12, ox + sw - 1.2, 21);
        ctx.lineTo(ox + sw + 1.2, 21);
        ctx.quadraticCurveTo(ox + sw * 0.6 + 2.4, 12, ox + 2.4, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(ox, 1);
        ctx.quadraticCurveTo(ox + sw * 0.6, 12, ox + sw, 20); ctx.stroke();
      }
      // bell path: domed exumbrella over a scalloped margin
      const lobes = 7;
      const bellPath = () => {
        ctx.beginPath();
        ctx.moveTo(-bw, -1);
        ctx.bezierCurveTo(-bw, -bh * 2.15, bw, -bh * 2.15, bw, -1);
        for (let i = 0; i <= lobes; i++) {
          const t = i / lobes;
          ctx.lineTo(bw - 2 * bw * t, -1 + Math.sin(t * Math.PI * lobes) * 2.6);
        }
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(26,10,50,0.9)'; bellPath(); ctx.fill();
      ctx.save(); bellPath(); ctx.clip();
      const bg3 = ctx.createLinearGradient(0, -bh * 2.1, 0, 2);
      bg3.addColorStop(0, rgba(f.glow, 0.3)); bg3.addColorStop(0.6, rgba(f.body, 0.18));
      bg3.addColorStop(1, 'rgba(26,10,50,0)');
      ctx.fillStyle = bg3; ctx.fillRect(-bw, -bh * 2.2, bw * 2, bh * 2.4);
      // radial canals
      ctx.strokeStyle = rgba(f.glow, 0.5); ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const t = (i + 0.5) / 7;
        ctx.beginPath(); ctx.moveTo(0, -bh * 1.5);
        ctx.quadraticCurveTo((-bw + 2 * bw * t) * 0.5, -bh * 0.9, -bw + 2 * bw * t, -1.5);
        ctx.stroke();
      }
      ctx.restore();
      // rim: circular canal + outer membrane
      ctx.strokeStyle = rgba(f.glow, 0.95); ctx.lineWidth = 1.9; bellPath(); ctx.stroke();
      ctx.strokeStyle = rgba(f.glow, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -1.5, bw * 0.86, bh * 0.72, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke();
      // ocelli around the margin
      ctx.fillStyle = rgba(f.glow, 0.95);
      for (let i = 0; i < 8; i++) {
        const t = (i + 0.5) / 8;
        ctx.beginPath(); ctx.arc(-bw + 2 * bw * t, -2.6, 1.15, 0, 7); ctx.fill();
      }
      // gonad cluster + manubrium + highlight
      ctx.fillStyle = rgba(f.glow, 0.72);
      for (const [gx, gy] of [[-4.4, -7.5], [4.4, -7.5], [-2.4, -11.5], [2.4, -11.5]]) {
        ctx.beginPath(); ctx.ellipse(gx, gy, 3.1, 2.4, 0, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = rgba(f.glow, 0.6); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -1); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.ellipse(-4.6, -13.4, 2.6, 1.5, -0.5, 0, 7); ctx.fill();
    }""".split('\n')

# ---- light radii grow with the bodies ------------------------------------------
old_lr = "    let lr = f.key === 'angler' ? 178 : f.key === 'jelly' ? 120 : 134;"
assert lines[1051] == old_lr, repr(lines[1051])
lines[1051] = "    let lr = f.key === 'angler' ? 200 : f.key === 'jelly' ? 138 : 154;"

old_trail = "      ctx.fillStyle = rgba(f.glow, a * 0.06);\n      ctx.beginPath(); ctx.arc(t.x, t.y, f.r * (0.4 + a * 0.9), 0, 7); ctx.fill();"
assert old_trail in '\n'.join(lines[1062:1064]), 'trail lines moved'
lines[1062] = "      ctx.fillStyle = rgba(f.glow, a * 0.07);"
lines[1063] = "      ctx.beginPath(); ctx.arc(t.x, t.y, f.r * (0.6 + a * 1.2), 0, 7); ctx.fill();"

out = lines[:START - 1] + NEW + lines[END:]
open(P, 'w').write('\n'.join(out))
print(f'spliced lines {START}-{END} -> {len(NEW)} new lines; file now {len(out)} lines')
