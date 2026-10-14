# Compila la scheda dell'App Store: testi in 5 lingue, URL, categoria, prezzo gratuito, età, build e screenshot.
import os, time, json, hashlib, urllib.request, urllib.parse, jwt
KEY = open(os.environ['ASC_KEY_PATH']).read()
tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 1200, 'aud': 'appstoreconnect-v1'},
                 KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
def call(method, path, body=None, raw=None, headers=None):
    url = path if path.startswith('http') else 'https://api.appstoreconnect.apple.com' + path
    h = headers if headers is not None else {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}
    r = urllib.request.Request(url, method=method, data=raw if raw is not None else (json.dumps(body).encode() if body else None), headers=h)
    try:
        with urllib.request.urlopen(r) as f:
            t = f.read(); return f.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e: return e.code, {'testo': e.read().decode()[:500]}
def esito(nome, r):
    s, j = r; print(f"{nome}: {'ok' if s < 300 else s} {'' if s < 300 else j.get('testo', '')}"); return j
WEB = 'https://attrezzatidario-web.github.io/spese-casa/'
T = json.load(open('.github/assets/appstore/testi.json'))
aid = call('GET', '/v1/apps?filter[bundleId]=com.tettostudio.spesecasa')[1]['data'][0]['id']
# --- info dell'app (nome, sottotitolo, privacy, categoria)
info = [i for i in call('GET', f'/v1/apps/{aid}/appInfos')[1]['data'] if i['attributes'].get('appStoreState') != 'READY_FOR_SALE'][0]
iid = info['id']
esito('Categoria Finanza', call('PATCH', f'/v1/appInfos/{iid}', {'data': {'type': 'appInfos', 'id': iid,
    'relationships': {'primaryCategory': {'data': {'type': 'appCategories', 'id': 'FINANCE'}}}}}))
il = {x['attributes']['locale']: x['id'] for x in call('GET', f'/v1/appInfos/{iid}/appInfoLocalizations')[1]['data']}
for k, t in T.items():
    a = {'name': t['name'], 'subtitle': t['subtitle'], 'privacyPolicyUrl': WEB + 'privacy.html'}
    if t['locale'] in il:
        esito(f"Info {t['locale']}", call('PATCH', f"/v1/appInfoLocalizations/{il[t['locale']]}", {'data': {'type': 'appInfoLocalizations', 'id': il[t['locale']], 'attributes': a}}))
    else:
        a['locale'] = t['locale']
        esito(f"Info {t['locale']} (nuova)", call('POST', '/v1/appInfoLocalizations', {'data': {'type': 'appInfoLocalizations', 'attributes': a,
            'relationships': {'appInfo': {'data': {'type': 'appInfos', 'id': iid}}}}}))
# --- età (nessun contenuto sensibile): i tipi dei campi li corregge leggendo gli errori di Apple
import re
s, j = call('GET', f'/v1/appInfos/{iid}/ageRatingDeclaration')
if s == 200:
    rid = j['data']['id']; cur = j['data']['attributes']
    skip = {'kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'developerAgeRatingInfoUrl'}
    att = {k: (False if isinstance(v, bool) else 'NONE') for k, v in cur.items() if k not in skip}
    for _ in range(6):
        st, jj = call('PATCH', f'/v1/ageRatingDeclarations/{rid}', {'data': {'type': 'ageRatingDeclarations', 'id': rid, 'attributes': att}})
        if st < 300: print('Età: ok'); break
        errs = json.loads(jj['testo']).get('errors', []) if jj.get('testo', '').startswith('{') else []
        changed = False
        for e in errs:
            m = re.search(r"attribute '(\w+)'\. Expected a (\w+)", e.get('detail', ''))
            if m: att[m.group(1)] = False if m.group(2) == 'BOOLEAN' else 'NONE'; changed = True
            else:
                k = (e.get('source') or {}).get('pointer', '').split('/')[-1]
                if k in att: att.pop(k); changed = True
        if not changed: print('Età:', st, jj.get('testo', '')[:600]); break
# --- prezzo: gratis
pp = call('GET', f'/v1/apps/{aid}/appPricePoints?filter[territory]=USA&limit=10')[1].get('data', [])
free = [p for p in pp if float(p['attributes']['customerPrice']) == 0]
if free:
    esito('Prezzo gratuito', call('POST', '/v1/appPriceSchedules', {'data': {'type': 'appPriceSchedules',
        'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}, 'baseTerritory': {'data': {'type': 'territories', 'id': 'USA'}},
                          'manualPrices': {'data': [{'type': 'appPrices', 'id': '${p0}'}]}}},
        'included': [{'type': 'appPrices', 'id': '${p0}', 'attributes': {'startDate': None},
                      'relationships': {'appPricePoint': {'data': {'type': 'appPricePoints', 'id': free[0]['id']}}}}]}))
