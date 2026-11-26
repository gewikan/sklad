/* Sklad BestCreta: skenovanie EAN, príjem a výdaj. Dáta pohybov sú v databáze aplikácie (kolekcie "pohyby" a "ean"). */
(function () {
	'use strict';
	var db = null, dbStav = 'caka', R = [], EAN = {}, B = null, $ = function (i) { return document.getElementById(i); };
	var S = { k: null, typ: null, kod: '' };
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
	function zn(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
	function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
	function cisla(s) { return String(s || '').replace(/\D+/g, ''); }
	function eanP(p) { var m = /^\s*(\d{8,14})/.exec(p.ean || ''); return m ? m[1] : ''; }
	function prod(k) { return B.P.filter(function (x) { return x.k === k; })[0]; }
	function cas(t) { var d = new Date(t); if (isNaN(d)) { return ''; } function z(n) { return (n < 10 ? '0' : '') + n; } return z(d.getDate()) + '.' + z(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); }
	var TYP = { prijem: 'príjem', vydaj: 'výdaj', objednavka: 'objednávka z e-shopu', vratenie: 'vrátená objednávka' };

	/* ---------- prepočet stavu ---------- */
	function prepocitaj() {
		if (!B) { return; }
		var sum = {};
		R.forEach(function (r) {
			if (r.storno) { return; }
			var s = sum[r.k] || (sum[r.k] = { prijem: 0, von: 0 });
			if (r.ks > 0 && r.typ === 'prijem') { s.prijem += r.ks; } else { s.von += -r.ks; }
		});
		B.P.forEach(function (p) {
			if (!p._z) { p._z = { stock: p.stock, sold: p.sold, recv: p.recv }; }
			if (!p.done) { return; }
			var s = sum[p.k] || { prijem: 0, von: 0 };
			p.recv = p._z.recv + s.prijem; p.sold = p._z.sold + s.von; p.stock = p._z.stock + s.prijem - s.von;
		});
		B.refresh();
	}

	/* ---------- databáza ---------- */
	function pripoj() {
		if (!window.SKLAD) { dbStav = 'nie'; return; }
		var t = setTimeout(function () { if (dbStav === 'caka') { dbStav = 'pomaly'; stavDb(); } }, 10000);
		window.SKLAD.db().then(function (d) {
			if (!d) { clearTimeout(t); dbStav = 'nie'; stavDb(); return; }
			db = d;
			db.collection('pohyby').onSnapshot(function (snap) {
				R = snap.docs.map(function (x) { var o = x.data() || {}; return { exp: String(o.exp || ''), id: x.id, k: String(o.k || ''), typ: String(o.typ || ''), kart: +o.kart || 0, kk: +o.kk || 0, volne: +o.volne || 0, ks: Math.round(+o.ks || 0), t: String(o.t || ''), pozn: String(o.pozn || ''), obj: String(o.obj || ''), storno: !!o.storno }; });
				R.sort(function (a, b) { return a.t < b.t ? 1 : a.t > b.t ? -1 : 0; });
				if (!snap.metadata.fromCache) { clearTimeout(t); dbStav = 'ok'; }
				prepocitaj(); stavDb();
				if (S.view === 'detail' && S.k && !$('panel').hidden) { B.open(S.k); }
			}, function () { clearTimeout(t); dbStav = 'nie'; stavDb(); });
			db.collection('ean').onSnapshot(function (snap) { EAN = {}; snap.docs.forEach(function (x) { var o = x.data() || {}; if (o.k) { EAN[x.id] = String(o.k); } }); }, function () {});
		}, function () { clearTimeout(t); dbStav = 'nie'; stavDb(); });
	}
	function stavDb() {
		var el = $('bcs-db'); if (!el) { return; }
		var m = { caka: 'Pripájam zápis pohybov…', pomaly: 'Databáza pohybov sa zatiaľ neozvala. Stav nižšie nemusí obsahovať posledné pohyby.', nie: 'Databáza pohybov teraz neodpovedá. Skontroluj internet a otvor aplikáciu znova.', ok: '' }[dbStav];
		el.textContent = m; el.hidden = !m;
	}

	/* ---------- čítanie čiarového kódu z fotky ---------- */
	function naPlatno(bmp, max, rot) {
		var w = bmp.width, h = bmp.height, s = Math.min(1, max / Math.max(w, h)), cw = Math.round(w * s), ch = Math.round(h * s);
		var c = document.createElement('canvas'); c.width = rot ? ch : cw; c.height = rot ? cw : ch;
		var x = c.getContext('2d');
		if (rot) { x.translate(ch, 0); x.rotate(Math.PI / 2); }
		x.drawImage(bmp, 0, 0, cw, ch);
		return c;
	}
	var zxP = null;
	function zxing() {
		if (window.ZXing) { return Promise.resolve(window.ZXing); }
		if (!zxP) { zxP = new Promise(function (ok, zle) { var s = document.createElement('script'); s.src = 'zxing.min.js'; s.onload = function () { ok(window.ZXing); }; s.onerror = function () { zxP = null; zle(new Error('Čítačka kódov sa nenačítala.')); }; document.head.appendChild(s); }); }
		return zxP;
	}
	function zxDekoduj(Z, c) {
		var hints = new Map();
		hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
		hints.set(Z.DecodeHintType.TRY_HARDER, true);
		var d = c.getContext('2d').getImageData(0, 0, c.width, c.height), n = c.width * c.height, lum = new Uint8ClampedArray(n);
		for (var i = 0, j = 0; i < n; i++, j += 4) { lum[i] = (d.data[j] * 77 + d.data[j + 1] * 150 + d.data[j + 2] * 29) >> 8; }
		var src = new Z.RGBLuminanceSource(lum, c.width, c.height);
		try { return new Z.MultiFormatReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)), hints).getText(); } catch (e1) {
			try { return new Z.MultiFormatReader().decode(new Z.BinaryBitmap(new Z.GlobalHistogramBinarizer(src)), hints).getText(); } catch (e2) { return ''; }
		}
	}
	function dekoduj(file) {
		var bmpP = window.createImageBitmap ? createImageBitmap(file) : Promise.reject(new Error('x'));
		return bmpP.catch(function () {
			return new Promise(function (ok, zle) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { zle(new Error('Fotku sa nepodarilo otvoriť.')); }; im.src = u; });
		}).then(function (bmp) {
			var platna = [naPlatno(bmp, 1600, false), naPlatno(bmp, 1000, false), naPlatno(bmp, 1600, true), naPlatno(bmp, 2400, false)];
			var nat = Promise.resolve('');
			if ('BarcodeDetector' in window) {
				nat = window.BarcodeDetector.getSupportedFormats().then(function (f) {
					var chcem = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'].filter(function (x) { return f.indexOf(x) > -1; });
					if (chcem.indexOf('ean_13') < 0) { return ''; }
					return new window.BarcodeDetector({ formats: chcem }).detect(platna[0]).then(function (r) { return r && r.length ? r[0].rawValue : ''; });
				}).catch(function () { return ''; });
			}
			return nat.then(function (kod) {
				if (kod) { return kod; }
				return zxing().then(function (Z) { for (var i = 0; i < platna.length; i++) { var k = zxDekoduj(Z, platna[i]); if (k) { return k; } } return ''; });
			});
		});
	}

	/* ---------- hľadanie produktu ---------- */
	function podlaKodu(kod) {
		var c = cisla(kod), out = [], vid = {};
		if (c.length === 12) { c = '0' + c; }
		function pridaj(p) { if (p && !vid[p.k]) { vid[p.k] = 1; out.push(p); } }
		if (EAN[c]) { pridaj(prod(EAN[c])); }
		B.P.forEach(function (p) { if (c && eanP(p) === c) { pridaj(p); } });
		if (!out.length && kod) { B.P.forEach(function (p) { if (p.sku && norm(p.sku) === norm(kod)) { pridaj(p); } }); }
		return { kod: c || String(kod).trim(), p: out };
	}
	function riadok(p, attr) {
		var s = p.img || p.foto;
		return '<button type="button" class="row" ' + attr + '="' + esc(p.k) + '">' + (s ? '<img alt="" src="' + s + '">' : '<span class="ph"></span>') + '<span><span class="nm">' + esc(p.name) + (p.vr ? ' – ' + esc(p.vr) : '') + '</span><br><span class="meta">č. ' + esc(p.n) + (p.sku ? ' · kód ' + esc(p.sku) : '') + '</span></span><span class="qty">' + (p.done ? '<b>' + p.stock + '</b><span>ks</span>' : '<span class="wait">nespočítané</span>') + '</span></button>';
	}

	/* ---------- obrazovky v paneli ---------- */
	function panel(h) { stopSken(); S.view = 'ine'; $('detail').innerHTML = h; $('panel').hidden = false; $('panel').querySelector('.card').scrollTop = 0; }
	var stream = null, zxR = null, skenBezi = false, poslKod = '', poslCas = 0;
	function stopSken() {
		skenBezi = false;
		if (zxR) { try { zxR.reset(); } catch (x) {} zxR = null; }
		if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
	}
	function najdeny(kod) {
		var t = Date.now(); if (kod === poslKod && t - poslCas < 2000) { return; }
		poslKod = kod; poslCas = t; if (navigator.vibrate) { navigator.vibrate(60); }
		stopSken(); poKode(kod);
	}
	function skenChyba(m) { stopSken(); var el = $('bcs-skenmsg'), v = $('bcs-video'); if (v) { v.hidden = true; } if (el) { el.className = 'bcs-msg zla'; el.textContent = m; } }
	function kameraChyba(er) {
		var m = 'Kameru sa nepodarilo spustiť. Použi tlačidlo Odfotiť alebo zadaj kód ručne.';
		if (er && (er.name === 'NotAllowedError' || er.name === 'SecurityError')) { m = 'Kamera nie je povolená. Ťukni na zámok pri adrese, povoľ kameru a otvor Skenovať znova.'; }
		if (er && er.name === 'NotFoundError') { m = 'Na tomto zariadení som nenašiel kameru.'; }
		skenChyba(m);
	}
	function lampa(s) {
		var b = $('bcs-lampa'), tr = s && s.getVideoTracks ? s.getVideoTracks()[0] : null;
		if (!b || !tr || !tr.getCapabilities) { return; }
		var cap = tr.getCapabilities(); if (!cap.torch) { return; }
		var on = false; b.hidden = false;
		b.onclick = function () { on = !on; tr.applyConstraints({ advanced: [{ torch: on }] }).catch(function () {}); b.textContent = on ? 'Zhasnúť' : 'Svetlo'; };
	}
	function startSken() {
		var v = $('bcs-v'); if (!v) { return; }
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { return skenChyba('Tento prehliadač nedovolí použiť kameru naživo. Použi tlačidlo Odfotiť alebo zadaj kód ručne.'); }
		skenBezi = true;
		var chcem = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
		var p = ('BarcodeDetector' in window) ? window.BarcodeDetector.getSupportedFormats().then(function (f) { chcem = chcem.filter(function (x) { return f.indexOf(x) > -1; }); return chcem.indexOf('ean_13') > -1; }).catch(function () { return false; }) : Promise.resolve(false);
		p.then(function (nat) {
			if (!skenBezi) { return; }
			if (nat) {
				navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (s) {
					if (!skenBezi) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
					stream = s; v.srcObject = s; v.play().catch(function () {}); lampa(s);
					var det = new window.BarcodeDetector({ formats: chcem });
					(function krok() {
						if (!skenBezi) { return; }
						if (v.readyState < 2) { return setTimeout(krok, 150); }
						det.detect(v).then(function (r) { if (r && r.length && r[0].rawValue) { najdeny(r[0].rawValue); } else { setTimeout(krok, 140); } }).catch(function () { setTimeout(krok, 300); });
					})();
				}).catch(kameraChyba);
			} else {
				zxing().then(function (Z) {
					if (!skenBezi) { return; }
					var hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
					zxR = new Z.BrowserMultiFormatReader(hints, 200);
					zxR.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, v, function (res) { if (res && skenBezi) { najdeny(res.getText()); } }).then(function () { if (v.srcObject) { lampa(v.srcObject); } }).catch(kameraChyba);
				}, function () { skenChyba('Čítačka kódov sa nenačítala. Skontroluj internet.'); });
			}
		});
	}
	function sken(msg) {
		S.k = null;
		panel('<h2 id="d-title">Skenovať produkt</h2>' + (msg ? '<p class="bcs-msg ' + (msg.zla ? 'zla' : 'ok') + '">' + esc(msg.t) + '</p>' : '') +
			'<div class="bcs-video" id="bcs-video"><video id="bcs-v" playsinline muted autoplay></video><div class="ram"></div><button type="button" id="bcs-lampa" class="bcs-lampa" hidden>Svetlo</button></div>' +
			'<p id="bcs-skenmsg" class="bcs-msg ok">Namier kameru na čiarový kód. Prečíta sa sám.</p><p id="bcs-cita" class="bcs-msg ok" hidden>Fotku mám, čítam kód…</p>' +
			'<form id="bcs-rucne" class="bcs-form"><label>Alebo zadaj EAN ručne<input id="bcs-kod" inputmode="numeric" autocomplete="off" placeholder="napr. 5200101805022"></label><button class="bcs-btn sv">Nájsť</button></form>' +
			'<div class="bcs-btn sv bcs-fwrap">Odfotiť kód ako fotku<input type="file" class="bcs-file" accept="image/*" capture="environment" aria-label="Odfotiť kód ako fotku"></div>' +
			'<p class="meta">Produkt bez kódu nájdeš cez hľadanie v zozname Sklad, príjem a výdaj sú v jeho detaile.</p>');
		startSken();
	}
	function poKode(kod) {
		var r = podlaKodu(kod); S.kod = r.kod;
		if (r.p.length === 1) { return B.open(r.p[0].k); }
		if (r.p.length > 1) { return panel('<h2 id="d-title">Kód ' + esc(r.kod) + '</h2><p class="bcs-msg ok">Tento kód majú viaceré produkty. Vyber ten, ktorý držíš v ruke.</p><div class="list">' + r.p.map(function (p) { return riadok(p, 'data-bk'); }).join('') + '</div><button type="button" class="bcs-btn sv" data-bsken="1">Skenovať znova</button>'); }
		if (!cisla(r.kod) || cisla(r.kod).length < 8) { return sken({ zla: 1, t: 'Kód „' + r.kod + '“ nepoznám.' }); }
		panel('<h2 id="d-title">Neznámy kód</h2><p class="bcs-msg zla">Kód ' + esc(r.kod) + ' nie je priradený žiadnemu produktu.</p><p>Nájdi produkt podľa názvu a kód sa k nemu uloží. Nabudúce ho sken spozná sám.</p><div class="bcs-form"><label>Názov alebo kód produktu<input id="bcs-hq" autocomplete="off" placeholder="napr. med tymian"></label></div><div class="list" id="bcs-hv"></div><button type="button" class="bcs-btn sv" data-bsken="1">Skenovať znova</button>');
	}
	function extra(p) {
		if (!p) { return ''; }
		var h = '';
		if (!p.done) { return '<p class="bcs-msg ok">Príjem a výdaj pôjdu zapisovať až po spočítaní produktu v inventúre.</p><button type="button" class="bcs-btn sv" data-bsken="1">Skenovať ďalší</button>'; }
		if (!db) { h += '<p class="bcs-msg zla">Zápis pohybov tu teraz nie je dostupný.</p>'; }
		else { h += '<div class="bcs-dvoj"><button type="button" class="bcs-btn" data-btyp="prijem">+ Príjem</button><button type="button" class="bcs-btn cerv" data-btyp="vydaj">− Výdaj</button></div>'; }
		h += '<button type="button" class="bcs-btn sv" data-bsken="1">Skenovať ďalší</button>';
		var mv = R.filter(function (r) { return r.k === p.k; });
		if (mv.length) {
			h += '<h3>Pohyby zapísané v aplikácii</h3><div class="tw"><table><tr><th>Kedy</th><th>Pohyb</th><th class="num">Kusov</th><th></th></tr>' + mv.map(function (r) {
				var popis = TYP[r.typ] || r.typ; if (r.kart) { popis += ' ' + r.kart + ' × ' + r.kk + (r.volne ? ' + ' + r.volne : ''); } if (r.obj) { popis += ' č. ' + r.obj; } if (r.exp) { popis += ', spotreba ' + r.exp; } if (r.pozn) { popis += ', ' + r.pozn; }
				return '<tr' + (r.storno ? ' class="bcs-st"' : '') + '><td>' + esc(cas(r.t)) + '</td><td>' + esc(popis) + (r.storno ? ' (stornované)' : '') + '</td><td class="num">' + zn(r.ks) + '</td><td>' + (!r.storno && db && (r.typ === 'prijem' || r.typ === 'vydaj') ? '<button type="button" class="bcs-mini" data-bstorno="' + esc(r.id) + '">Storno</button>' : '') + '</td></tr>';
			}).join('') + '</table></div>';
		}
		return h;
	}
	function formular(typ) {
		var p = prod(S.k); S.typ = typ; var pr = typ === 'prijem', s = p.img || p.foto;
		panel('<h2 id="d-title">' + (pr ? 'Príjem na sklad' : 'Výdaj zo skladu') + '</h2><div class="bcs-prod">' + (s ? '<img alt="" src="' + s + '">' : '') + '<div><b>' + esc(p.name) + (p.vr ? ' – ' + esc(p.vr) : '') + '</b><br><span class="meta">Na sklade teraz: ' + p.stock + ' ks</span></div></div>' +
			'<form id="bcs-pohyb" class="bcs-form"><div class="bcs-troj"><label>Kartónov<input name="kart" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off"></label><label>Ks v kartóne<input name="kk" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off"></label><label>Voľné kusy<input name="volne" inputmode="numeric" pattern="[0-9]*" placeholder="0" autocomplete="off"></label></div>' +
			'<div id="bcs-vyp" class="bcs-vyp' + (pr ? '' : ' minus') + '"></div>' + (pr ? '<label>Dátum spotreby (napr. 03/2028 alebo 15.03.2028)<input name="exp" maxlength="40" autocomplete="off" inputmode="text" placeholder="MM/RRRR"></label>' : '') + '<label>Poznámka (nemusí byť)<input name="pozn" maxlength="120" autocomplete="off"></label><button class="bcs-btn' + (pr ? '' : ' cerv') + '" id="bcs-uloz" disabled>' + (pr ? 'Zapísať príjem' : 'Zapísať výdaj') + '</button></form><button type="button" class="bcs-btn sv" data-bk="' + esc(p.k) + '">Späť</button>');
		prepocet();
	}
	function hodnoty() { var f = $('bcs-pohyb'); function n(x) { var v = parseInt(f[x].value, 10); return isNaN(v) || v < 0 ? 0 : v; } return { kart: n('kart'), kk: n('kk'), volne: n('volne') }; }
	function prepocet() {
		var f = $('bcs-pohyb'); if (!f) { return; }
		var c = hodnoty(), ks = c.kart * c.kk + c.volne, p = prod(S.k), novy = S.typ === 'prijem' ? p.stock + ks : p.stock - ks, zle = '';
		if (c.kart > 0 && c.kk === 0) { zle = 'Doplň počet kusov v kartóne.'; }
		if (S.typ === 'vydaj' && novy < 0) { zle = 'Na sklade je len ' + p.stock + ' ks.'; }
		if (!zle && S.typ === 'prijem' && !String(f.exp.value || '').trim()) { zle = 'Doplň dátum spotreby.'; }
		$('bcs-vyp').innerHTML = c.kart + ' × ' + c.kk + ' + ' + c.volne + ' = <b>' + ks + ' ks</b><br>Stav po zápise: <b>' + novy + ' ks</b>' + (zle ? '<br><span class="zle">' + zle + '</span>' : '');
		$('bcs-uloz').disabled = ks <= 0 || !!zle;
	}
	function uloz(f) {
		var c = hodnoty(), ks = c.kart * c.kk + c.volne, p = prod(S.k), pred = p.stock, typ = S.typ, b = $('bcs-uloz');
		if (b.disabled || !db) { return; }
		b.disabled = true; b.textContent = 'Zapisujem…';
		db.collection('pohyby').add({ k: p.k, n: String(p.n), nazov: p.name + (p.vr ? ' – ' + p.vr : ''), typ: typ, kart: c.kart, kk: c.kk, volne: c.volne, ks: typ === 'prijem' ? ks : -ks, t: new Date().toISOString(), pozn: String(f.pozn.value || '').slice(0, 120), exp: typ === 'prijem' ? String(f.exp.value || '').trim().slice(0, 40) : '', storno: false }).then(function () {
			var novy = typ === 'prijem' ? pred + ks : pred - ks, s = p.img || p.foto;
			S.k = null;
			panel('<h2 id="d-title">' + (typ === 'prijem' ? 'Príjem zapísaný' : 'Výdaj zapísaný') + '</h2><p class="bcs-msg ok">' + (typ === 'prijem' ? '+' : '−') + ks + ' ks' + (c.kart ? ' (' + c.kart + ' × ' + c.kk + (c.volne ? ' + ' + c.volne : '') + ')' : '') + (typ === 'prijem' && f.exp.value ? ', spotreba ' + esc(String(f.exp.value).trim()) : '') + '</p><div class="bcs-prod">' + (s ? '<img alt="" src="' + s + '">' : '') + '<div><b>' + esc(p.name) + (p.vr ? ' – ' + esc(p.vr) : '') + '</b><br><span class="meta">Pred zápisom: ' + pred + ' ks</span></div></div><div class="bcs-velke"><span>Nový stav skladu</span><b>' + novy + '</b>kusov</div><button type="button" class="bcs-btn" data-bsken="1">Skenovať ďalší</button><button type="button" class="bcs-btn sv" data-bk="' + esc(p.k) + '">Späť na produkt</button>');
		}, function (e) {
			b.disabled = false; b.textContent = typ === 'prijem' ? 'Zapísať príjem' : 'Zapísať výdaj';
			$('bcs-vyp').insertAdjacentHTML('beforeend', '<br><span class="zle">Zápis sa nepodaril' + (e && e.code === 'unavailable' ? ', skús to znova.' : '. Skontroluj internet a skús znova.') + '</span>');
		});
	}

	/* ---------- napojenie na hlavnú aplikáciu ---------- */
	window.BCS = {
		detail: function (p) { stopSken(); S.k = p.k; S.view = 'detail'; var c = $('detail').querySelector('.calc'), h = '<div id="bcs-extra">' + extra(p) + '</div>'; if (c) { c.insertAdjacentHTML('afterend', h); } else { $('detail').insertAdjacentHTML('beforeend', h); } },
		days: function () {
			var el = $('bcs-days'); if (!el) { return; }
			var zive = R.filter(function (r) { return !r.storno; });
			el.innerHTML = R.length ? '<div class="day"><h2>Zapísané v aplikácii</h2><span class="meta">príjem ' + zive.reduce(function (a, r) { return a + (r.ks > 0 ? r.ks : 0); }, 0) + ' ks · výdaj a e-shop ' + zive.reduce(function (a, r) { return a + (r.ks < 0 ? -r.ks : 0); }, 0) + ' ks</span></div><div class="tw"><table><tr><th>Kedy</th><th>Č.</th><th>Produkt</th><th>Pohyb</th><th class="num">Kusov</th></tr>' + R.map(function (r) {
				var p = prod(r.k), popis = TYP[r.typ] || r.typ; if (r.kart) { popis += ' ' + r.kart + ' × ' + r.kk + (r.volne ? ' + ' + r.volne : ''); } if (r.obj) { popis += ' č. ' + r.obj; } if (r.exp) { popis += ', spotreba ' + r.exp; }
				return '<tr' + (r.storno ? ' class="bcs-st"' : '') + '><td>' + esc(cas(r.t)) + '</td><td>' + esc(p ? p.n : '') + '</td><td>' + esc(p ? p.name + (p.vr ? ' – ' + p.vr : '') : r.k) + '</td><td>' + esc(popis) + (r.storno ? ' (stornované)' : '') + '</td><td class="num">' + zn(r.ks) + '</td></tr>';
			}).join('') + '</table></div>' : '';
		}
	};
	document.addEventListener('click', function (e) {
		var t = e.target.closest('[data-bsken],[data-bk],[data-btyp],[data-bstorno],[data-bean]'); if (!t) { return; }
		e.stopPropagation();
		if (t.dataset.bsken) { return sken(); }
		if (t.dataset.bk) { return B.open(t.dataset.bk); }
		if (t.dataset.btyp) { return formular(t.dataset.btyp); }
		if (t.dataset.bean) {
			var k = t.dataset.bean, kod = S.kod; t.disabled = true;
			if (!db) { return; }
			return db.doc('ean/' + kod).set({ k: k, t: new Date().toISOString() }).then(function () { EAN[kod] = k; B.open(k); }, function () { t.disabled = false; });
		}
		if (t.dataset.bstorno) {
			if (t.dataset.ok !== '1') { t.dataset.ok = '1'; t.textContent = 'Naozaj?'; setTimeout(function () { t.dataset.ok = ''; t.textContent = 'Storno'; }, 4000); return; }
			t.disabled = true;
			db.doc('pohyby/' + t.dataset.bstorno).update({ storno: true, storno_t: new Date().toISOString() }).catch(function () { t.disabled = false; t.textContent = 'Nepodarilo sa'; });
		}
	}, true);
	document.addEventListener('change', function (e) {
		if (!e.target.classList || !e.target.classList.contains('bcs-file') || !e.target.files || !e.target.files[0]) { return; }
		var f = e.target.files[0]; $('bcs-cita').hidden = false;
		stopSken(); dekoduj(f).then(function (kod) {
			if (kod) { poKode(kod); } else { sken({ zla: 1, t: 'Na fotke som čiarový kód neprečítal. Odfoť ho bližšie, rovno a bez odlesku, alebo zadaj číslo ručne.' }); }
		}, function (er) { sken({ zla: 1, t: (er && er.message) || 'Fotku sa nepodarilo spracovať.' }); });
	});
	document.addEventListener('input', function (e) {
		if (e.target.form && e.target.form.id === 'bcs-pohyb') { prepocet(); }
		if (e.target.id === 'bcs-hq') {
			var q = norm(e.target.value).trim(), out = $('bcs-hv');
			if (q.length < 2) { out.innerHTML = ''; return; }
			var r = B.P.filter(function (p) { return norm([p.name, p.vr, p.sku, p.n].join(' ')).indexOf(q) >= 0; }).slice(0, 12);
			out.innerHTML = r.map(function (p) { return riadok(p, 'data-bean'); }).join('') || '<p class="meta">Nič som nenašiel.</p>';
		}
	});
	document.addEventListener('submit', function (e) {
		if (e.target.id === 'bcs-rucne') { e.preventDefault(); var v = $('bcs-kod').value.trim(); if (v) { poKode(v); } }
		if (e.target.id === 'bcs-pohyb') { e.preventDefault(); uloz(e.target); }
	});
	document.addEventListener('click', function (e) { if (e.target.id === 'close' || e.target.id === 'panel') { stopSken(); } });
	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { stopSken(); } });
	document.addEventListener('visibilitychange', function () { if (document.hidden) { stopSken(); } else if ($('bcs-v') && !$('panel').hidden && !skenBezi && !$('bcs-video').hidden) { startSken(); } });
	function start() { B = window.BC; var b = $('bcs-fab'); if (b) { b.hidden = false; } prepocitaj(); stavDb(); if (!db) { dbStav = 'caka'; pripoj(); } }
	if (window.BC) { start(); } else { document.addEventListener('bc-ready', start); }
})();
