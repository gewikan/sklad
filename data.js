/* Sklad BestCreta: šifrované dáta. Súbor data.enc (produkty) aj pohyby v databáze sú zašifrované kľúčom, ktorý je len v tomto zariadení. */
(function () {
	'use strict';
	var FB = 'https://nakupy-1c12d-default-rtdb.europe-west1.firebasedatabase.app/sklad-bc-7f3k9q2m';
	var SOL = 'bestcreta-sklad-v1', LS = 'sklad_kluc';
	var keyP = null;

	function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i += 0x8000) { s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); } return btoa(s); }
	function unb64(s) { var r = atob(s), b = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) { b[i] = r.charCodeAt(i); } return b; }
	function chyba(code, msg) { var e = new Error(msg); e.code = code; return e; }

	function heslo() {
		var m = /[#&]k=([A-Za-z0-9-]+)/.exec(location.hash || '');
		if (m) {
			try { localStorage.setItem(LS, m[1]); } catch (e) {}
			try { history.replaceState(null, '', location.pathname + location.search); } catch (e2) { location.hash = ''; }
			return m[1];
		}
		try { return localStorage.getItem(LS) || ''; } catch (e3) { return ''; }
	}
	function kluc() {
		if (keyP) { return keyP; }
		var h = heslo();
		if (!h) { return Promise.reject(chyba('kluc', 'Chýba kľúč.')); }
		if (!window.crypto || !crypto.subtle) { return Promise.reject(chyba('https', 'Tento prehliadač nepodporuje šifrovanie. Otvor aplikáciu v Chrome.')); }
		var enc = new TextEncoder();
		keyP = crypto.subtle.importKey('raw', enc.encode(h.toUpperCase().replace(/[^A-Z0-9]/g, '')), 'PBKDF2', false, ['deriveKey']).then(function (k) {
			return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(SOL), iterations: 200000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
		});
		return keyP;
	}
	function desifruj(bytes) {
		return kluc().then(function (k) {
			return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, k, bytes.subarray(12)).catch(function () { throw chyba('kluc', 'Kľúč nesedí.'); });
		});
	}
	function sifrujObj(o) {
		return kluc().then(function (k) {
			var iv = crypto.getRandomValues(new Uint8Array(12));
			return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(o))).then(function (ct) {
				var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12); return b64(out);
			});
		});
	}
	function desifrujObj(s) { return desifruj(unb64(s)).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }); }

	function loadData() {
		return kluc().then(function () {
			return fetch('data.enc', { cache: 'no-cache' });
		}).then(function (r) {
			if (!r.ok) { throw chyba('siet', 'Dáta skladu sa nepodarilo načítať.'); }
			return r.arrayBuffer();
		}).then(function (buf) { return desifruj(new Uint8Array(buf)); }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
	}

	/* ---------- databáza pohybov (rovnaké rozhranie, aké používa sken.js) ---------- */
	function rest(path, opt) {
		opt = opt || {};
		return fetch(FB + '/' + path + '.json', { method: opt.method || 'GET', cache: 'no-store', headers: opt.body ? { 'Content-Type': 'application/json' } : undefined, body: opt.body ? JSON.stringify(opt.body) : undefined }).then(function (r) {
			if (!r.ok) { throw chyba('unavailable', 'Databáza neodpovedá (' + r.status + ').'); }
			return r.json();
		}, function () { throw chyba('unavailable', 'Bez spojenia.'); });
	}
	var kol = {};
	function kolekcia(meno) {
		if (kol[meno]) { return kol[meno]; }
		var C = { docs: {}, subs: [], errs: [], raw: null, timer: null, bezi: false };
		function vydaj() { var d = Object.keys(C.docs).sort().map(function (id) { var o = C.docs[id]; return { id: id, exists: true, data: function () { return o; } }; }); var snap = { docs: d, size: d.length, empty: !d.length, metadata: { fromCache: false, hasPendingWrites: false } }; C.subs.forEach(function (f) { try { f(snap); } catch (e) { setTimeout(function () { throw e; }); } }); }
		C.nacitaj = function () {
			if (C.bezi) { return Promise.resolve(); }
			C.bezi = true;
			return rest(meno).then(function (j) {
				var raw = JSON.stringify(j || {});
				if (raw === C.raw) { C.bezi = false; return; }
				var ids = Object.keys(j || {});
				return Promise.all(ids.map(function (id) { return desifrujObj(j[id].c).then(function (o) { return [id, o]; }, function () { return null; }); })).then(function (a) {
					C.docs = {}; a.forEach(function (x) { if (x) { C.docs[x[0]] = x[1]; } }); C.raw = raw; C.bezi = false; vydaj();
				});
			}).catch(function (e) { C.bezi = false; if (C.raw === null) { C.errs.forEach(function (f) { f(e); }); C.errs = []; } });
		};
		C.zapis = function (id, obj) { return sifrujObj(obj).then(function (c) { return rest(meno + '/' + id, { method: 'PUT', body: { c: c } }); }).then(function () { C.docs[id] = obj; C.raw = ''; vydaj(); }); };
		C.api = {
			onSnapshot: function (next, err) {
				C.subs.push(next); if (err) { C.errs.push(err); }
				C.nacitaj();
				if (!C.timer) { C.timer = setInterval(function () { if (!document.hidden) { C.nacitaj(); } }, 8000); document.addEventListener('visibilitychange', function () { if (!document.hidden) { C.nacitaj(); } }); }
				return function () {};
			},
			add: function (obj) { var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); return C.zapis(id, obj).then(function () { return { id: id }; }); },
			doc: function (id) {
				return {
					id: id,
					set: function (obj) { return C.zapis(id, obj); },
					update: function (zmena) { if (!C.docs[id]) { return Promise.reject(chyba('invalid_argument', 'Záznam neexistuje.')); } var o = JSON.parse(JSON.stringify(C.docs[id])); for (var k in zmena) { o[k] = zmena[k]; } return C.zapis(id, o); }
				};
			}
		};
		kol[meno] = C; return C;
	}
	var dbObj = { collection: function (m) { return kolekcia(m).api; }, doc: function (p) { var a = p.split('/'); return kolekcia(a[0]).api.doc(a[1]); } };

	window.SKLAD = {
		loadData: loadData,
		db: function () { return kluc().then(function () { return dbObj; }); },
		ulozKluc: function (h) { try { localStorage.setItem(LS, h); } catch (e) {} keyP = null; },
		zmazKluc: function () { try { localStorage.removeItem(LS); } catch (e) {} keyP = null; }
	};
})();
