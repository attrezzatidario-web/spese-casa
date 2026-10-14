# Carica lo screenshot per la revisione su tutti gli abbonamenti che non ce l'hanno.
import os, time, json, hashlib, urllib.request, jwt
KEY = open(os.environ['ASC_KEY_PATH']).read()
tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 1200, 'aud': 'appstoreconnect-v1'},
                 KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
def call(method, path, body=None, raw=None, headers=None):
    url = path if path.startswith('http') else 'https://api.appstoreconnect.apple.com' + path
    h = headers or {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}
    r = urllib.request.Request(url, method=method, data=raw if raw is not None else (json.dumps(body).encode() if body else None), headers=h)
    try:
        with urllib.request.urlopen(r) as f:
            t = f.read(); return f.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e: return e.code, {'testo': e.read().decode()[:400]}
img = open('.github/assets/revisione-premium.png', 'rb').read()
aid = call('GET', '/v1/apps?filter[bundleId]=com.tettostudio.spesecasa')[1]['data'][0]['id']
for g in call('GET', f'/v1/apps/{aid}/subscriptionGroups')[1]['data']:
    for sub in call('GET', f"/v1/subscriptionGroups/{g['id']}/subscriptions")[1]['data']:
        sid, pid = sub['id'], sub['attributes']['productId']
        s, j = call('GET', f'/v1/subscriptions/{sid}/appStoreReviewScreenshot')
        if s == 200 and j.get('data'):
            print(pid, 'screenshot già presente:', j['data']['attributes'].get('assetDeliveryState')); continue
        s, j = call('POST', '/v1/subscriptionAppStoreReviewScreenshots', {'data': {'type': 'subscriptionAppStoreReviewScreenshots',
            'attributes': {'fileName': 'premium.png', 'fileSize': len(img)},
            'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}}}})
        if s not in (200, 201): print(pid, 'errore prenotazione', s, j); continue
        rid = j['data']['id']
        for op in j['data']['attributes']['uploadOperations']:
            part = img[op['offset']:op['offset'] + op['length']]
            hs = {x['name']: x['value'] for x in op.get('requestHeaders', [])}
            print(pid, 'parte', call(op['method'], op['url'], raw=part, headers=hs)[0])
        s, j = call('PATCH', f'/v1/subscriptionAppStoreReviewScreenshots/{rid}', {'data': {'type': 'subscriptionAppStoreReviewScreenshots', 'id': rid,
            'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(img).hexdigest()}}})
        print(pid, 'caricato', s, j.get('testo', ''))
time.sleep(20)