# --- disponibilità in tutti i paesi
terr = []
nxt = '/v1/territories?limit=200'
while nxt:
    s, j = call('GET', nxt); terr += [t['id'] for t in j.get('data', [])]; nxt = (j.get('links') or {}).get('next')
s, j = call('GET', f'/v1/apps/{aid}/appAvailabilityV2')
if s != 200 or not j.get('data'):
    esito('Disponibilità', call('POST', '/v2/appAvailabilities', {'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': True},
        'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}, 'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}'} for t in terr]}}},
        'included': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}', 'attributes': {'available': True},
                      'relationships': {'territory': {'data': {'type': 'territories', 'id': t}}}} for t in terr]}))
else: print('Disponibilità: già impostata')
# --- versione 1.0: copyright, build più recente, testi, screenshot
v = [x for x in call('GET', f'/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS')[1]['data'] if x['attributes']['appStoreState'] in ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED')][0]
vid = v['id']
builds = [b for b in call('GET', f'/v1/builds?filter[app]={aid}&filter[processingState]=VALID&sort=-uploadedDate&limit=1')[1]['data']]
esito('Copyright', call('PATCH', f'/v1/appStoreVersions/{vid}', {'data': {'type': 'appStoreVersions', 'id': vid, 'attributes': {'copyright': '2026 Dario Garnet', 'releaseType': 'AFTER_APPROVAL'}}}))
if builds:
    b = builds[0]
    esito(f"Build {b['attributes']['version']}", call('PATCH', f'/v1/appStoreVersions/{vid}/relationships/build', {'data': {'type': 'builds', 'id': b['id']}}))
vl = {x['attributes']['locale']: x['id'] for x in call('GET', f'/v1/appStoreVersions/{vid}/appStoreVersionLocalizations')[1]['data']}
for k, t in T.items():
    a = {'description': t['desc'], 'keywords': t['keywords'], 'promotionalText': t['promo'], 'supportUrl': WEB + 'supporto.html', 'marketingUrl': WEB}
    if t['locale'] in vl:
        esito(f"Testi {t['locale']}", call('PATCH', f"/v1/appStoreVersionLocalizations/{vl[t['locale']]}", {'data': {'type': 'appStoreVersionLocalizations', 'id': vl[t['locale']], 'attributes': a}}))
    else:
        a['locale'] = t['locale']
        j = esito(f"Testi {t['locale']} (nuova)", call('POST', '/v1/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations', 'attributes': a,
            'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}}))
        if j.get('data'): vl[t['locale']] = j['data']['id']
    lid = vl.get(t['locale'])
    if not lid: continue
    sets = call('GET', f'/v1/appStoreVersionLocalizations/{lid}/appScreenshotSets')[1].get('data', [])
    ss = [x for x in sets if x['attributes']['screenshotDisplayType'] == 'APP_IPHONE_67']
    if ss and len(call('GET', f"/v1/appScreenshotSets/{ss[0]['id']}/appScreenshots")[1].get('data', [])) >= 5:
        print(f"Screenshot {t['locale']}: già presenti"); continue
    if ss:
        sid = ss[0]['id']
        for old in call('GET', f'/v1/appScreenshotSets/{sid}/appScreenshots')[1].get('data', []): call('DELETE', f"/v1/appScreenshots/{old['id']}")
    else:
        sid = call('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': 'APP_IPHONE_67'},
            'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': lid}}}}})[1]['data']['id']
    d = f'.github/assets/appstore/{k}'; n = 0
    for f in sorted(os.listdir(d)):
        img = open(f'{d}/{f}', 'rb').read()
        s, j = call('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': f, 'fileSize': len(img)},
            'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': sid}}}}})
        if s >= 300: print('screenshot errore', f, j); continue
        rid = j['data']['id']
        for op in j['data']['attributes']['uploadOperations']:
            call(op['method'], op['url'], raw=img[op['offset']:op['offset'] + op['length']], headers={x['name']: x['value'] for x in op.get('requestHeaders', [])})
        s, j = call('PATCH', f'/v1/appScreenshots/{rid}', {'data': {'type': 'appScreenshots', 'id': rid, 'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(img).hexdigest()}}})
        n += s < 300
    print(f"Screenshot {t['locale']}: {n} caricati")
